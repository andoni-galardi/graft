import * as vscode from 'vscode';
import {
  applyGraftFile,
  GraftParseError,
  ApplyFileResult,
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

    view.description = this.lastContent?.path ?? undefined;
    view.webview.options = { enableScripts: true };
    
    const cfg = vscode.workspace.getConfiguration('graft');
    const colors = {
      patch: cfg.get<string>('ui.colors.patch') || 'var(--vscode-charts-blue)',
      write: cfg.get<string>('ui.colors.write') || 'var(--vscode-charts-orange)',
      delete: cfg.get<string>('ui.colors.delete') || 'var(--vscode-charts-red)',
      mkdir: cfg.get<string>('ui.colors.mkdir') || 'var(--vscode-charts-green)',
      rename: cfg.get<string>('ui.colors.rename') || 'var(--vscode-charts-purple)',
    };

    view.webview.html = buildHtml(colors);


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
        case 'copy':
          void vscode.env.clipboard.writeText((msg as any).text);
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
    if (this.lastStatus) {
      void view.webview.postMessage({
        type: 'status',
        kind: this.lastStatus.kind,
        text: this.lastStatus.text,
      });
    }
    await this.refreshTable();
  }

  async refresh(): Promise<void> {
    await this.computeContent();
    const displayPath = this.lastContent?.path ?? '';
    for (const v of this.views) {
      v.description = displayPath || undefined;
    }
    await this.refreshTable();
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

  private async refreshTable(): Promise<void> {
    try {
      const uri = await this.resolveCurrent();
      const root = getWorkspaceRoot();
      if (!uri || !root) {
        this.broadcast({ type: 'operations', ops: [], parseError: null });
        return;
      }
      const dry = await applyGraftFile(uri.fsPath, { cwd: root.fsPath, dryRun: true });
      this.broadcastOps(dry);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.stack || e.message : String(e);
      console.error('[Graft] Error in refreshTable:', errorMsg);
      this.broadcast({ type: 'operations', parseError: 'Internal Error: ' + errorMsg, ops: [] });
    }
  }

  private broadcastOps(result: ApplyFileResult, isDryRun: boolean = true) {
    const payload: any = { type: 'operations', ops: [], isDryRun };

    if (result.parseError) {
      payload.parseError = result.parseError.message;
    } else if (result.readError) {
      payload.parseError = 'Cannot read file: ' + result.readError;
    } else if (result.alreadyApplied) {
      payload.globalMessage = 'Already applied on ' + (result.appliedRecord?.appliedAt || 'unknown');
    } else {
      payload.ops = (result.results || []).map((r, i) => ({
        index: i + 1,
        op: r.op.op,
        path: (r.op as any).path || '',
        description: (r.op as any).description || '',
        status: r.status,
        error: r.error || r.reason || '',
        output: r.output || ''
      }));

    }
    this.broadcast(payload);
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
      this.setStatus('info', name.trim() + ' already exists. Opened.');
    } else {
      this.setStatus('ok', 'Created .graft/' + name.trim() + '.');
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

  async cmdValidate(): Promise<void> {
    const uri = await this.resolveCurrent();
    if (!uri) {
      this.setStatus('error', 'No changes file selected.');
      return;
    }
    const root = getWorkspaceRoot();
    if (!root) return;

    const dry = await applyGraftFile(uri.fsPath, { cwd: root.fsPath, dryRun: true });
    if (dry.parseError) {
      this.setStatus('error', dry.parseError.message);
      this.broadcastOps(dry);
      return;
    }
    if (dry.readError) {
      this.setStatus('error', 'Cannot read file: ' + dry.readError);
      return;
    }

    const count = dry.results?.length || 0;
    const failures = dry.results?.filter(r => r.status === 'failed') || [];
    if (failures.length > 0) {
      this.setStatus('error', failures.length + ' operation(s) would fail.');
    } else {
      this.setStatus('ok', 'OK, ' + count + ' operation' + (count === 1 ? '' : 's') + '.');
    }
    this.broadcastOps(dry);
  }


  async cmdApply(shouldConfirmOverride?: boolean): Promise<void> {

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
      this.setStatus('error', 'Apply failed: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    if (dry.readError) {
      this.setStatus('error', 'Cannot read file: ' + dry.readError);
      return;
    }
    if (dry.parseError) {
      this.setStatus('error', dry.parseError.message);
      this.broadcastOps(dry);
      return;
    }

    this.broadcastOps(dry);

    const previewResults = dry.results ?? [];
    const previewCounts = dry.counts!;
    const failures = previewResults.filter((r) => r.status === 'failed');

    const cfg = vscode.workspace.getConfiguration('graft');
    const shouldConfirm = shouldConfirmOverride !== undefined 
      ? shouldConfirmOverride 
      : cfg.get<boolean>('apply.confirm', true);

    if (shouldConfirm) {

      let msg = previewResults.length + ' operation' + (previewResults.length === 1 ? '' : 's') + ' would be applied.';
      if (previewCounts.skipped > 0) {
        msg += ' ' + previewCounts.skipped + ' would be skipped (already applied).';
      }
      if (failures.length > 0) {
        msg += '\n\n' + failures.length + ' would fail. First: ' + (failures[0].error ?? 'unknown error');
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
      this.setStatus('error', 'Apply failed: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    if (real.alreadyApplied && real.appliedRecord) {
      this.setStatus('info', 'Already applied on ' + real.appliedRecord.appliedAt + '.');
      this.broadcastOps(real, false);
      return;
    }
    if (real.parseError) {
      this.setStatus('error', real.parseError.message);
      this.broadcastOps(real, false);
      return;
    }


    const c = real.counts!;
    const parts: string[] = [];
    if (c.ok) parts.push(c.ok + ' ok');
    if (c.skipped) parts.push(c.skipped + ' skipped');
    if (c.failed) parts.push(c.failed + ' failed');
    this.setStatus(
      c.failed > 0 ? 'error' : 'ok',
      parts.join(' · ') + (real.recorded ? ' (recorded)' : ''),
    );
    this.broadcastOps(real, false);
  }



  async cmdApplyClipboard(): Promise<void> {
    const pasted = await this.doPaste({ skipConfirm: true });
    if (!pasted) return;
    const cfg = vscode.workspace.getConfiguration('graft');
    const shouldConfirm = cfg.get<boolean>('applyClipboard.confirm', true);
    await this.cmdApply(shouldConfirm);
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

function buildHtml(colors: Record<string, string>): string {
  const nonce = makeNonce();
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'nonce-" + nonce + "'",
  ].join('; ');

  const colorVars = [
    `--graft-color-patch: ${colors.patch};`,
    `--graft-color-write: ${colors.write};`,
    `--graft-color-delete: ${colors.delete};`,
    `--graft-color-mkdir: ${colors.mkdir};`,
    `--graft-color-rename: ${colors.rename};`
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  :root {
    ${colorVars}
  }

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
  .table-container {
    flex: 1;
    overflow: auto;
    padding: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 12px;
    table-layout: fixed;
  }
  th, td {
    box-sizing: border-box;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  th {
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    position: sticky;
    top: 0;
    background: var(--vscode-editor-background);
    z-index: 1;
  }
  .col-idx { width: 38px; text-align: right; }
  .col-action { width: 90px; }
  .col-status { width: 70px; }


  tbody tr:hover { background: var(--vscode-list-hoverBackground); cursor: pointer; }
  .empty-row {
    text-align: center;
    font-style: italic;
    color: var(--vscode-descriptionForeground);
  }
  
  /* Operation colors */
  .op-mkdir { color: var(--graft-color-mkdir); font-weight: 600; }
  .op-delete { color: var(--graft-color-delete); font-weight: 600; }
  .op-write { color: var(--graft-color-write); font-weight: 600; }
  .op-patch { color: var(--graft-color-patch); font-weight: 600; }
  .op-rename { color: var(--graft-color-rename); font-weight: 600; }
  .op-copy { color: var(--vscode-charts-yellow); font-weight: 600; }
  .op-append, .op-prepend, .op-insert-after, .op-insert-before { color: var(--vscode-charts-foreground); font-weight: 600; }


  /* Status colors */
  .status-ok { color: var(--vscode-testing-iconPassed); }
  .status-failed { color: var(--vscode-testing-iconFailed); }
  .status-skipped { color: var(--vscode-descriptionForeground); }
  .status-would-apply { color: var(--vscode-foreground); }

  /* Details row */
  .details-row { display: none; }
  .details-row.expanded { display: table-row; }
  .details-content {
    background: var(--vscode-editor-background);
    padding: 8px 10px 8px 20px;
    border-bottom: 1px solid var(--vscode-panel-border);
    border-left: 3px solid var(--vscode-panel-border);
    white-space: pre-wrap;
    word-break: break-all;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    line-height: 1.6;
  }
  .details-content .label { font-weight: 600; color: var(--vscode-descriptionForeground); }

  .details-content .error-text { color: var(--vscode-errorForeground); }
  .details-content .error-text .label { color: var(--vscode-errorForeground); }
  .details-content .desc-text { color: var(--vscode-foreground); font-style: italic; }


  /* Report section */
  .report-section {
    flex: 1;
    min-height: 120px;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
    overflow: hidden;
  }
  .report-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
    background: var(--vscode-panel-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  .report-content {
    flex: 1;
    overflow: auto;
    padding: 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
  }
  .copy-btn {
    background: transparent;
    border: 1px solid var(--vscode-panel-border);
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 10px;
    border-radius: 2px;
  }
  .copy-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

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
    <button data-cmd="apply">Apply</button>
    <button data-cmd="applyClipboard" class="primary">Apply Clipboard</button>
  </div>

  <div class="table-container">
    <table id="ops-table">
      <thead>
        <tr>
          <th class="col-idx">#</th>
          <th class="col-action">Action</th>
          <th>File</th>
          <th class="col-status">Status</th>
        </tr>


      </thead>
      <tbody id="ops-body">
        <tr><td colspan="4" class="empty-row">(no changes file)</td></tr>
      </tbody>
    </table>
  </div>
  <div class="report-section" id="report-section" style="display: none;">
    <div class="report-header">
      <span>Query and Apply Report</span>
      <button id="copy-all-btn" class="copy-btn">Copy All</button>
    </div>
    <div class="report-content" id="report-content"></div>
  </div>
  <div class="status" id="status"></div>


  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const opsBody = document.getElementById('ops-body');
    const statusEl = document.getElementById('status');
    const reportSection = document.getElementById('report-section');
    const reportContent = document.getElementById('report-content');
    const copyAllBtn = document.getElementById('copy-all-btn');
    let currentOpsData = null;


    document.querySelectorAll('button[data-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        vscode.postMessage({ type: btn.getAttribute('data-cmd') });
      });
    });

    function formatStatus(status, isDryRun) {
      if (status === 'would-apply') return 'Ready';
      if (status === 'ok') return 'Applied';
      if (status === 'skipped') return 'Skipped';
      if (status === 'failed') return isDryRun ? 'Will fail' : 'Failed';
      return status;
    }


    function shortPath(path) {
      if (!path || path.length < 35) return path;
      const parts = path.split('/');
      if (parts.length <= 2) return path;
      const file = parts.pop();
      const start = parts[0];
      if (start === '.') return '.../' + file;
      return start + '/.../' + file;
    }

    function renderOperations(data) {
      currentOpsData = data;
      opsBody.innerHTML = '';
      
      if (data.globalMessage) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="4" class="empty-row" style="color: var(--vscode-testing-iconPassed);">' + data.globalMessage + '</td>';
        opsBody.appendChild(tr);
        reportSection.style.display = 'none';
        return;
      }

      if (data.parseError) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="4" class="status-failed" style="font-weight:bold;">Syntax Error: ' + data.parseError + '</td>';
        opsBody.appendChild(tr);
        reportSection.style.display = 'none';
        return;
      }

      if (!data.ops || data.ops.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="4" class="empty-row">(no operations)</td>';
        opsBody.appendChild(tr);
        reportSection.style.display = 'none';
        return;
      }

      const reportLines = [];

      data.ops.forEach(function(op) {
        const tr = document.createElement('tr');
        
        const idxTd = document.createElement('td');
        idxTd.className = 'col-idx';
        idxTd.textContent = '#' + op.index;
        idxTd.style.color = 'var(--vscode-descriptionForeground)';

        const actionTd = document.createElement('td');
        actionTd.className = 'op-' + op.op + ' col-action';
        actionTd.textContent = op.op;
        
        const pathTd = document.createElement('td');
        pathTd.textContent = shortPath(op.path);
        pathTd.title = op.path;
        pathTd.style.fontFamily = 'var(--vscode-editor-font-family, monospace)';
        
        const statusTd = document.createElement('td');
        statusTd.className = 'status-' + op.status + ' col-status';
        statusTd.textContent = formatStatus(op.status, data.isDryRun);

        
        tr.appendChild(idxTd);
        tr.appendChild(actionTd);
        tr.appendChild(pathTd);
        tr.appendChild(statusTd);
        
        // Details row
        const detTr = document.createElement('tr');
        detTr.className = 'details-row';
        const detTd = document.createElement('td');
        detTd.colSpan = 4;
        
        let html = '<div class="details-content" style="position: relative;">';
        html += '<button class="copy-btn copy-op-btn" data-index="' + op.index + '" style="position: absolute; right: 10px; top: 10px;">Copy</button>';
        html += '<div><span class="label">Full path:</span> ' + op.path + '</div>';
        if (op.description) {
          html += '<div><span class="label">Description:</span> <span class="desc-text">' + op.description + '</span></div>';
        }
        if (op.error) {
          html += '<div class="error-text"><span class="label">Error:</span> ' + op.error + '</div>';
        }
        html += '</div>';
        
        detTd.innerHTML = html;
        detTr.appendChild(detTd);
        
        tr.addEventListener('dblclick', function() {
          detTr.classList.toggle('expanded');
        });
        tr.title = 'Double click to show details';
        
        opsBody.appendChild(tr);
        opsBody.appendChild(detTr);

        // Build report string
        let state = formatStatus(op.status, data.isDryRun);
        let block = '[' + '#' + op.index + ' ' + op.op + '] ' + op.path + ' \\u2014 ' + state;
        if (op.description) block += '\\n  Description: ' + op.description;
        if (op.error) block += '\\n  Error: ' + op.error;
        if (op.output) block += '\\n' + op.output;
        reportLines.push(block);
      });

      reportContent.textContent = reportLines.join('\\n\\n');
      reportSection.style.display = 'flex';
    }

    copyAllBtn.addEventListener('click', function () {
      const text = reportContent.textContent;
      if (text) vscode.postMessage({ type: 'copy', text: text });
    });

    opsBody.addEventListener('click', function (e) {
      if (e.target.classList.contains('copy-op-btn')) {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const op = currentOpsData.ops.find(o => o.index === idx);
        if (op) {
          let state = formatStatus(op.status, currentOpsData.isDryRun);
          let text = '[' + '#' + op.index + ' ' + op.op + '] ' + op.path + ' \\u2014 ' + state;
          if (op.description) text += '\\nDescription: ' + op.description;
          if (op.error) text += '\\nError: ' + op.error;
          if (op.output) text += '\\n' + op.output;
          vscode.postMessage({ type: 'copy', text: text });
        }
      }
    });


    window.addEventListener('message', function (e) {
      const m = e.data;
      if (m.type === 'operations') {
        renderOperations(m);
      } else if (m.type === 'status') {
        statusEl.textContent = m.text;
        statusEl.className = 'status ' + (m.kind || '');
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

