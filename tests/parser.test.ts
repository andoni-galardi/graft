import { describe, expect, it } from 'vitest';
import { GraftParseError, parseGraftFile } from '../src/core/parser.js';

describe('parseGraftFile', () => {
  it('devuelve [] para archivo vacío', () => {
    expect(parseGraftFile('')).toEqual([]);
  });

  it('ignora comentarios y líneas en blanco', () => {
    expect(parseGraftFile('# c\n\n  # c2\n')).toEqual([]);
  });

  it('parsea mkdir', () => {
    expect(parseGraftFile('[op: mkdir]\npath: src/components\n')).toEqual([
      { op: 'mkdir', path: 'src/components' },
    ]);
  });

  it('parsea delete con recursive', () => {
    expect(
      parseGraftFile('[op: delete]\npath: src/old\nrecursive: true\n'),
    ).toEqual([{ op: 'delete', path: 'src/old', recursive: true }]);
  });

  it('parsea write con contenido', () => {
    const src = `[op: write]
path: src/new.ts
<<<CONTENT
export const x = 1;
CONTENT>>>
`;
    expect(parseGraftFile(src)).toEqual([
      {
        op: 'write',
        path: 'src/new.ts',
        content: 'export const x = 1;\n',
        encoding: undefined,
      },
    ]);
  });

  it('parsea rename', () => {
    expect(parseGraftFile('[op: rename]\npath: a.ts\nto: b.ts\n')).toEqual([
      { op: 'rename', path: 'a.ts', to: 'b.ts' },
    ]);
  });

  it('error: rename sin to', () => {
    expect(() => parseGraftFile('[op: rename]\npath: a.ts\n')).toThrow(
      /requires 'to'/,
    );
  });

  it('parsea copy', () => {
    expect(parseGraftFile('[op: copy]\npath: a.ts\nto: b.ts\n')).toEqual([
      { op: 'copy', path: 'a.ts', to: 'b.ts' },
    ]);
  });

  it('parsea append', () => {
    const src = `[op: append]
path: a.txt
<<<CONTENT
line
CONTENT>>>
`;
    expect(parseGraftFile(src)).toEqual([
      { op: 'append', path: 'a.txt', content: 'line\n' },
    ]);
  });

  it('parsea prepend', () => {
    const src = `[op: prepend]
path: a.txt
<<<CONTENT
header
CONTENT>>>
`;
    expect(parseGraftFile(src)).toEqual([
      { op: 'prepend', path: 'a.txt', content: 'header\n' },
    ]);
  });

  it('parsea insert-after', () => {
    const src = `[op: insert-after]
path: a.ts
anchor: 'import x'
<<<CONTENT
import y
CONTENT>>>
`;
    expect(parseGraftFile(src)[0]).toMatchObject({
      op: 'insert-after',
      path: 'a.ts',
      anchor: 'import x',
      content: 'import y\n',
      match: 'exact',
    });
  });

  it('parsea insert-before con match', () => {
    const src = `[op: insert-before]
path: a.ts
anchor: 'function z'
match: normalized
<<<CONTENT
// comment
CONTENT>>>
`;
    expect(parseGraftFile(src)[0]).toMatchObject({
      op: 'insert-before',
      anchor: 'function z',
      match: 'normalized',
    });
  });

  it('error: insert-after sin anchor', () => {
    const src = `[op: insert-after]
path: a.ts
<<<CONTENT
x
CONTENT>>>
`;
    expect(() => parseGraftFile(src)).toThrow(/requires 'anchor'/);
  });

  it('parsea patch find mode', () => {
    const src = `[op: patch]
path: src/a.ts
<<<FIND
old
FIND>>>
<<<REPLACE
new
REPLACE>>>
`;
    expect(parseGraftFile(src)[0]).toMatchObject({
      op: 'patch',
      mode: 'find',
      match: 'exact',
      find: 'old\n',
      replace: 'new\n',
    });
  });

  it('parsea patch con scope-after', () => {
    const src = `[op: patch]
path: src/a.ts
scope-after: 'export function add'
<<<FIND
  return a + b;
FIND>>>
<<<REPLACE
  return a + b; // sum
REPLACE>>>
`;
    expect(parseGraftFile(src)[0]).toMatchObject({
      op: 'patch',
      mode: 'find',
      scope: { afterText: 'export function add' },
    });
  });

  it('parsea patch con scope-after y scope-before combinados', () => {
    const src = `[op: patch]
path: src/a.ts
scope-after: 'function add'
scope-before: 'function remove'
<<<FIND
  return a + b;
FIND>>>
<<<REPLACE
  return a + b; // sum
REPLACE>>>
`;
    expect(parseGraftFile(src)[0]).toMatchObject({
      op: 'patch',
      scope: { afterText: 'function add', beforeText: 'function remove' },
    });
  });

  it('parsea patch con scope por líneas', () => {
    const src = `[op: patch]
path: src/a.ts
scope-after-line: 10
scope-before-line: 50
<<<FIND
foo
FIND>>>
<<<REPLACE
bar
REPLACE>>>
`;
    expect(parseGraftFile(src)[0]).toMatchObject({
      op: 'patch',
      scope: { afterLine: 10, beforeLine: 50 },
    });
  });

  it('parsea first y all', () => {
    const src = `[op: patch]
path: src/a.ts
first: true
<<<FIND
foo
FIND>>>
<<<REPLACE
bar
REPLACE>>>
`;
    expect(parseGraftFile(src)[0]).toMatchObject({ first: true, all: undefined });

    const src2 = src.replace('first: true', 'all: true');
    expect(parseGraftFile(src2)[0]).toMatchObject({ first: undefined, all: true });
  });

  it('error: first y all juntos', () => {
    const src = `[op: patch]
path: src/a.ts
first: true
all: true
<<<FIND
foo
FIND>>>
<<<REPLACE
bar
REPLACE>>>
`;
    expect(() => parseGraftFile(src)).toThrow(/mutually exclusive/);
  });

  it('parsea patch en modo lines', () => {
    const src = `[op: patch]
path: src/a.ts
lines: 10..12
<<<CONTENT
new line
CONTENT>>>
`;
    expect(parseGraftFile(src)[0]).toMatchObject({
      op: 'patch',
      mode: 'lines',
      from: 10,
      to: 12,
      content: 'new line\n',
    });
  });

  it('parsea múltiples operaciones', () => {
    const src = `[op: mkdir]
path: a

[op: mkdir]
path: b
`;
    expect(parseGraftFile(src)).toHaveLength(2);
  });

  it('preserva línea en blanco al final del contenido', () => {
    const src = `[op: write]
path: x
<<<CONTENT
line1

CONTENT>>>
`;
    expect(parseGraftFile(src)[0]).toMatchObject({ content: 'line1\n\n' });
  });

  it('acepta bloque REPLACE vacío', () => {
    const src = `[op: patch]
path: x
<<<FIND
gone
FIND>>>
<<<REPLACE
REPLACE>>>
`;
    expect(parseGraftFile(src)[0]).toMatchObject({ replace: '' });
  });

  it('preserva comentarios dentro de bloques', () => {
    const src = `[op: patch]
path: x
<<<FIND
# not a comment for the parser
FIND>>>
<<<REPLACE
# neither is this
REPLACE>>>
`;
    const op = parseGraftFile(src)[0] as {
      op: 'patch';
      find: string;
      replace: string;
    };
    expect(op.find).toBe('# not a comment for the parser\n');
    expect(op.replace).toBe('# neither is this\n');
  });

  it('acepta CRLF', () => {
    expect(parseGraftFile('[op: mkdir]\r\npath: a\r\n')).toEqual([
      { op: 'mkdir', path: 'a' },
    ]);
  });

  it('error: operación desconocida', () => {
    expect(() => parseGraftFile('[op: fly]\npath: x\n')).toThrow(GraftParseError);
  });

  it('error: falta path', () => {
    expect(() => parseGraftFile('[op: mkdir]\n')).toThrow(/requires 'path'/);
  });

  it('error: bloque sin cerrar', () => {
    const src = `[op: write]
path: x
<<<CONTENT
line
`;
    expect(() => parseGraftFile(src)).toThrow(/unterminated/);
  });

  it('error: cabecera malformada', () => {
    expect(() => parseGraftFile('### op: mkdir\npath: x\n')).toThrow(
      /expected '\[op: <name>\]' header/,
    );
  });

  it('error: atributo desconocido', () => {
    expect(() => parseGraftFile('[op: mkdir]\npath: x\nfoo: bar\n')).toThrow(
      /does not accept attribute/,
    );
  });

  it('error: bloque no permitido', () => {
    expect(() =>
      parseGraftFile('[op: mkdir]\npath: x\n<<<CONTENT\ny\nCONTENT>>>\n'),
    ).toThrow(/does not accept block/);
  });

  it('error: match inválido', () => {
    const src = `[op: patch]
path: x
match: bogus
<<<FIND
f
FIND>>>
<<<REPLACE
r
REPLACE>>>
`;
    expect(() => parseGraftFile(src)).toThrow(/invalid 'match'/);
  });

  it('error: formato lines inválido', () => {
    const src = `[op: patch]
path: x
lines: nope
<<<CONTENT
c
CONTENT>>>
`;
    expect(() => parseGraftFile(src)).toThrow(/invalid 'lines'/);
  });

  it('error: first no booleano', () => {
    const src = `[op: patch]
path: x
first: yes
<<<FIND
f
FIND>>>
<<<REPLACE
r
REPLACE>>>
`;
    expect(() => parseGraftFile(src)).toThrow(/must be 'true' or 'false'/);
  });
});
