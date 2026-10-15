import * as vscode from 'vscode';
import { GraftPanelProvider } from './panel.js';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new GraftPanelProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      GraftPanelProvider.activityViewType,
      provider,
    ),
    vscode.window.registerWebviewViewProvider(
      GraftPanelProvider.explorerViewType,
      provider,
    ),

    vscode.commands.registerCommand('graft.focus', () => {
      void vscode.commands.executeCommand('graft.panel.focus');
    }),
    vscode.commands.registerCommand('graft.new', () => provider.cmdNew()),
    vscode.commands.registerCommand('graft.pick', () => provider.cmdPick()),
    vscode.commands.registerCommand('graft.open', () => provider.cmdEdit()),
    vscode.commands.registerCommand('graft.validate', () => provider.cmdValidate()),
    vscode.commands.registerCommand('graft.apply', () => provider.cmdApply()),
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.graft');
  watcher.onDidChange(() => void provider.refresh());
  watcher.onDidCreate(() => void provider.refresh());
  watcher.onDidDelete(() => void provider.refresh());
  context.subscriptions.push(watcher);
}

export function deactivate(): void {
  // nothing to clean up yet
}
