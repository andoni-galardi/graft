import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findAllMatches, type Match } from './matcher.js';
import type {
  ApplyOptions,
  CopyOperation,
  InsertAfterOperation,
  InsertBeforeOperation,
  ListOperation,
  Operation,
  OperationResult,
  PatchFindOperation,
  PatchLinesOperation,
  ReadOperation,
  RenameOperation,
  SearchOperation,
} from './types.js';


interface Ctx {
  cwd: string;
  dryRun: boolean;
  force: boolean;
  backupRoot: string | null;
  backupCreated: boolean;
  virtualFiles: Map<string, string>;
  deletedPaths: Set<string>;
  createdDirs: Set<string>;
}

export async function applyOperations(
  ops: Operation[],
  options: ApplyOptions,
): Promise<OperationResult[]> {
  const ctx: Ctx = {
    cwd: path.resolve(options.cwd),
    dryRun: !!options.dryRun,
    force: !!options.force,
    backupRoot: options.backup
      ? path.join(path.resolve(options.cwd), '.graft', 'backups', timestamp())
      : null,
    backupCreated: false,
    virtualFiles: new Map(),
    deletedPaths: new Set(),
    createdDirs: new Set(),
  };

  const results: OperationResult[] = [];
  let aborted = false;
  for (const op of ops) {
    if (aborted) {
      results.push({ op, status: 'skipped', reason: 'skipped (previous failure)' });
      continue;
    }
    const r = await applyOperation(op, ctx);
    results.push(r);
    if (!ctx.dryRun && r.status === 'failed') aborted = true;
  }
  return results;

}

