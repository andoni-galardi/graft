import type { MatchMode, Operation, Scope } from './types.js';

export class GraftParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly file?: string,
  ) {
    super(file ? `${file}:${line}: ${message}` : `line ${line}: ${message}`);
    this.name = 'GraftParseError';
  }
}

const ALLOWED_ATTRS: Record<string, readonly string[]> = {
  mkdir: ['path'],
  delete: ['path', 'recursive'],
  write: ['path', 'encoding'],
  rename: ['path', 'to'],
  copy: ['path', 'to'],
  append: ['path'],
  prepend: ['path'],
  'insert-after': ['path', 'anchor', 'match', 'inline'],
  'insert-before': ['path', 'anchor', 'match', 'inline'],
  patch: [
    'path',
    'match',
    'scope-after',
    'scope-before',
    'scope-after-line',
    'scope-before-line',
    'first',
    'all',
    'word',
    'lines',
  ],
};

const ALLOWED_BLOCKS: Record<string, readonly string[]> = {
  mkdir: [],
  delete: [],
  write: ['CONTENT'],
  rename: [],
  copy: [],
  append: ['CONTENT'],
  prepend: ['CONTENT'],
  'insert-after': ['CONTENT'],
  'insert-before': ['CONTENT'],
  patch: ['CONTENT', 'FIND', 'REPLACE'],
};

const HEADER_RE = /^\[op:\s*([a-z][a-z0-9-]*)\]\s*$/;

interface RawOperation {
  opName: string;
  attrs: Record<string, string>;
  blocks: Record<string, string>;
  startLine: number;
}

function parseHeader(trimmed: string): string | null {
  const m = HEADER_RE.exec(trimmed);
  return m ? m[1] : null;
}

function isComment(trimmed: string): boolean {
  return trimmed.startsWith('#');
}

export function parseGraftFile(source: string, filename?: string): Operation[] {
  const lines = source.split(/\r?\n/);
  const operations: Operation[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === '' || isComment(trimmed)) {
      i++;
      continue;
    }

    const opName = parseHeader(trimmed);
    if (!opName) {
      throw new GraftParseError(`expected '[op: <name>]' header`, i + 1, filename);
    }
    if (!(opName in ALLOWED_ATTRS)) {
      throw new GraftParseError(`unknown operation '${opName}'`, i + 1, filename);
    }

    const { raw, nextIndex } = readOperationBody(lines, i + 1, opName, i + 1, filename);
    operations.push(buildOperation(raw, filename));
    i = nextIndex;
  }

  return operations;
}

function readOperationBody(
  lines: string[],
  startIdx: number,
  opName: string,
  headerLine: number,
  filename?: string,
): { raw: RawOperation; nextIndex: number } {
  const attrs: Record<string, string> = {};
  const blocks: Record<string, string> = {};
  const allowedAttrs = ALLOWED_ATTRS[opName];
  const allowedBlocks = ALLOWED_BLOCKS[opName];
  let i = startIdx;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (parseHeader(trimmed)) break;

    if (trimmed === '' || isComment(trimmed)) {
      i++;
      continue;
    }

    if (trimmed.startsWith('<<<')) {
      const blockName = trimmed.slice(3).trim();
      if (!/^[A-Z][A-Z0-9_]*$/.test(blockName)) {
        throw new GraftParseError(`invalid block name '${blockName}'`, i + 1, filename);
      }
      if (!allowedBlocks.includes(blockName)) {
        throw new GraftParseError(
          `operation '${opName}' does not accept block '${blockName}'`,
          i + 1,
          filename,
        );
      }
      if (blockName in blocks) {
        throw new GraftParseError(`duplicate block '${blockName}'`, i + 1, filename);
      }

      const closer = `${blockName}>>>`;
      const contentLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim() === closer) {
          closed = true;
          break;
        }
        contentLines.push(lines[i]);
        i++;
      }
      if (!closed) {
        throw new GraftParseError(
          `unterminated block '${blockName}' (expected closing '${closer}')`,
          headerLine,
          filename,
        );
      }
      blocks[blockName] = contentLines.length === 0 ? '' : contentLines.join('\n') + '\n';
      i++;
      continue;
    }

    const colon = raw.indexOf(':');
    if (colon === -1) {
      throw new GraftParseError(`expected 'key: value' or '<<<BLOCK'`, i + 1, filename);
    }
    const key = raw.slice(0, colon).trim();
    let value = raw.slice(colon + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"')))
    ) {
      value = value.slice(1, -1);
    }
    if (!allowedAttrs.includes(key)) {
      throw new GraftParseError(
        `operation '${opName}' does not accept attribute '${key}'`,
        i + 1,
        filename,
      );
    }
    if (key in attrs) {
      throw new GraftParseError(`duplicate attribute '${key}'`, i + 1, filename);
    }
    attrs[key] = value;
    i++;
  }

  return { raw: { opName, attrs, blocks, startLine: headerLine }, nextIndex: i };
}

