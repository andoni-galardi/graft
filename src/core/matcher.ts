import type { MatchMode, Scope } from './types.js';

export interface Match {
  start: number;
  end: number;
}

export type MatchErrorKind =
  | 'anchor-not-found'
  | 'region-inverted'
  | 'invalid-regex';

export interface MatchError {
  kind: MatchErrorKind;
  message: string;
}

export interface FindAllOptions {
  haystack: string;
  needle: string;
  mode: MatchMode;
  scope?: Scope;
  word?: boolean;
}

export type FindAllResult =
  | { ok: true; matches: Match[] }
  | { ok: false; error: MatchError };

const WORD_CHAR = /[A-Za-z0-9_]/;

export function findAllMatches(opts: FindAllOptions): FindAllResult {
  let matches: Match[];
  try {
    matches = findMatches(opts.haystack, opts.needle, opts.mode);
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'invalid-regex',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  if (opts.scope) {
    const scoped = applyScope(opts.haystack, matches, opts.scope);
    if (!scoped.ok) return scoped;
    matches = scoped.matches;
  }

  if (opts.word) {
    matches = matches.filter((m) => hasWordBoundaries(opts.haystack, m));
  }

  return { ok: true, matches };
}

export function findMatches(
  haystack: string,
  needle: string,
  mode: MatchMode,
): Match[] {
  switch (mode) {
    case 'exact':
      return findExact(haystack, needle);
    case 'normalized':
      return findNormalized(haystack, needle);
    case 'regex':
      return findRegex(haystack, needle);
  }
}

function findExact(haystack: string, needle: string): Match[] {
  if (needle === '') return [];
  const matches: Match[] = [];
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    matches.push({ start: idx, end: idx + needle.length });
    from = idx + 1;
  }
  return matches;
}

function findNormalized(haystack: string, needle: string): Match[] {
  const needleLines = splitKeepTrailing(needle);
  if (needleLines.length === 0) return [];

  const { lines, offsets } = splitLinesWithOffsets(haystack);
  const hayNorm = lines.map(normalizeLine);
  const needleNorm = needleLines.map(normalizeLine);

  const matches: Match[] = [];
  for (let i = 0; i + needleNorm.length <= hayNorm.length; i++) {
    let ok = true;
    for (let j = 0; j < needleNorm.length; j++) {
      if (hayNorm[i + j] !== needleNorm[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const start = offsets[i];
      const lastLine = i + needleNorm.length - 1;
      const end = offsets[lastLine] + lines[lastLine].length;
      matches.push({ start, end });
    }
  }
  return matches;
}

function findRegex(haystack: string, pattern: string): Match[] {
  const re = new RegExp(pattern, 'gm');
  const matches: Match[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return matches;
}

function hasWordBoundaries(haystack: string, m: Match): boolean {
  const before = m.start > 0 ? haystack[m.start - 1] : '';
  const after = m.end < haystack.length ? haystack[m.end] : '';
  const beforeIsWord = before !== '' && WORD_CHAR.test(before);
  const afterIsWord = after !== '' && WORD_CHAR.test(after);
  return !beforeIsWord && !afterIsWord;
}

function applyScope(
  haystack: string,
  matches: Match[],
  scope: Scope,
): FindAllResult {
  let start = 0;
  let end = haystack.length;

  if (scope.afterText !== undefined) {
    const idx = haystack.indexOf(scope.afterText);
    if (idx === -1) {
      return {
        ok: false,
        error: {
          kind: 'anchor-not-found',
          message: `scope-after anchor not found: ${JSON.stringify(scope.afterText)}`,
        },
      };
    }
    start = Math.max(start, idx + scope.afterText.length);
  }

  if (scope.afterLine !== undefined) {
    const offset = lineStartOffset(haystack, scope.afterLine + 1);
    if (offset === -1) start = haystack.length;
    else start = Math.max(start, offset);
  }

  if (scope.beforeText !== undefined) {
    const idx = haystack.indexOf(scope.beforeText);
    if (idx === -1) {
      return {
        ok: false,
        error: {
          kind: 'anchor-not-found',
          message: `scope-before anchor not found: ${JSON.stringify(scope.beforeText)}`,
        },
      };
    }
    end = Math.min(end, idx);
  }

  if (scope.beforeLine !== undefined) {
    const offset = lineStartOffset(haystack, scope.beforeLine);
    if (offset !== -1) end = Math.min(end, offset);
  }

  if (start > end) {
    return {
      ok: false,
      error: {
        kind: 'region-inverted',
        message: `scope region is empty (start > end)`,
      },
    };
  }

  return {
    ok: true,
    matches: matches.filter((m) => m.start >= start && m.end <= end),
  };
}

function lineStartOffset(text: string, lineNumber: number): number {
  if (lineNumber <= 1) return 0;
  let currentLine = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      currentLine++;
      if (currentLine === lineNumber) return i + 1;
    }
  }
  return -1;
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function splitKeepTrailing(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
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
