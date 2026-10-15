import * as vscode from 'vscode';
import {
  applyGraftFile,
  parseGraftFile,
  GraftParseError,
} from '@andoni.galardi/graft';
import { getWorkspaceRoot, getGraftDirUri, getDefaultGraftUri } from './paths.js';
import { TEMPLATE } from './template.js';

export class GraftPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'graft.panel';

  private view?: vscode.WebviewView;
  private currentUri?: vscode.Uri;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = buildHtml();

    view.webview.onDidReceiveMessage((msg: { type?: string }) => {
      switch (msg.type) {
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
      }
    });

    void this.refresh();
  }

  // -------- public API used by commands in extension.ts --------

  async refresh(): Promise<void> {
    if (!this.view) return;
    const uri = await this.resolveCurrent();
    this.currentUri = uri;

    if (!uri) {
      this.post({ type: 'content', path: null, text: '' });
      return;
    }

    let text = '';
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = new TextDecoder('utf-8').decode(bytes);
    } catch {
      text = '';
    }

    this.post({
      type: 'content',
      path: vscode.workspace.asRelativePath(uri, false),
      text,
    });
  }

  async resolveCurrent(): Promise<vscode.Uri | undefined> {
    if (this.currentUri) {
      try {
        await vscode.workspace.fs.stat(this.currentUri);
        return this.currentUri;
      } catch {
        // el archivo desapareció: cae al default
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
      this.post({ type: 'status', kind: 'error', text: 'No workspace folder open.' });
      return;
    }
    const dirUri = getGraftDirUri(root);
    const fileUri = getDefaultGraftUri(root);

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
  }

  async cmdPick(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) {
      this.post({ type: 'status', kind: 'error', text: 'No workspace folder open.' });
      return;
    }
    const found = await vscode.workspace.findFiles('**/*.graft', '**/node_modules/**');
    if (found.length === 0) {
      this.post({ type: 'status', kind: 'info', text: 'No .graft files found in this workspace.' });
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
    const text = await vscode.env.clipboard.readText();
    if (!text.trim()) {
      this.post({ type: 'status', kind: 'info', text: 'Clipboard is empty.' });
      return;
    }

    if (!this.currentUri) {
      await this.cmdNew();
      if (!this.currentUri) return;
    }
    const current = this.currentUri;

    let existing = '';
    try {
      existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(current));
    } catch {
      existing = '';
    }

    const nontrivial = existing.split('\n').some((line) => {
      const t = line.trim();
      return t !== '' && !t.startsWith('#');
    });

    if (nontrivial) {
      const choice = await vscode.window.showWarningMessage(
        'Graft: replace current content with clipboard?',
        { modal: true },
        'Replace',
      );
      if (choice !== 'Replace') return;
    }

    await vscode.workspace.fs.writeFile(current, new TextEncoder().encode(text));
    await this.refresh();
    this.post({ type: 'status', kind: 'ok', text: 'Pasted from clipboard.' });
  }

  async cmdEdit(): Promise<void> {
    const uri = await this.resolveCurrent();
    if (!uri) {
      this.post({ type: 'status', kind: 'error', text: 'No changes file selected.' });
      return;
    }
    await vscode.window.showTextDocument(uri);
  }

  async cmdValidate(): Promise<void> {
    const uri = await this.resolveCurrent();
    if (!uri) {
      this.post({ type: 'status', kind: 'error', text: 'No changes file selected.' });
      return;
    }
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch (e) {
      this.post({
        type: 'status',
        kind: 'error',
        text: `Cannot read file: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    try {
      const ops = parseGraftFile(text, uri.fsPath);
      const n = ops.length;
      this.post({
        type: 'status',
        kind: 'ok',
        text: `OK, ${n} operation${n === 1 ? '' : 's'}.`,
      });
    } catch (e) {
      if (e instanceof GraftParseError) {
        this.post({ type: 'status', kind: 'error', text: e.message });
      } else {
        this.post({
          type: 'status',
          kind: 'error',
          text: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  async cmdApply(): Promise<void> {
    const uri = await this.resolveCurrent();
    if (!uri) {
      this.post({ type: 'status', kind: 'error', text: 'No changes file selected.' });
      return;
    }
    const root = getWorkspaceRoot();
    if (!root) {
      this.post({ type: 'status', kind: 'error', text: 'No workspace folder open.' });
      return;
    }

    const graftPath = uri.fsPath;
    const cwd = root.fsPath;

    let dry;
    try {
      dry = await applyGraftFile(graftPath, { cwd, dryRun: true });
    } catch (e) {
      this.post({
        type: 'status',
        kind: 'error',
        text: `Apply failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    if (dry.readError) {
      this.post({ type: 'status', kind: 'error', text: `Cannot read file: ${dry.readError}` });
      return;
    }
    if (dry.parseError) {
      this.post({ type: 'status', kind: 'error', text: dry.parseError.message });
      return;
    }

    const previewResults = dry.results ?? [];
    const previewCounts = dry.counts!;
    const failures = previewResults.filter((r) => r.status === 'failed');

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

    let real;
    try {
      real = await applyGraftFile(graftPath, { cwd });
    } catch (e) {
      this.post({
        type: 'status',
        kind: 'error',
        text: `Apply failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    if (real.alreadyApplied && real.appliedRecord) {
      this.post({
        type: 'status',
        kind: 'info',
        text: `Already applied on ${real.appliedRecord.appliedAt}.`,
      });
      return;
    }
    if (real.parseError) {
      this.post({ type: 'status', kind: 'error', text: real.parseError.message });
      return;
    }

    const c = real.counts!;
    const parts: string[] = [];
    if (c.ok) parts.push(`${c.ok} ok`);
    if (c.skipped) parts.push(`${c.skipped} skipped`);
    if (c.failed) parts.push(`${c.failed} failed`);
    this.post({
      type: 'status',
      kind: c.failed > 0 ? 'error' : 'ok',
      text: parts.join(' · ') + (real.recorded ? ' (recorded)' : ''),
    });
  }

  // -------- internals --------

  private post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
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
  .path {
    padding: 6px 10px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    border-bottom: 1px solid var(--vscode-panel-border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .toolbar, .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .actions { border-top: 1px solid var(--vscode-panel-border); border-bottom: none; }
  button {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #cccccc);
    border: none;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    border-radius: 2px;
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
  <div class="path" id="path">(no file)</div>
  <div class="toolbar">
    <button data-cmd="new">New</button>
    <button data-cmd="pick">Pick…</button>
    <button data-cmd="paste">Paste</button>
    <button data-cmd="edit">Edit</button>
  </div>
  <div class="content empty" id="content">(no changes file)</div>
  <div class="actions">
    <button data-cmd="validate">Validate</button>
    <button data-cmd="apply" class="primary">Apply</button>
  </div>
  <div class="status" id="status"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const contentEl = document.getElementById('content');
    const pathEl = document.getElementById('path');
    const statusEl = document.getElementById('status');

    document.querySelectorAll('button[data-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        vscode.postMessage({ type: btn.getAttribute('data-cmd') });
      });
    });

    window.addEventListener('message', function (e) {
      const m = e.data;
      if (m.type === 'content') {
        pathEl.textContent = m.path || '(no file)';
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
  </script>
</body>
</html>`;
}