function parseBool(value: string, key: string, line: number, file?: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new GraftParseError(
    `attribute '${key}' must be 'true' or 'false', got '${value}'`,
    line,
    file,
  );
}

function parseNonNegativeInt(
  value: string,
  key: string,
  line: number,
  file?: string,
): number {
  if (!/^\d+$/.test(value)) {
    throw new GraftParseError(
      `attribute '${key}' must be a non-negative integer, got '${value}'`,
      line,
      file,
    );
  }
  return parseInt(value, 10);
}

function parseMatchMode(
  value: string | undefined,
  line: number,
  file?: string,
): MatchMode {
  const v = value ?? 'exact';
  if (v !== 'exact' && v !== 'normalized' && v !== 'regex') {
    throw new GraftParseError(`invalid 'match' value '${v}'`, line, file);
  }
  return v;
}

function requireAttr(
  attrs: Record<string, string>,
  key: string,
  opName: string,
  line: number,
  file?: string,
): string {
  const v = attrs[key];
  if (v === undefined || v === '') {
    throw new GraftParseError(`operation '${opName}' requires '${key}'`, line, file);
  }
  return v;
}

function requireBlock(
  blocks: Record<string, string>,
  name: string,
  opName: string,
  line: number,
  file?: string,
): string {
  const v = blocks[name];
  if (v === undefined) {
    throw new GraftParseError(
      `operation '${opName}' requires a <<<${name} block`,
      line,
      file,
    );
  }
  return v;
}

