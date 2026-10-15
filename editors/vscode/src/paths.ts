import * as vscode from 'vscode';

export const GRAFT_DIR = '.graft';
export const DEFAULT_FILE = 'changes.graft';

export function getWorkspaceRoot(): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return folders[0].uri;
}

export function getGraftDirUri(root: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(root, GRAFT_DIR);
}

export function getDefaultGraftUri(root: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(root, GRAFT_DIR, DEFAULT_FILE);
}