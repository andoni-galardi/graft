import * as vscode from 'vscode';
import {
  applyGraftFile,
  parseGraftFile,
  GraftParseError,
} from '@andoni.galardi/graft';
import { getWorkspaceRoot, getGraftDirUri, getDefaultGraftUri } from './paths.js';
import { TEMPLATE } from './template.js';

export class GraftPanelProvider implements vscode.WebviewViewProvider {
  public static readonly activityViewType = 'graft.panel';
  public static readonly explorerViewType = 'graft.explorer';

  private views = new Set<vscode.WebviewView>();
  private currentUri?: vscode.Uri;
  private lastContent: { path: string | null; text: string } | null = null;
  private lastStatus: { kind: string; text: string } | null = null;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.views.add(view);
    view.onDidDispose(() => this.views.delete(view));

    // Show the current file path on the same line as the view title (Timeline style).
    view.description = this.lastContent?.path ?? undefined;

    view.webview.options = { enableScripts: true };
    view.webview.html = buildHtml();

    view.webview.onDidReceiveMessage((msg: { type?: string }) => {
      switch (msg.type) {
        case 'ready':
          void this.sendCachedState(view);
          break;
        case 'new':
          void this.cmdNew();
          break;
        case 'pick':
          void this.cmdPick();
          break;
        case 'paste':
          void this.cmdPaste();
          break;
        case 'edit':
          void this.cmdEdit();
          break;
        case 'validate':
          void this.cmdValidate();
          break;
        case 'apply':
          void this.cmdApply();
          break;
        case 'applyClipboard':
          void this.cmdApplyClipboard();
          break;

      }
    });