async function applyOperation(op: Operation, ctx: Ctx): Promise<OperationResult> {
  try {
    switch (op.op) {
      case 'mkdir':
        return await applyMkdir(op.path, ctx, op);
      case 'delete':
        return await applyDelete(op.path, op.recursive, ctx, op);
      case 'write':
        return await applyWrite(op.path, op.content, ctx, op);
      case 'rename':
        return await applyRename(op, ctx);
      case 'copy':
        return await applyCopy(op, ctx);
      case 'append':
        return await applyAppend(op.path, op.content, ctx, op);
      case 'prepend':
        return await applyPrepend(op.path, op.content, ctx, op);
      case 'insert-after':
        return await applyInsert(op, ctx, 'after');
      case 'insert-before':
        return await applyInsert(op, ctx, 'before');
      case 'patch':
        return await applyPatch(op, ctx);
      case 'read':
        return await applyRead(op, ctx);
      case 'search':
        return await applySearch(op, ctx);
      case 'list':
        return await applyList(op, ctx);
    }
  } catch (e) {

    return {
      op,
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function applyMkdir(
  relPath: string,
  ctx: Ctx,
  op: Operation,
): Promise<OperationResult> {
  const abs = path.join(ctx.cwd, relPath);
  const exists = await fileExistsAt(abs, ctx);
  if (exists) {
    const isDir = await isDirectoryAt(abs, ctx);
    if (isDir) return { op, status: 'skipped', reason: 'directory already exists' };
    return { op, status: 'failed', error: `path exists and is not a directory: ${relPath}` };
  }
  await mkdirAt(abs, ctx);
  return { op, status: ctx.dryRun ? 'would-apply' : 'ok' };
}

async function applyDelete(
  relPath: string,
  recursive: boolean,
  ctx: Ctx,
  op: Operation,
): Promise<OperationResult> {
  const abs = path.join(ctx.cwd, relPath);
  const exists = await fileExistsAt(abs, ctx);
  if (!exists) return { op, status: 'skipped', reason: 'path does not exist' };

  const isDir = await isDirectoryAt(abs, ctx);
  if (isDir && !recursive) {
    const entries = await listDirAt(abs, ctx);
    if (entries.length > 0) {
      return {
        op,
        status: 'failed',
        error: `directory not empty (use recursive: true): ${relPath}`,
      };
    }
  }

  if (!ctx.dryRun && !isDir) await backupFile(abs, ctx);
  await deleteAt(abs, ctx);
  return { op, status: ctx.dryRun ? 'would-apply' : 'ok' };
}

async function applyWrite(
  relPath: string,
  content: string,
  ctx: Ctx,
  op: Operation,
): Promise<OperationResult> {
  const abs = path.join(ctx.cwd, relPath);
  const exists = await fileExistsAt(abs, ctx);

  let before = '';
  if (exists) {
    before = await readFileAt(abs, ctx);
    if (before === content) {
      return { op, status: 'skipped', reason: 'file already has this content' };
    }
  }

  if (!ctx.dryRun) {
    const onDisk = await pathExists(abs);
    if (onDisk) await backupFile(abs, ctx);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  } else {
    await writeFileAt(abs, content, ctx);
  }

  return {
    op,
    status: ctx.dryRun ? 'would-apply' : 'ok',
    diff: { before, after: content },
  };
}

async function applyRename(op: RenameOperation, ctx: Ctx): Promise<OperationResult> {
  const fromAbs = path.join(ctx.cwd, op.path);
  const toAbs = path.join(ctx.cwd, op.to);

  const fromExists = await fileExistsAt(fromAbs, ctx);
  const toExists = await fileExistsAt(toAbs, ctx);

  if (!fromExists && toExists) {
    return { op, status: 'skipped', reason: 'already renamed' };
  }
  if (!fromExists) {
    return { op, status: 'failed', error: `source not found: ${op.path}` };
  }
  if (toExists) {
    return { op, status: 'failed', error: `destination already exists: ${op.to}` };
  }

  if (ctx.dryRun) {
    const isDir = await isDirectoryAt(fromAbs, ctx);
    if (isDir) {
      ctx.deletedPaths.add(fromAbs);
      ctx.createdDirs.add(toAbs);
    } else {
      const content = await readFileAt(fromAbs, ctx);
      ctx.virtualFiles.delete(fromAbs);
      ctx.deletedPaths.add(fromAbs);
      ctx.virtualFiles.set(toAbs, content);
      ctx.deletedPaths.delete(toAbs);
    }
    return { op, status: 'would-apply' };
  }

  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);
  return { op, status: 'ok' };
}

async function applyCopy(op: CopyOperation, ctx: Ctx): Promise<OperationResult> {
  const fromAbs = path.join(ctx.cwd, op.path);
  const toAbs = path.join(ctx.cwd, op.to);

  const fromExists = await fileExistsAt(fromAbs, ctx);
  if (!fromExists) {
    return { op, status: 'failed', error: `source not found: ${op.path}` };
  }
  const isDir = await isDirectoryAt(fromAbs, ctx);
  if (isDir) {
    return { op, status: 'failed', error: `cannot copy a directory: ${op.path}` };
  }

  const content = await readFileAt(fromAbs, ctx);
  const toExists = await fileExistsAt(toAbs, ctx);
  if (toExists) {
    const existing = await readFileAt(toAbs, ctx);
    if (existing === content) {
      return { op, status: 'skipped', reason: 'destination already has this content' };
    }
  }

  if (ctx.dryRun) {
    ctx.virtualFiles.set(toAbs, content);
    ctx.deletedPaths.delete(toAbs);
    return { op, status: 'would-apply' };
  }

  const onDisk = await pathExists(toAbs);
  if (onDisk) await backupFile(toAbs, ctx);
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.writeFile(toAbs, content, 'utf8');
  return { op, status: 'ok' };
}

async function applyAppend(
  relPath: string,
  content: string,
  ctx: Ctx,
  op: Operation,
): Promise<OperationResult> {
  const abs = path.join(ctx.cwd, relPath);
  const exists = await fileExistsAt(abs, ctx);
  let current = '';
  if (exists) current = await readFileAt(abs, ctx);

  if (content !== '' && current.endsWith(content)) {
    return { op, status: 'skipped', reason: 'content already at end of file' };
  }

  const next = current + content;

  if (ctx.dryRun) {
    ctx.virtualFiles.set(abs, next);
    ctx.deletedPaths.delete(abs);
    return { op, status: 'would-apply', diff: { before: '', after: content } };
  }

  if (exists) await backupFile(abs, ctx);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, next, 'utf8');
  return { op, status: 'ok', diff: { before: '', after: content } };
}

async function applyPrepend(
  relPath: string,
  content: string,
  ctx: Ctx,
  op: Operation,
): Promise<OperationResult> {
  const abs = path.join(ctx.cwd, relPath);
  const exists = await fileExistsAt(abs, ctx);
  let current = '';
  if (exists) current = await readFileAt(abs, ctx);

  if (content !== '' && current.startsWith(content)) {
    return { op, status: 'skipped', reason: 'content already at start of file' };
  }

  const next = content + current;

  if (ctx.dryRun) {
    ctx.virtualFiles.set(abs, next);
    ctx.deletedPaths.delete(abs);
    return { op, status: 'would-apply', diff: { before: '', after: content } };
  }

  if (exists) await backupFile(abs, ctx);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, next, 'utf8');
  return { op, status: 'ok', diff: { before: '', after: content } };
}