function buildOperation(raw: RawOperation, filename?: string): Operation {
  const { opName, attrs, blocks, startLine } = raw;
  const L = startLine;

  const path = attrs['path'];
  if (!path) {
    throw new GraftParseError(`operation '${opName}' requires 'path'`, L, filename);
  }

  switch (opName) {
    case 'mkdir':
      return { op: 'mkdir', path };

    case 'delete': {
      const recursive =
        attrs['recursive'] !== undefined
          ? parseBool(attrs['recursive'], 'recursive', L, filename)
          : false;
      return { op: 'delete', path, recursive };
    }

    case 'write': {
      const content = requireBlock(blocks, 'CONTENT', 'write', L, filename);
      return { op: 'write', path, content, encoding: attrs['encoding'] };
    }

    case 'rename': {
      const to = requireAttr(attrs, 'to', 'rename', L, filename);
      return { op: 'rename', path, to };
    }

    case 'copy': {
      const to = requireAttr(attrs, 'to', 'copy', L, filename);
      return { op: 'copy', path, to };
    }

    case 'append': {
      const content = requireBlock(blocks, 'CONTENT', 'append', L, filename);
      return { op: 'append', path, content };
    }

    case 'prepend': {
      const content = requireBlock(blocks, 'CONTENT', 'prepend', L, filename);
      return { op: 'prepend', path, content };
    }

    case 'insert-after': {
      const anchor = requireAttr(attrs, 'anchor', 'insert-after', L, filename);
      const content = requireBlock(blocks, 'CONTENT', 'insert-after', L, filename);
      const match = parseMatchMode(attrs['match'], L, filename);
      const inline =
        attrs['inline'] !== undefined
          ? parseBool(attrs['inline'], 'inline', L, filename)
          : undefined;
      return { op: 'insert-after', path, anchor, content, match, inline };
    }

    case 'insert-before': {
      const anchor = requireAttr(attrs, 'anchor', 'insert-before', L, filename);
      const content = requireBlock(blocks, 'CONTENT', 'insert-before', L, filename);
      const match = parseMatchMode(attrs['match'], L, filename);
      const inline =
        attrs['inline'] !== undefined
          ? parseBool(attrs['inline'], 'inline', L, filename)
          : undefined;
      return { op: 'insert-before', path, anchor, content, match, inline };
    }

    case 'patch': {
      const linesAttr = attrs['lines'];
      const scopeAfter = attrs['scope-after'];
      const scopeBefore = attrs['scope-before'];
      const scopeAfterLine = attrs['scope-after-line'];
      const scopeBeforeLine = attrs['scope-before-line'];
      const firstAttr = attrs['first'];
      const allAttr = attrs['all'];
      const wordAttr = attrs['word'];

      if (linesAttr !== undefined) {
        if (
          scopeAfter !== undefined ||
          scopeBefore !== undefined ||
          scopeAfterLine !== undefined ||
          scopeBeforeLine !== undefined ||
          firstAttr !== undefined ||
          allAttr !== undefined ||
          wordAttr !== undefined ||
          attrs['match'] !== undefined
        ) {
          throw new GraftParseError(
            `'patch' with 'lines' cannot use scope, match, first/all, or word`,
            L,
            filename,
          );
        }
        const m = /^(\d+)\.\.(\d+)$/.exec(linesAttr);
        if (!m) {
          throw new GraftParseError(
            `invalid 'lines' format '${linesAttr}', expected 'N..M'`,
            L,
            filename,
          );
        }
        const from = parseInt(m[1], 10);
        const to = parseInt(m[2], 10);
        if (from < 1 || to < from) {
          throw new GraftParseError(`invalid 'lines' range '${linesAttr}'`, L, filename);
        }
        const content = requireBlock(blocks, 'CONTENT', 'patch', L, filename);
        if (blocks['FIND'] !== undefined || blocks['REPLACE'] !== undefined) {
          throw new GraftParseError(
            `'patch' with 'lines' cannot use FIND/REPLACE blocks`,
            L,
            filename,
          );
        }
        return { op: 'patch', path, mode: 'lines', from, to, content };
      }

      const match = parseMatchMode(attrs['match'], L, filename);
      const find = blocks['FIND'];
      const replace = blocks['REPLACE'];
      if (find === undefined) {
        throw new GraftParseError(`'patch' requires a <<<FIND block`, L, filename);
      }
      if (replace === undefined) {
        throw new GraftParseError(`'patch' requires a <<<REPLACE block`, L, filename);
      }
      if (blocks['CONTENT'] !== undefined) {
        throw new GraftParseError(
          `'patch' in find mode cannot use <<<CONTENT`,
          L,
          filename,
        );
      }

      const scope: Scope = {};
      if (scopeAfter !== undefined) scope.afterText = scopeAfter;
      if (scopeBefore !== undefined) scope.beforeText = scopeBefore;
      if (scopeAfterLine !== undefined) {
        scope.afterLine = parseNonNegativeInt(scopeAfterLine, 'scope-after-line', L, filename);
      }
      if (scopeBeforeLine !== undefined) {
        scope.beforeLine = parseNonNegativeInt(
          scopeBeforeLine,
          'scope-before-line',
          L,
          filename,
        );
      }
      const hasScope =
        scope.afterText !== undefined ||
        scope.beforeText !== undefined ||
        scope.afterLine !== undefined ||
        scope.beforeLine !== undefined;

      if (firstAttr !== undefined && allAttr !== undefined) {
        throw new GraftParseError(`'first' and 'all' are mutually exclusive`, L, filename);
      }
      const first =
        firstAttr !== undefined ? parseBool(firstAttr, 'first', L, filename) : undefined;
      const all = allAttr !== undefined ? parseBool(allAttr, 'all', L, filename) : undefined;
      const word =
        wordAttr !== undefined ? parseBool(wordAttr, 'word', L, filename) : undefined;

      return {
        op: 'patch',
        path,
        mode: 'find',
        match,
        find,
        replace,
        scope: hasScope ? scope : undefined,
        first,
        all,
        word,
      };
    }

    default:
      throw new GraftParseError(`unknown operation '${opName}'`, L, filename);
  }
}
