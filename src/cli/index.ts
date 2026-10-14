#!/usr/bin/env node
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraftParseError, parseGraftFile } from '../core/parser.js';
import { applyOperations } from '../core/engine.js';
import type { OperationResult, OperationStatus } from '../core/types.js';

interface CliOptions {
  command: 'apply' | 'check' | 'help' | 'version';
  file?: string;
  cwd: string;
  dryRun: boolean;
  force: boolean;
  backup: boolean;
  json: boolean;
  quiet: boolean;
}

const USAGE = `graft — apply flexible change files to a project

Usage:
  graft apply <file>   Apply operations from a .graft file
  graft check <file>   Parse and validate without touching anything
  graft <file>         Shorthand for 'graft apply <file>'
  graft --help         Show this help
  graft --version      Show version

Options:
  --cwd <dir>          Base directory for operations (default: current dir)
  --dry-run, -n        Show what would happen, write nothing
  --force, -f          Reserved for future use (currently no-op)
  --backup, -b         Save originals to .graft/backups/<timestamp>/
  --json               Output machine-readable JSON instead of text
  --quiet, -q          Suppress per-operation output (only show summary)

Exit codes:
  0  all operations ok, skipped, or would-apply (dry-run)
  1  at least one operation failed
  2  usage or parse error
`;

interface JsonOutput {
  ok: boolean;
  file: string;
  cwd: string;
  dryRun: boolean;
  parseError?: string;
  results?: Array<{
    op: string;
    path: string;
    status: OperationStatus;
    reason?: string;
    error?: string;
    matchCount?: number;
    diff?: { before: string; after: string };
  }>;
  summary?: Record<OperationStatus, number>;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }

  switch (opts.command) {
    case 'help':
      process.stdout.write(USAGE);
      process.exit(0);
      break;
    case 'version':
      process.stdout.write(`${readVersion()}\n`);
      process.exit(0);
      break;
    case 'check':
      process.exit(await runCheck(opts));
      break;
    case 'apply':
      process.exit(await runApply(opts));
      break;
  }
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    command: 'help',
    cwd: process.cwd(),
    dryRun: false,
    force: false,
    backup: false,
    json: false,
    quiet: false,
  };

  let i = 0;
  const positionals: string[] = [];

  while (i < argv.length) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      opts.command = 'help';
      return opts;
    }
    if (a === '--version' || a === '-V') {
      opts.command = 'version';
      return opts;
    }
    if (a === '--dry-run' || a === '-n') {
      opts.dryRun = true;
      i++;
      continue;
    }
    if (a === '--force' || a === '-f') {
      opts.force = true;
      i++;
      continue;
    }
    if (a === '--backup' || a === '-b') {
      opts.backup = true;
      i++;
      continue;
    }
    if (a === '--json') {
      opts.json = true;
      i++;
      continue;
    }
    if (a === '--quiet' || a === '-q') {
      opts.quiet = true;
      i++;
      continue;
    }
    if (a === '--cwd') {
      const v = argv[i + 1];
      if (!v) throw new Error('--cwd requires a value');
      opts.cwd = path.resolve(v);
      i += 2;
      continue;
    }
    if (a.startsWith('--cwd=')) {
      opts.cwd = path.resolve(a.slice('--cwd='.length));
      i++;
      continue;
    }
    if (a.startsWith('-')) {
      throw new Error(`unknown option '${a}'`);
    }
    positionals.push(a);
    i++;
  }

  if (positionals.length === 0) {
    opts.command = 'help';
    return opts;
  }

  const first = positionals[0];
  if (first === 'apply' || first === 'check') {
    if (!positionals[1]) throw new Error(`command '${first}' requires a file argument`);
    opts.command = first;
    opts.file = positionals[1];
    if (positionals.length > 2) {
      throw new Error(`unexpected extra arguments: ${positionals.slice(2).join(' ')}`);
    }
  } else {
    opts.command = 'apply';
    opts.file = first;
    if (positionals.length > 1) {
      throw new Error(`unexpected extra arguments: ${positionals.slice(1).join(' ')}`);
    }
  }

  return opts;
}

async function runCheck(opts: CliOptions): Promise<number> {
  const file = opts.file!;
  let source: string;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch {
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({ ok: false, file, cwd: opts.cwd, dryRun: false, parseError: `cannot read file '${file}'` }) + '\n',
      );
    } else {
      console.error(`error: cannot read file '${file}'`);
    }
    return 2;
  }
  try {
    const ops = parseGraftFile(source, file);
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({ ok: true, file, cwd: opts.cwd, dryRun: false, operationCount: ops.length }) + '\n',
      );
    } else {
      process.stdout.write(
        `${file}: OK (${ops.length} operation${ops.length === 1 ? '' : 's'})\n`,
      );
    }
    return 0;
  } catch (e) {
    if (e instanceof GraftParseError) {
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({ ok: false, file, cwd: opts.cwd, dryRun: false, parseError: e.message }) + '\n',
        );
      } else {
        console.error(`error: ${e.message}`);
      }
      return 2;
    }
    throw e;
  }
}