async function applyInsert(
  op: InsertAfterOperation | InsertBeforeOperation,
  ctx: Ctx,
  where: 'after' | 'before',
): Promise<OperationResult> {
  const abs = path.join(ctx.cwd, op.path);
  const exists = await fileExistsAt(abs, ctx);
  if (!exists) {
    return { op, status: 'failed', error: `file not found: ${op.path}` };
  }
  const current = await readFileAt(abs, ctx);

  const result = findAllMatches({
    haystack: current,
    needle: op.anchor,
    mode: op.match,
  });
  if (!result.ok) {
    return { op, status: 'failed', error: result.error.message };
  }

  if (result.matches.length === 0) {
    if (op.content !== '' && current.includes(op.content)) {
      return { op, status: 'skipped', reason: 'already applied' };
    }
    return { op, status: 'failed', error: 'anchor not found in file' };
  }
  if (result.matches.length > 1) {
    return {
      op,
      status: 'failed',
      error: `anchor matches ${result.matches.length} locations; make it more specific`,
    };
  }
  if (op.content === '') {
    return { op, status: 'skipped', reason: 'empty content' };
  }

  const m = result.matches[0];
  const ins = computeInsertion(current, m, op.content, where, !!op.inline);

  const alreadyApplied =
    where === 'after'
      ? current.slice(ins.at, ins.at + ins.text.length) === ins.text
      : ins.at - ins.text.length >= 0 &&
        current.slice(ins.at - ins.text.length, ins.at) === ins.text;

  if (alreadyApplied) {
    return { op, status: 'skipped', reason: 'already applied' };
  }

  const next = current.slice(0, ins.at) + ins.text + current.slice(ins.at);

  if (ctx.dryRun) {
    ctx.virtualFiles.set(abs, next);
    ctx.deletedPaths.delete(abs);
    return { op, status: 'would-apply', diff: { before: '', after: ins.text } };
  }

  await backupFile(abs, ctx);
  await fs.writeFile(abs, next, 'utf8');
  return { op, status: 'ok', diff: { before: '', after: ins.text } };
}

function computeInsertion(
  current: string,
  anchor: Match,
  content: string,
  where: 'after' | 'before',
  inline: boolean,
): { at: number; text: string } {
  if (inline) {
    return where === 'after'
      ? { at: anchor.end, text: content }
      : { at: anchor.start, text: content };
  }

  if (where === 'after') {
    const after = anchor.end;
    if (current[after] === '\n' && !content.startsWith('\n')) {
      const text = content.endsWith('\n') ? content : content + '\n';
      return { at: after + 1, text };
    }
    if (after === current.length && !content.startsWith('\n')) {
      const text = content.endsWith('\n') ? '\n' + content : '\n' + content + '\n';
      return { at: after, text };
    }
    return { at: after, text: content };
  }
  const before = anchor.start;
  const atLineStart = before === 0 || current[before - 1] === '\n';
  if (atLineStart && !content.endsWith('\n')) {
    return { at: before, text: content + '\n' };
  }
  return { at: before, text: content };
}

async function applyPatch(
  op: PatchFindOperation | PatchLinesOperation,
  ctx: Ctx,
): Promise<OperationResult> {
  const abs = path.join(ctx.cwd, op.path);
  const exists = await fileExistsAt(abs, ctx);
  if (!exists) {
    return { op, status: 'failed', error: `file not found: ${op.path}` };
  }
  const current = await readFileAt(abs, ctx);

  if (op.mode === 'lines') {
    return applyPatchLines(op, current, abs, ctx);
  }
  return applyPatchFind(op, current, abs, ctx);
}

