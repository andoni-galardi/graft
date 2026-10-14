import { describe, expect, it } from 'vitest';
import { findAllMatches, findMatches } from '../src/core/matcher.js';

describe('findMatches — exact', () => {
  it('encuentra una ocurrencia única', () => {
    expect(findMatches('hola mundo', 'mundo', 'exact')).toEqual([
      { start: 5, end: 10 },
    ]);
  });

  it('encuentra múltiples ocurrencias', () => {
    expect(findMatches('aXbXc', 'X', 'exact')).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
  });

  it('devuelve [] si no encuentra', () => {
    expect(findMatches('hola', 'adios', 'exact')).toEqual([]);
  });

  it('encuentra bloques multilínea', () => {
    const hay = 'line1\nline2\nline3\n';
    expect(findMatches(hay, 'line2\nline3\n', 'exact')).toEqual([
      { start: 6, end: 18 },
    ]);
  });

  it('needle vacío devuelve []', () => {
    expect(findMatches('abc', '', 'exact')).toEqual([]);
  });
});

describe('findMatches — normalized', () => {
  it('ignora diferencias de espacios al inicio y fin de línea', () => {
    const hay = '  return a + b;\n';
    expect(findMatches(hay, 'return a + b;', 'normalized')).toEqual([
      { start: 0, end: 15 },
    ]);
  });

  it('ignora tabulaciones vs espacios', () => {
    const hay = '\t\treturn a + b;\n';
    expect(findMatches(hay, '  return a + b;', 'normalized')).toEqual([
      { start: 0, end: 15 },
    ]);
  });

  it('colapsa espacios internos', () => {
    const hay = 'const   x    =    1;\n';
    expect(findMatches(hay, 'const x = 1;', 'normalized')).toEqual([
      { start: 0, end: 20 },
    ]);
  });

  it('encuentra bloques multilínea', () => {
    const hay = 'a\n  b\nc\n';
    expect(findMatches(hay, 'a\nb\nc\n', 'normalized')).toEqual([
      { start: 0, end: 7 },
    ]);
  });

  it('devuelve múltiples coincidencias', () => {
    const hay = 'foo\nbar\nfoo\nbar\n';
    expect(findMatches(hay, 'foo\nbar\n', 'normalized')).toHaveLength(2);
  });

  it('funciona con CRLF', () => {
    const hay = 'a\r\nb\r\nc\r\n';
    expect(findMatches(hay, 'a\nb\nc\n', 'normalized')).toHaveLength(1);
  });
});

describe('findMatches — regex', () => {
  it('encuentra con pattern simple', () => {
    expect(findMatches('abc123def', '\\d+', 'regex')).toEqual([
      { start: 3, end: 6 },
    ]);
  });

  it('encuentra múltiples', () => {
    expect(findMatches('a1b22c333', '\\d+', 'regex')).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 9 },
    ]);
  });

  it('soporta multiline con ^ y $', () => {
    const hay = 'foo\nbar\nfoo\n';
    expect(findMatches(hay, '^foo$', 'regex')).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it('lanza con pattern inválido', () => {
    expect(() => findMatches('x', '(', 'regex')).toThrow();
  });
});

describe('findAllMatches', () => {
  it('devuelve todos los matches sin scope', () => {
    const r = findAllMatches({ haystack: 'aXbXc', needle: 'X', mode: 'exact' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matches).toHaveLength(2);
  });

  it('error invalid-regex', () => {
    const r = findAllMatches({ haystack: 'x', needle: '(', mode: 'regex' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid-regex');
  });

  describe('scope-after texto', () => {
    const haystack = `function a() {
  return 1;
}
function b() {
  return 2;
}
`;

    it('restringe a después del ancla', () => {
      const r = findAllMatches({
        haystack,
        needle: 'return',
        mode: 'exact',
        scope: { afterText: 'function b' },
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.matches).toHaveLength(1);
        expect(r.matches[0].start).toBeGreaterThan(haystack.indexOf('function b'));
      }
    });

    it('error si el ancla no existe', () => {
      const r = findAllMatches({
        haystack,
        needle: 'return',
        mode: 'exact',
        scope: { afterText: 'function zzz' },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('anchor-not-found');
    });
  });

  describe('scope-before texto', () => {
    const haystack = `function a() {
  return 1;
}
function b() {
  return 2;
}
`;

    it('restringe a antes del ancla', () => {
      const r = findAllMatches({
        haystack,
        needle: 'return',
        mode: 'exact',
        scope: { beforeText: 'function b' },
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.matches).toHaveLength(1);
        expect(r.matches[0].start).toBeLessThan(haystack.indexOf('function b'));
      }
    });
  });

  describe('scope combinado (after + before)', () => {
    const haystack = `A
one
B
two
C
`;

    it('región entre anclas', () => {
      const r = findAllMatches({
        haystack,
        needle: 'two',
        mode: 'exact',
        scope: { afterText: 'B', beforeText: 'C' },
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matches).toHaveLength(1);
    });

    it('falla si el match está fuera de la región', () => {
      const r = findAllMatches({
        haystack,
        needle: 'one',
        mode: 'exact',
        scope: { afterText: 'B', beforeText: 'C' },
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matches).toHaveLength(0);
    });
  });

  describe('scope por líneas', () => {
    const haystack = 'l1\nl2\nl3\nl4\nl5\n';

    it('afterLine excluye las líneas anteriores', () => {
      const r = findAllMatches({
        haystack,
        needle: 'l4',
        mode: 'exact',
        scope: { afterLine: 3 },
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matches).toHaveLength(1);
    });

    it('beforeLine excluye las líneas posteriores', () => {
      const r = findAllMatches({
        haystack,
        needle: 'l2',
        mode: 'exact',
        scope: { beforeLine: 3 },
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matches).toHaveLength(1);
    });

    it('combinado (línea 2 a 4)', () => {
      const r = findAllMatches({
        haystack,
        needle: 'l',
        mode: 'exact',
        scope: { afterLine: 1, beforeLine: 5 },
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matches).toHaveLength(3);
    });
  });
});