async function runApply(opts: CliOptions): Promise<number> {
  const file = opts.file!;
  let source: string;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch {
    emitJsonError(opts, file, `cannot read file '${file}'`);
    return 2;
  }

  let results: OperationResult[];
  try {
    const ops = parseGraftFile(source, file);
    if (ops.length === 0) {
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({
            ok: true,
            file,
            cwd: opts.cwd,
            dryRun: opts.dryRun,
            results: [],
            summary: { ok: 0, skipped: 0, 'would-apply': 0, failed: 0 },
          }) + '\n',
        );
      } else {
        process.stdout.write(`${file}: no operations\n`);
      }
      return 0;
    }

    if (!opts.json && !opts.quiet) {
      const mode = opts.dryRun ? ' (dry-run)' : '';
      process.stdout.write(
        `graft: applying ${ops.length} operation${ops.length === 1 ? '' : 's'}${mode}\n`,
      );
      process.stdout.write(`cwd: ${opts.cwd}\n\n`);
    }

    results = await applyOperations(ops, {
      cwd: opts.cwd,
      dryRun: opts.dryRun,
      force: opts.force,
      backup: opts.backup,
    });
  } catch (e) {
    if (e instanceof GraftParseError) {
      emitJsonError(opts, file, e.message);
      return 2;
    }
    throw e;
  }

  const counts = { ok: 0, skipped: 0, 'would-apply': 0, failed: 0 } as Record<
    OperationStatus,
    number
  >;
  for (const r of results) counts[r.status]++;

  if (opts.json) {
    const out: JsonOutput = {
      ok: counts.failed === 0,
      file,
      cwd: opts.cwd,
      dryRun: opts.dryRun,
      results: results.map((r) => ({
        op: r.op.op,
        path: pathFromOp(r),
        status: r.status,
        reason: r.reason,
        error: r.error,
        matchCount: r.matchCount,
        diff: r.diff,
      })),
      summary: counts,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    if (!opts.quiet) {
      for (const r of results) printResult(r);
      process.stdout.write('\n');
    }
    const parts: string[] = [];
    if (counts.ok) parts.push(`${counts.ok} ok`);
    if (counts.skipped) parts.push(`${counts.skipped} skipped`);
    if (counts['would-apply']) parts.push(`${counts['would-apply']} would-apply`);
    if (counts.failed) parts.push(`${counts.failed} failed`);
    process.stdout.write(parts.join(' · ') + '\n');
  }

  return counts.failed > 0 ? 1 : 0;
}

function emitJsonError(opts: CliOptions, file: string, message: string): void {
  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        file,
        cwd: opts.cwd,
        dryRun: opts.dryRun,
        parseError: message,
      }) + '\n',
    );
  } else {
    console.error(`error: ${message}`);
  }
}

function pathFromOp(r: OperationResult): string {
  const op = r.op;
  switch (op.op) {
    case 'rename':
    case 'copy':
      return `${op.path} -> ${op.to}`;
    default:
      return op.path;
  }
}

function printResult(r: OperationResult): void {
  const mark = statusMark(r.status);
  const desc = describeOp(r);
  const tail =
    r.status === 'failed' ? ` — ${r.error}` : r.reason ? ` — ${r.reason}` : '';
  const count =
    r.matchCount !== undefined && r.matchCount > 1 ? ` (${r.matchCount} matches)` : '';
  process.stdout.write(`  ${mark} ${desc}${count}${tail}\n`);

  if (r.diff && (r.status === 'ok' || r.status === 'would-apply')) {
    printDiffLines('-', r.diff.before);
    printDiffLines('+', r.diff.after);
  }
}

function printDiffLines(prefix: string, text: string): void {
  if (text.length === 0) return;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    process.stdout.write(`      ${prefix} ${line}\n`);
  }
}

function statusMark(s: OperationStatus): string {
  const useColor = process.stdout.isTTY === true;
  const wrap = (code: number, txt: string) =>
    useColor ? `\x1b[${code}m${txt}\x1b[0m` : txt;
  switch (s) {
    case 'ok':
      return wrap(32, '✓');
    case 'skipped':
      return wrap(33, '-');
    case 'would-apply':
      return wrap(36, '~');
    case 'failed':
      return wrap(31, '✗');
    default:
      return '?';
  }
}

function describeOp(r: OperationResult): string {
  const op = r.op;
  switch (op.op) {
    case 'mkdir':
      return `mkdir ${op.path}`;
    case 'delete':
      return `delete ${op.path}${op.recursive ? ' (recursive)' : ''}`;
    case 'write':
      return `write ${op.path}`;
    case 'rename':
      return `rename ${op.path} -> ${op.to}`;
    case 'copy':
      return `copy ${op.path} -> ${op.to}`;
    case 'append':
      return `append ${op.path}`;
    case 'prepend':
      return `prepend ${op.path}`;
    case 'insert-after':
      return `insert-after ${op.path}`;
    case 'insert-before':
      return `insert-before ${op.path}`;
    case 'patch':
      return op.mode === 'lines'
        ? `patch ${op.path} (lines ${op.from}..${op.to})`
        : `patch ${op.path}`;
    default: {
      const exhaustive: never = op;
      return String((exhaustive as { op: string }).op);
    }
  }
}

function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

main().catch((e) => {
  console.error(`error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(2);
});