async function applyPatchFind(
  op: PatchFindOperation,
  current: string,
  abs: string,
  ctx: Ctx,
): Promise<OperationResult> {
  const result = findAllMatches({
    haystack: current,
    needle: op.find,
    mode: op.match,
    scope: op.scope,
    word: op.word,
  });

  if (!result.ok) {
    return { op, status: 'failed', error: result.error.message };
  }

  const matches = result.matches;
  if (matches.length === 0) {
    if (op.replace !== '' && current.includes(op.replace)) {
      return { op, status: 'skipped', reason: 'already applied' };
    }
    return {
      op,
      status: 'failed',
      error: op.scope
        ? 'find block not found in scoped region'
        : 'find block not found in file',
    };
  }

  let toApply: Match[];
  if (op.all) {
    toApply = matches;
  } else if (op.first) {
    toApply = [matches[0]];
  } else {
    if (matches.length > 1) {
      return {
        op,
        status: 'failed',
        error: `find block matches ${matches.length} locations; add a scope, or use 'first: true' or 'all: true'`,
      };
    }
    toApply = matches;
  }

  const sorted = [...toApply].sort((a, b) => b.start - a.start);
  let next = current;
  for (const m of sorted) {
    next = next.slice(0, m.start) + op.replace + next.slice(m.end);
  }

  const firstMatch = toApply[0];
  const diff = {
    before: current.slice(firstMatch.start, firstMatch.end),
    after: op.replace,
  };
  const matchCount = toApply.length;

  if (next === current) {
    return { op, status: 'skipped', reason: 'no change' };
  }

  if (ctx.dryRun) {
    await writeFileAt(abs, next, ctx);
    return { op, status: 'would-apply', diff, matchCount };
  }

  await backupFile(abs, ctx);
  await fs.writeFile(abs, next, 'utf8');
  return { op, status: 'ok', diff, matchCount };
}

async function applyPatchLines(
  op: PatchLinesOperation,
  current: string,
  abs: string,
  ctx: Ctx,
): Promise<OperationResult> {
  const { lines, offsets } = splitLinesWithOffsets(current);
  const lineCount = lines.length;

  if (op.from > lineCount || op.to > lineCount) {
    return {
      op,
      status: 'failed',
      error: `lines ${op.from}..${op.to} out of range (file has ${lineCount} lines)`,
    };
  }

  const startOffset = offsets[op.from - 1];
  const lastLineIdx = op.to - 1;
  const endOffset = offsets[lastLineIdx] + lines[lastLineIdx].length;
  const after = current[endOffset] === '\n' ? endOffset + 1 : endOffset;

  const before = current.slice(startOffset, after);
  const next = current.slice(0, startOffset) + op.content + current.slice(after);
  const diff = { before, after: op.content };

  if (next === current) {
    return { op, status: 'skipped', reason: 'no change' };
  }

  if (ctx.dryRun) {
    await writeFileAt(abs, next, ctx);
    return { op, status: 'would-apply', diff };
  }

  await backupFile(abs, ctx);
  await fs.writeFile(abs, next, 'utf8');
  return { op, status: 'ok', diff };
}

async function readFileAt(abs: string, ctx: Ctx): Promise<string> {
  const v = ctx.virtualFiles.get(abs);
  if (v !== undefined) return v;
  if (isUnderDeleted(abs, ctx)) throw new Error(`file not found: ${abs}`);
  return fs.readFile(abs, 'utf8');
}

async function fileExistsAt(abs: string, ctx: Ctx): Promise<boolean> {
  if (ctx.virtualFiles.has(abs)) return true;
  if (isUnderDeleted(abs, ctx)) return false;
  if (ctx.createdDirs.has(abs)) return true;
  return pathExists(abs);
}

