import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

export class SemgrepWrapper {

    /**
     * Gets the current workspace folder path or shows an error if none is open
     */
    private getWorkspacePath(): string | undefined {
        // Method 2: Using optional chaining and nullish coalescing
        const path = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!path) {
            vscode.window.showErrorMessage('No workspace folder is opened. Please open a folder first.');
            return undefined;
        }
        return path;
    }

    /**
     * Runs Semgrep on a given project directory and saves the results in JSON format.
     * After execution, it loads the results into the VS Code Problems tab.
     */
    public async run(context: vscode.ExtensionContext): Promise<void> {
        const workspacePath = this.getWorkspacePath();
        if (!workspacePath) {
            return;
        }

        // Create output path in the workspace directory
        const outputPath = path.join(workspacePath, 'semgrep-result.json');

        try {
            const version = await this.execCommand('semgrep --version');
            vscode.window.showInformationMessage(`Semgrep version: ${version.trim()}, scanning in progress ...`);
        } catch (error) {
            vscode.window.showErrorMessage('Semgrep is not installed or not available in PATH. Please install Semgrep and try again.');
            console.error(error);
            return;
        }

        try {
            await this.execCommand(`semgrep --config auto --json --output ${outputPath} ${workspacePath}`);
            vscode.window.showInformationMessage(`Semgrep analysis completed. Results saved at: ${outputPath}`);
            await this.loadSemgrepResults(context, outputPath);
        } catch (error) {
            vscode.window.showErrorMessage('Error running Semgrep. Please check the console for more details.');
            console.error(error);
        }
    }

    /**
     * Function to load Semgrep results and populate the VS Code Problems tab.
     * @param context VS Code Extension context.
     * @param semgrepResultPath Path to the Semgrep result JSON file.
     */
    public async loadSemgrepResults(context: vscode.ExtensionContext, semgrepResultPath: string): Promise<void> {
        const diagnosticsCollection = vscode.languages.createDiagnosticCollection('semgrep');
        context.subscriptions.push(diagnosticsCollection);
    
        let semgrepData: any;
        try {
            const fileContent = fs.readFileSync(semgrepResultPath, 'utf8');
            
            try {
                semgrepData = JSON.parse(fileContent);
                console.log('Semgrep Version:', semgrepData.version);
                console.log('Number of results:', semgrepData.results?.length);
                console.log('Number of errors:', semgrepData.errors?.length);    
            } catch (parseError) {
                vscode.window.showErrorMessage(`JSON parsing failed: ${(parseError as Error).message}`);
                console.error('JSON parsing error:', parseError);
                return;
            }
        } catch (fileError) {
            vscode.window.showErrorMessage(`Failed to read Semgrep result file: ${(fileError as Error).message}`);
            console.error('File reading error:', fileError);
            return;
        }
    
        if (!semgrepData?.results || semgrepData.results.length === 0) {
            vscode.window.showInformationMessage('No issues found in Semgrep results.');
            return;
        }
    
        const diagnosticsMap = new Map<string, vscode.Diagnostic[]>();
    
        for (const result of semgrepData.results) {
            try {
                const filePath = result.path;
                const message = result.extra?.message || 'No message provided';
                const severity = this.mapSeverity(result.severity);
                
                // Ensure we have valid line and column numbers
                const startLine = Math.max(0, (result.start?.line || 1) - 1);
                const startCol = Math.max(0, (result.start?.col || 1) - 1);
                const endLine = Math.max(0, (result.end?.line || startLine + 1) - 1);
                const endCol = Math.max(0, (result.end?.col || startCol + 1) - 1);
    
                const range = new vscode.Range(
                    new vscode.Position(startLine, startCol),
                    new vscode.Position(endLine, endCol)
                );
                
                const diagnostic = new vscode.Diagnostic(range, message, severity);
                
                // Add extra information if available
                if (result.check_id) {
                    diagnostic.code = result.check_id;
                }
    
                if (!diagnosticsMap.has(filePath)) {
                    diagnosticsMap.set(filePath, []);
                }
                diagnosticsMap.get(filePath)!.push(diagnostic);
                
            } catch (error) {
                console.error('Error processing result:', error, result);
                continue; // Skip this result and continue with others
            }
        }
    
        diagnosticsMap.forEach((diagnostics, filePath) => {
            const fileUri = vscode.Uri.file(filePath);
            diagnosticsCollection.set(fileUri, diagnostics);
        });
    
        vscode.window.showInformationMessage(`Loaded ${semgrepData.results.length} Semgrep findings into Problems panel`);
    }
    
    /**
     * Maps Semgrep severity to VS Code DiagnosticSeverity.
     * @param severity The severity string from Semgrep
     * @returns VS Code DiagnosticSeverity
     */
    private mapSeverity(severity: string | undefined): vscode.DiagnosticSeverity {
        if (!severity) {
            return vscode.DiagnosticSeverity.Information; // Default severity
        }
    
        switch (severity.toUpperCase()) {
            case 'ERROR':
                return vscode.DiagnosticSeverity.Error;
            case 'WARNING':
                return vscode.DiagnosticSeverity.Warning;
            case 'INFO':
                return vscode.DiagnosticSeverity.Information;
            case 'HINT':
                return vscode.DiagnosticSeverity.Hint;
            default:
                return vscode.DiagnosticSeverity.Information;
        }
    }

    /**
     * Executes a shell command and returns the result as a promise.
     */
    private execCommand(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr || error.message);
                } else {
                    resolve(stdout);
                }
            });
        });
    }
}