    void this.refresh();
  }

  private async sendCachedState(view: vscode.WebviewView): Promise<void> {
    if (!this.lastContent) {
      await this.refresh();
      return;
    }
    view.description = this.lastContent.path ?? undefined;
    void view.webview.postMessage({
      type: 'content',
      path: this.lastContent.path,
      text: this.lastContent.text,
    });
    if (this.lastStatus) {
      void view.webview.postMessage({
        type: 'status',
        kind: this.lastStatus.kind,
        text: this.lastStatus.text,
      });
    }
  }

  async refresh(): Promise<void> {
    await this.computeContent();
    const displayPath = this.lastContent?.path ?? '';
    for (const v of this.views) {
      v.description = displayPath || undefined;
    }
    if (this.views.size === 0) return;
    this.broadcast({
      type: 'content',
      path: this.lastContent!.path,
      text: this.lastContent!.text,
    });
  }

  private async computeContent(): Promise<void> {
    const uri = await this.resolveCurrent();
    this.currentUri = uri;

    if (!uri) {
      this.lastContent = { path: null, text: '' };
      return;
    }

    let text = '';
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = new TextDecoder('utf-8').decode(bytes);
    } catch {
      text = '';
    }

    this.lastContent = {
      path: vscode.workspace.asRelativePath(uri, false),
      text,
    };
  }

  async resolveCurrent(): Promise<vscode.Uri | undefined> {
    if (this.currentUri) {
      try {
        await vscode.workspace.fs.stat(this.currentUri);
        return this.currentUri;
      } catch {
        // el archivo desapareció
      }
    }
    const root = getWorkspaceRoot();
    if (!root) return undefined;
    const def = getDefaultGraftUri(root);
    try {
      await vscode.workspace.fs.stat(def);
      return def;
    } catch {
      return undefined;
    }
  }

  async cmdNew(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) {
      this.setStatus('error', 'No workspace folder open.');
      return;
    }

    const name = await vscode.window.showInputBox({
      title: 'Graft: new changes file',
      prompt: 'File name (created inside .graft/)',
      value: 'changes.graft',
      validateInput: (v) => {
        const t = v.trim();
        if (!t) return 'Name cannot be empty.';
        if (t.includes('/') || t.includes('\\\\')) return 'No path separators allowed.';
        if (!t.endsWith('.graft')) return 'Name must end with .graft';
        return undefined;
      },
    });
    if (!name) return;

    const dirUri = getGraftDirUri(root);
    const fileUri = vscode.Uri.joinPath(dirUri, name.trim());

    let exists = true;
    try {
      await vscode.workspace.fs.stat(fileUri);
    } catch {
      exists = false;
    }

    if (!exists) {
      await vscode.workspace.fs.createDirectory(dirUri);
      await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(TEMPLATE));
    }

    this.currentUri = fileUri;
    await this.refresh();
    if (exists) {
      this.setStatus('info', `${name.trim()} already exists. Opened.`);
    } else {
      this.setStatus('ok', `Created .graft/${name.trim()}.`);
    }
  }

  async cmdPick(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) {
      this.setStatus('error', 'No workspace folder open.');
      return;
    }
    const found = await vscode.workspace.findFiles('**/*.graft', '**/node_modules/**');
    if (found.length === 0) {
      this.setStatus('info', 'No .graft files found in this workspace.');
      return;
    }
    const items = found.map((u) => ({
      label: vscode.workspace.asRelativePath(u, false),
      uri: u,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Graft: select a changes file',
    });
    if (!picked) return;
    this.currentUri = picked.uri;
    await this.refresh();
  }

  async cmdPaste(): Promise<void> {
    await this.doPaste({ skipConfirm: false });
  }

  private async doPaste(opts: { skipConfirm: boolean }): Promise<boolean> {
    const text = await vscode.env.clipboard.readText();
    if (!text.trim()) {
      this.setStatus('info', 'Clipboard is empty.');
      return false;
    }

    if (!this.currentUri) {
      await this.cmdNew();
      if (!this.currentUri) return false;
    }
    const current = this.currentUri;

    let existing = '';
    try {
      existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(current));
    } catch {
      existing = '';
    }

    if (existing === text) {
      this.setStatus('info', 'Clipboard matches current content.');
      return true;
    }

    const nontrivial = existing.split('\n').some((line) => {
      const t = line.trim();
      return t !== '' && !t.startsWith('#');
    });

    if (!opts.skipConfirm && nontrivial) {
      const cfg = vscode.workspace.getConfiguration('graft');
      const confirm = cfg.get<boolean>('paste.confirmOnReplace', true);
      if (confirm) {
        const choice = await vscode.window.showWarningMessage(
          'Graft: replace current content with clipboard?',
          { modal: true },
          'Replace',
        );
        if (choice !== 'Replace') return false;
      }
    }

    await vscode.workspace.fs.writeFile(current, new TextEncoder().encode(text));
    await this.refresh();
    this.setStatus('ok', 'Pasted from clipboard.');
    return true;
  }

  async cmdEdit(): Promise<void> {
    const uri = await this.resolveCurrent();
    if (!uri) {
      this.setStatus('error', 'No changes file selected.');
      return;
    }
    await vscode.window.showTextDocument(uri);
  }

  private async validateCurrent(): Promise<boolean> {
    const uri = await this.resolveCurrent();
    if (!uri) {
      this.setStatus('error', 'No changes file selected.');
      return false;
    }
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch (e) {
      this.setStatus('error', `Cannot read file: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    try {
      const ops = parseGraftFile(text, uri.fsPath);
      const n = ops.length;
      this.setStatus('ok', `OK, ${n} operation${n === 1 ? '' : 's'}.`);
      return true;
    } catch (e) {
      if (e instanceof GraftParseError) {
        this.setStatus('error', e.message);
      } else {
        this.setStatus('error', `Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      }
      return false;
    }
  }

  async cmdValidate(): Promise<void> {
    await this.validateCurrent();
  }

  async cmdApply(): Promise<void> {
    if (!(await this.validateCurrent())) return;
    await this.doApply();
  }

  private async doApply(): Promise<void> {
    const uri = await this.resolveCurrent();
    if (!uri) {
      this.setStatus('error', 'No changes file selected.');
      return;
    }
    const root = getWorkspaceRoot();
    if (!root) {
      this.setStatus('error', 'No workspace folder open.');
      return;
    }

    const graftPath = uri.fsPath;
    const cwd = root.fsPath;

    let dry;
    try {
      dry = await applyGraftFile(graftPath, { cwd, dryRun: true });
    } catch (e) {
      this.setStatus('error', `Apply failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (dry.readError) {
      this.setStatus('error', `Cannot read file: ${dry.readError}`);
      return;
    }
    if (dry.parseError) {
      this.setStatus('error', dry.parseError.message);
      return;
    }

    const previewResults = dry.results ?? [];
    const previewCounts = dry.counts!;
    const failures = previewResults.filter((r) => r.status === 'failed');

    const cfg = vscode.workspace.getConfiguration('graft');
    const shouldConfirm = cfg.get<boolean>('apply.confirm', true);

    if (shouldConfirm) {
      let msg = `${previewResults.length} operation${previewResults.length === 1 ? '' : 's'} would be applied.`;
      if (previewCounts.skipped > 0) {
        msg += ` ${previewCounts.skipped} would be skipped (already applied).`;
      }
      if (failures.length > 0) {
        msg += `\n\n${failures.length} would fail. First: ${failures[0].error ?? 'unknown error'}`;
      }
      const choice = await vscode.window.showWarningMessage(
        msg,
        { modal: true },
        failures.length > 0 ? 'Apply anyway' : 'Apply',
      );
      if (!choice) return;
    }

    let real;
    try {
      real = await applyGraftFile(graftPath, { cwd });
    } catch (e) {
      this.setStatus('error', `Apply failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (real.alreadyApplied && real.appliedRecord) {
      this.setStatus('info', `Already applied on ${real.appliedRecord.appliedAt}.`);
      return;
    }
    if (real.parseError) {
      this.setStatus('error', real.parseError.message);
      return;
    }

    const c = real.counts!;
    const parts: string[] = [];
    if (c.ok) parts.push(`${c.ok} ok`);
    if (c.skipped) parts.push(`${c.skipped} skipped`);
    if (c.failed) parts.push(`${c.failed} failed`);
    this.setStatus(
      c.failed > 0 ? 'error' : 'ok',
      parts.join(' · ') + (real.recorded ? ' (recorded)' : ''),
    );
  }

  async cmdApplyClipboard(): Promise<void> {
    const pasted = await this.doPaste({ skipConfirm: true });
    if (!pasted) return;
    if (!(await this.validateCurrent())) return;
    await this.doApply();
  }


  private setStatus(kind: string, text: string): void {
    this.lastStatus = { kind, text };
    this.broadcast({ type: 'status', kind, text });
  }

  private broadcast(msg: unknown): void {
    for (const v of this.views) {
      void v.webview.postMessage(msg);
    }
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function buildHtml(): string {
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  button {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #cccccc);
    border: none;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .content {
    flex: 1;
    overflow: auto;
    padding: 8px 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 12px);
    white-space: pre;
    line-height: 1.4;
    min-height: 60px;
  }
  .content.empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .status {
    padding: 6px 10px;
    border-top: 1px solid var(--vscode-panel-border);
    font-size: 12px;
    min-height: 1em;
    white-space: pre-wrap;
  }
  .status.ok { color: var(--vscode-testing-iconPassed, #73c991); }
  .status.error { color: var(--vscode-errorForeground, #f48771); }
  .status.info { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div class="toolbar">
    <button data-cmd="paste">Paste</button>
    <button data-cmd="edit">Edit</button>
    <button data-cmd="validate">Validate</button>
    <button data-cmd="apply">Apply</button>
    <button data-cmd="applyClipboard" class="primary">Apply Clipboard</button>

  </div>
  <div class="content empty" id="content">(no changes file)</div>
  <div class="status" id="status"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const contentEl = document.getElementById('content');
    const statusEl = document.getElementById('status');

    document.querySelectorAll('button[data-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        vscode.postMessage({ type: btn.getAttribute('data-cmd') });
      });
    });

    window.addEventListener('message', function (e) {
      const m = e.data;
      if (m.type === 'content') {
        if (!m.text) {
          contentEl.textContent = '(no changes file)';
          contentEl.classList.add('empty');
        } else {
          contentEl.textContent = m.text;
          contentEl.classList.remove('empty');
        }
      } else if (m.type === 'status') {
        statusEl.textContent = m.text;
        statusEl.className = 'status ' + (m.kind || '');
      }
    });

    // Handshake: tell the extension we are ready to receive content.
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