async function isDirectoryAt(abs: string, ctx: Ctx): Promise<boolean> {
  if (ctx.createdDirs.has(abs)) return true;
  for (const f of ctx.virtualFiles.keys()) {
    if (path.dirname(f) === abs) return true;
  }
  try {
    const s = await fs.stat(abs);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function listDirAt(abs: string, ctx: Ctx): Promise<string[]> {
  if (isUnderDeleted(abs, ctx)) return [];

  const set = new Set<string>();

  if (await pathExists(abs)) {
    try {
      for (const name of await fs.readdir(abs)) set.add(name);
    } catch {
      /* not a directory on disk */
    }
  }

  for (const f of ctx.virtualFiles.keys()) {
    if (path.dirname(f) === abs) set.add(path.basename(f));
  }
  for (const d of ctx.createdDirs) {
    if (path.dirname(d) === abs) set.add(path.basename(d));
  }
  for (const d of ctx.deletedPaths) {
    if (path.dirname(d) === abs) set.delete(path.basename(d));
  }

  return Array.from(set).sort();
}


async function writeFileAt(abs: string, content: string, ctx: Ctx): Promise<void> {
  if (ctx.dryRun) {
    ctx.virtualFiles.set(abs, content);
    ctx.deletedPaths.delete(abs);
  } else {
    await fs.writeFile(abs, content, 'utf8');
  }
}

async function mkdirAt(abs: string, ctx: Ctx): Promise<void> {
  if (ctx.dryRun) {
    ctx.createdDirs.add(abs);
    ctx.deletedPaths.delete(abs);
  } else {
    await fs.mkdir(abs, { recursive: true });
  }
}

async function deleteAt(abs: string, ctx: Ctx): Promise<void> {
  if (ctx.dryRun) {
    ctx.deletedPaths.add(abs);
    ctx.createdDirs.delete(abs);
    for (const key of Array.from(ctx.virtualFiles.keys())) {
      if (isUnderPath(key, abs)) ctx.virtualFiles.delete(key);
    }
    for (const key of Array.from(ctx.createdDirs)) {
      if (isUnderPath(key, abs)) ctx.createdDirs.delete(key);
    }
    return;
  }
  await fs.rm(abs, { recursive: true, force: true });
}

function isUnderDeleted(abs: string, ctx: Ctx): boolean {
  for (const del of ctx.deletedPaths) {
    if (abs === del || isUnderPath(abs, del)) return true;
  }
  return false;
}

function isUnderPath(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

async function backupFile(abs: string, ctx: Ctx): Promise<void> {
  if (!ctx.backupRoot) return;
  if (!ctx.backupCreated) {
    await fs.mkdir(ctx.backupRoot, { recursive: true });
    ctx.backupCreated = true;
  }
  const rel = path.relative(ctx.cwd, abs);
  const dest = path.join(ctx.backupRoot, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(abs, dest);
}

function splitLinesWithOffsets(text: string): {
  lines: string[];
  offsets: number[];
} {
  const lines: string[] = [];
  const offsets: number[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i));
      offsets.push(start);
      start = i + 1;
    }
  }
  lines.push(text.slice(start));
  offsets.push(start);
  return { lines, offsets };
}

function normalizeWS(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function globBase(pattern: string): string {
  const parts = pattern.split('/');
  const base: string[] = [];
  for (const p of parts) {
    if (p.includes('*') || p.includes('?')) break;
    base.push(p);
  }
  return base.join('/');
}

function globToRegex(pattern: string): RegExp {
  let re = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (/[a-zA-Z0-9_\-/]/.test(c)) {
      re += c;
      i++;
    } else {
      re += '\\' + c;
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

const SEARCH_SKIP = new Set(['node_modules', '.git', '.graft']);

async function walkTree(abs: string, ctx: Ctx): Promise<string[]> {
  const results: string[] = [];
  for (const name of await listDirAt(abs, ctx)) {
    if (SEARCH_SKIP.has(name)) continue;
    const child = path.join(abs, name);
    if (await isDirectoryAt(child, ctx)) results.push(...await walkTree(child, ctx));
    else results.push(child);
  }
  return results;
}

async function collectFiles(ctx: Ctx, pathAttr: string): Promise<string[]> {
  const hasGlob = pathAttr.includes('*') || pathAttr.includes('?');
  if (hasGlob) {
    const base = globBase(pathAttr) || '.';
    const baseAbs = path.join(ctx.cwd, base);
    const re = globToRegex(pathAttr);
    const out: string[] = [];
    for (const f of await walkTree(baseAbs, ctx)) {
      const rel = path.relative(ctx.cwd, f).replace(/\\/g, '/');
      if (re.test(rel)) out.push(f);
    }
    return out;
  }
  const abs = path.join(ctx.cwd, pathAttr);
  if (!await fileExistsAt(abs, ctx)) return [];
  if (await isDirectoryAt(abs, ctx)) return walkTree(abs, ctx);
  return [abs];
}

async function applyRead(op: ReadOperation, ctx: Ctx): Promise<OperationResult> {
  const abs = path.join(ctx.cwd, op.path);
  if (!await fileExistsAt(abs, ctx)) {
    return { op, status: 'failed', error: `file not found: ${op.path}` };
  }
  if (await isDirectoryAt(abs, ctx)) {
    return { op, status: 'failed', error: `path is a directory: ${op.path}` };
  }

  const content = await readFileAt(abs, ctx);
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  let from: number, to: number;
  if (op.from !== undefined && op.to !== undefined) {
    from = op.from;
    to = op.to;
    if (from > lines.length || to > lines.length) {
      return {
        op, status: 'failed',
        error: `lines ${from}..${to} out of range (file has ${lines.length} lines)`,
      };
    }
  } else {
    from = 1;
    to = lines.length;
  }

  const width = String(to).length;
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    out.push(`${String(i).padStart(width, ' ')}: ${lines[i - 1] ?? ''}`);
  }
  return { op, status: 'ok', output: out.join('\n') };
}

async function applySearch(op: SearchOperation, ctx: Ctx): Promise<OperationResult> {
  let regex: RegExp | undefined;
  if (op.match === 'regex') {
    try { regex = new RegExp(op.pattern); }
    catch (e) {
      return { op, status: 'failed', error: `invalid regex: ${(e as Error).message}` };
    }
  }

  const files = await collectFiles(ctx, op.path);
  const c = op.context ?? 0;
  const out: string[] = [];
  let total = 0;

  for (const abs of files) {
    let content: string;
    try { content = await readFileAt(abs, ctx); } catch { continue; }
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const hits: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let hit: boolean;
      if (regex) hit = regex.test(line);
      else if (op.match === 'normalized') hit = normalizeWS(line).includes(normalizeWS(op.pattern));
      else hit = line.includes(op.pattern);
      if (hit) hits.push(i + 1);
    }
    if (hits.length === 0) continue;
    total += hits.length;

    const rel = path.relative(ctx.cwd, abs).replace(/\\/g, '/');

    if (c === 0) {
      for (const ln of hits) out.push(`${rel}:${ln}: ${lines[ln - 1]}`);
      continue;
    }

    out.push(`--- ${rel} ---`);
    const hitSet = new Set(hits);
    const ranges: [number, number][] = [];
    for (const ln of hits) {
      const s = Math.max(1, ln - c);
      const e = Math.min(lines.length, ln + c);
      const last = ranges[ranges.length - 1];
      if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
      else ranges.push([s, e]);
    }
    for (let r = 0; r < ranges.length; r++) {
      const [s, e] = ranges[r];
      for (let ln = s; ln <= e; ln++) {
        const marker = hitSet.has(ln) ? '>' : ' ';
        out.push(`${rel}:${ln}:${marker} ${lines[ln - 1]}`);
      }
      if (r < ranges.length - 1) out.push('...');
    }
  }

  const label = total === 1 ? 'match' : 'matches';
  return {
    op, status: 'ok',
    output: [`${total} ${label}`, ...out].join('\n'),
    matchCount: total,
  };
}

async function applyList(op: ListOperation, ctx: Ctx): Promise<OperationResult> {
  const abs = path.join(ctx.cwd, op.path);
  if (!await fileExistsAt(abs, ctx)) {
    return { op, status: 'failed', error: `directory not found: ${op.path}` };
  }
  if (!await isDirectoryAt(abs, ctx)) {
    return { op, status: 'failed', error: `not a directory: ${op.path}` };
  }

  const exts = op.extensions ?? [];
  const exSet = new Set(op.exclude ?? []);
  const names: string[] = [];
  for (const name of await listDirAt(abs, ctx)) {
    if (exSet.has(name)) continue;
    const childAbs = path.join(abs, name);
    const isDir = await isDirectoryAt(childAbs, ctx);
    if (!isDir && exts.length > 0) {
      if (!exts.some(ext => name.endsWith(ext))) continue;
    }
    names.push(isDir ? name + '/' : name);
  }

  const label = names.length === 1 ? 'entry' : 'entries';
  return {
    op, status: 'ok',
    output: [`${names.length} ${label}`, ...names].join('\n'),
  };
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}
