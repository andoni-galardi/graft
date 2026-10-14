import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyOperations } from '../src/core/engine.js';
import type { Operation } from '../src/core/types.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'graft-test-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(tmp, rel), 'utf8');
}

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(tmp, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

async function exists(rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(tmp, rel));
    return true;
  } catch {
    return false;
  }
}

describe('applyOperations — mkdir', () => {
  it('crea un directorio', async () => {
    const results = await applyOperations([{ op: 'mkdir', path: 'src/components' }], {
      cwd: tmp,
    });
    expect(results[0].status).toBe('ok');
    expect(await exists('src/components')).toBe(true);
  });

  it('skip si ya existe', async () => {
    await fs.mkdir(path.join(tmp, 'a'));
    const results = await applyOperations([{ op: 'mkdir', path: 'a' }], { cwd: tmp });
    expect(results[0].status).toBe('skipped');
  });

  it('falla si la ruta es un archivo', async () => {
    await write('a', 'contenido');
    const results = await applyOperations([{ op: 'mkdir', path: 'a' }], { cwd: tmp });
    expect(results[0].status).toBe('failed');
  });
});

describe('applyOperations — delete', () => {
  it('elimina un archivo', async () => {
    await write('a.txt', 'hola');
    const results = await applyOperations(
      [{ op: 'delete', path: 'a.txt', recursive: false }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await exists('a.txt')).toBe(false);
  });

  it('skip si no existe', async () => {
    const results = await applyOperations(
      [{ op: 'delete', path: 'no', recursive: false }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('skipped');
  });

  it('falla si el directorio tiene contenido y recursive es false', async () => {
    await write('d/a.txt', 'x');
    const results = await applyOperations(
      [{ op: 'delete', path: 'd', recursive: false }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('failed');
  });

  it('elimina directorio con contenido si recursive es true', async () => {
    await write('d/a.txt', 'x');
    const results = await applyOperations(
      [{ op: 'delete', path: 'd', recursive: true }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await exists('d')).toBe(false);
  });
});

describe('applyOperations — write', () => {
  it('crea archivo nuevo', async () => {
    const results = await applyOperations(
      [{ op: 'write', path: 'a.txt', content: 'hola\n' }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.txt')).toBe('hola\n');
  });

  it('crea directorios intermedios', async () => {
    await applyOperations([{ op: 'write', path: 'src/sub/a.txt', content: 'x' }], {
      cwd: tmp,
    });
    expect(await exists('src/sub/a.txt')).toBe(true);
  });

  it('skip si el contenido es idéntico', async () => {
    await write('a.txt', 'hola\n');
    const results = await applyOperations(
      [{ op: 'write', path: 'a.txt', content: 'hola\n' }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('skipped');
  });

  it('sobreescribe si el contenido es distinto', async () => {
    await write('a.txt', 'viejo');
    const results = await applyOperations(
      [{ op: 'write', path: 'a.txt', content: 'nuevo' }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.txt')).toBe('nuevo');
  });

  it('dry-run no escribe', async () => {
    const results = await applyOperations(
      [{ op: 'write', path: 'a.txt', content: 'x' }],
      { cwd: tmp, dryRun: true },
    );
    expect(results[0].status).toBe('would-apply');
    expect(await exists('a.txt')).toBe(false);
  });
});

describe('applyOperations — rename', () => {
  it('renombra un archivo', async () => {
    await write('a.txt', 'hola');
    const results = await applyOperations([{ op: 'rename', path: 'a.txt', to: 'b.txt' }], {
      cwd: tmp,
    });
    expect(results[0].status).toBe('ok');
    expect(await exists('a.txt')).toBe(false);
    expect(await read('b.txt')).toBe('hola');
  });

  it('mueve un archivo a otra carpeta (crea dirs intermedios)', async () => {
    await write('a.txt', 'hola');
    const results = await applyOperations(
      [{ op: 'rename', path: 'a.txt', to: 'sub/dir/b.txt' }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('sub/dir/b.txt')).toBe('hola');
  });

  it('skip si ya se ha renombrado antes', async () => {
    await write('b.txt', 'hola');
    const results = await applyOperations([{ op: 'rename', path: 'a.txt', to: 'b.txt' }], {
      cwd: tmp,
    });
    expect(results[0].status).toBe('skipped');
    expect(results[0].reason).toMatch(/already renamed/);
  });

  it('falla si el origen no existe y el destino tampoco', async () => {
    const results = await applyOperations([{ op: 'rename', path: 'no.txt', to: 'b.txt' }], {
      cwd: tmp,
    });
    expect(results[0].status).toBe('failed');
  });

  it('falla si el destino ya existe con otro contenido', async () => {
    await write('a.txt', 'uno');
    await write('b.txt', 'dos');
    const results = await applyOperations([{ op: 'rename', path: 'a.txt', to: 'b.txt' }], {
      cwd: tmp,
    });
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toMatch(/destination already exists/);
  });
});

describe('applyOperations — copy', () => {
  it('copia un archivo', async () => {
    await write('a.txt', 'hola');
    const results = await applyOperations([{ op: 'copy', path: 'a.txt', to: 'b.txt' }], {
      cwd: tmp,
    });
    expect(results[0].status).toBe('ok');
    expect(await read('a.txt')).toBe('hola');
    expect(await read('b.txt')).toBe('hola');
  });

  it('skip si el destino ya tiene el mismo contenido', async () => {
    await write('a.txt', 'hola');
    await write('b.txt', 'hola');
    const results = await applyOperations([{ op: 'copy', path: 'a.txt', to: 'b.txt' }], {
      cwd: tmp,
    });
    expect(results[0].status).toBe('skipped');
  });

  it('sobreescribe si el destino tiene otro contenido', async () => {
    await write('a.txt', 'uno');
    await write('b.txt', 'dos');
    const results = await applyOperations([{ op: 'copy', path: 'a.txt', to: 'b.txt' }], {
      cwd: tmp,
    });
    expect(results[0].status).toBe('ok');
    expect(await read('b.txt')).toBe('uno');
  });

  it('falla si el origen no existe', async () => {
    const results = await applyOperations([{ op: 'copy', path: 'no.txt', to: 'b.txt' }], {
      cwd: tmp,
    });
    expect(results[0].status).toBe('failed');
  });
});

describe('applyOperations — append / prepend', () => {
  it('append añade al final', async () => {
    await write('a.txt', 'uno\n');
    const results = await applyOperations(
      [{ op: 'append', path: 'a.txt', content: 'dos\n' }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.txt')).toBe('uno\ndos\n');
  });

  it('append crea el archivo si no existe', async () => {
    const results = await applyOperations(
      [{ op: 'append', path: 'a.txt', content: 'uno\n' }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.txt')).toBe('uno\n');
  });

  it('append skip si ya está al final', async () => {
    await write('a.txt', 'uno\ndos\n');
    const results = await applyOperations(
      [{ op: 'append', path: 'a.txt', content: 'dos\n' }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('skipped');
  });

  it('prepend añade al principio', async () => {
    await write('a.txt', 'uno\n');
    const results = await applyOperations(
      [{ op: 'prepend', path: 'a.txt', content: 'cero\n' }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.txt')).toBe('cero\nuno\n');
  });

  it('prepend crea el archivo si no existe', async () => {
    const results = await applyOperations(
      [{ op: 'prepend', path: 'a.txt', content: 'cero\n' }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.txt')).toBe('cero\n');
  });

  it('prepend skip si ya está al principio', async () => {
    await write('a.txt', 'cero\nuno\n');
    const results = await applyOperations(
      [{ op: 'prepend', path: 'a.txt', content: 'cero\n' }],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('skipped');
  });
});

describe('applyOperations — insert-after / insert-before', () => {
  it('insert-after con ancla que incluye \\n: coloca justo después', async () => {
    await write('a.ts', 'A\nB\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'B\n',
          content: 'NEW\n',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('A\nB\nNEW\nC\n');
  });

  it('insert-after con ancla SIN \\n: sigue colocando en su propia línea', async () => {
    await write('a.ts', 'A\nB\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW\n',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('A\nB\nNEW\nC\n');
  });

  it('insert-after con contenido sin \\n: lo añade automáticamente', async () => {
    await write('a.ts', 'A\nB\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('A\nB\nNEW\nC\n');
  });

  it('insert-after al final del archivo sin \\n final', async () => {
    await write('a.ts', 'A\nB');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('A\nB\nNEW\n');
  });

  it('insert-after en mitad de línea: literal', async () => {
    await write('a.ts', 'xfooy\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'foo',
          content: 'bar',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('xfoobary\n');
  });

  it('insert-before con ancla SIN \\n: coloca en su propia línea', async () => {
    await write('a.ts', 'A\nB\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-before',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW\n',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('A\nNEW\nB\nC\n');
  });

  it('insert-before con contenido sin \\n: lo añade automáticamente', async () => {
    await write('a.ts', 'A\nB\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-before',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('A\nNEW\nB\nC\n');
  });

  it('insert-after skip si ya está aplicado', async () => {
    await write('a.ts', 'A\nB\nNEW\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('skipped');
  });

  it('insert-before skip si ya está aplicado', async () => {
    await write('a.ts', 'A\nNEW\nB\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-before',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('skipped');
  });

  it('insert-after falla si el ancla no existe', async () => {
    await write('a.ts', 'A\nB\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'ZZZ',
          content: 'NEW\n',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('failed');
  });

  it('insert-after falla si el ancla es ambigua', async () => {
    await write('a.ts', 'X\nmid\nX\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'X\n',
          content: 'NEW\n',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toMatch(/anchor matches 2/);
  });

  it('insert-before falla si el ancla no existe', async () => {
    await write('a.ts', 'A\nB\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-before',
          path: 'a.ts',
          anchor: 'ZZZ',
          content: 'NEW\n',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('failed');
  });
});

describe('applyOperations — insert con inline: true', () => {
  it('insert-after inline: inserta literalmente sin snap a línea', async () => {
    await write('a.ts', 'A\nB\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW',
          match: 'exact',
          inline: true,
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('A\nBNEW\nC\n');
  });

  it('insert-after sin inline (default): snap a línea', async () => {
    await write('a.ts', 'A\nB\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW',
          match: 'exact',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('A\nB\nNEW\nC\n');
  });

  it('insert-before inline: inserta literalmente sin snap a línea', async () => {
    await write('a.ts', 'A\nB\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-before',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW',
          match: 'exact',
          inline: true,
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('A\nNEWB\nC\n');
  });

  it('insert-after inline: idempotente', async () => {
    await write('a.ts', 'A\nBNEW\nC\n');
    const results = await applyOperations(
      [
        {
          op: 'insert-after',
          path: 'a.ts',
          anchor: 'B',
          content: 'NEW',
          match: 'exact',
          inline: true,
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('skipped');
  });
});

describe('applyOperations — patch find', () => {
  it('reemplaza un bloque único', async () => {
    await write('a.ts', 'const x = 1;\nconst y = 2;\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'const x = 1;\n',
          replace: 'const x = 42;\n',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('const x = 42;\nconst y = 2;\n');
  });

  it('skip si ya está aplicado', async () => {
    await write('a.ts', 'const x = 42;\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'const x = 1;\n',
          replace: 'const x = 42;\n',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('skipped');
    expect(results[0].reason).toMatch(/already applied/);
  });

  it('falla si el find no aparece y el replace tampoco', async () => {
    await write('a.ts', 'otra cosa\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'const x = 1;\n',
          replace: 'const x = 42;\n',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toMatch(/not found/);
  });

  it('falla si hay múltiples coincidencias y no se especifica first/all', async () => {
    await write('a.ts', 'a\nb\na\nb\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'a\n',
          replace: 'A\n',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toMatch(/matches/);
  });

  it('first: reemplaza solo la primera ocurrencia', async () => {
    await write('a.ts', 'a\nb\na\nb\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'a\n',
          replace: 'A\n',
          first: true,
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(results[0].matchCount).toBe(1);
    expect(await read('a.ts')).toBe('A\nb\na\nb\n');
  });

  it('all: reemplaza todas las ocurrencias', async () => {
    await write('a.ts', 'a\nb\na\nb\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'a\n',
          replace: 'A\n',
          all: true,
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(results[0].matchCount).toBe(2);
    expect(await read('a.ts')).toBe('A\nb\nA\nb\n');
  });

  it('con scope-after resuelve ambigüedad', async () => {
    const src = `function a() {
  return 1;
}
function b() {
  return 1;
}
`;
    await write('a.ts', src);
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: '  return 1;\n',
          replace: '  return 2;\n',
          scope: { afterText: 'function b' },
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    const after = await read('a.ts');
    expect(after).toContain('function b() {\n  return 2;\n}');
    expect(after).toContain('function a() {\n  return 1;\n}');
  });

  it('con scope-after + scope-before acota a una región', async () => {
    const src = `A
foo
B
foo
C
`;
    await write('a.ts', src);
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'foo\n',
          replace: 'BAR\n',
          scope: { afterText: 'B', beforeText: 'C' },
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('A\nfoo\nB\nBAR\nC\n');
  });

  it('con scope por líneas', async () => {
    await write('a.ts', 'l1\nl2\nl3\nl4\nl5\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'l4\n',
          replace: 'L4\n',
          scope: { afterLine: 3, beforeLine: 5 },
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('l1\nl2\nl3\nL4\nl5\n');
  });

  it('dry-run no modifica el archivo', async () => {
    await write('a.ts', 'hola\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'hola\n',
          replace: 'adios\n',
        },
      ],
      { cwd: tmp, dryRun: true },
    );
    expect(results[0].status).toBe('would-apply');
    expect(await read('a.ts')).toBe('hola\n');
  });

  it('falla si el archivo no existe', async () => {
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'noexiste.ts',
          mode: 'find',
          match: 'exact',
          find: 'x\n',
          replace: 'y\n',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toMatch(/file not found/);
  });
});

describe('applyOperations — patch con word: true', () => {
  it('solo sustituye palabras completas', async () => {
    await write('a.ts', 'foo foobar foo\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'foo',
          replace: 'BAR',
          word: true,
          all: true,
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('BAR foobar BAR\n');
  });

  it('word: true sin all/first es ambiguo si hay varias', async () => {
    await write('a.ts', 'foo bar foo\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'foo',
          replace: 'X',
          word: true,
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toMatch(/matches 2/);
  });

  it('renombrar un identificador en todo el archivo', async () => {
    await write('a.ts', 'const total = 1;\nconst subtotal = 2;\nconsole.log(total);\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'total',
          replace: 'grandTotal',
          word: true,
          all: true,
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe(
      'const grandTotal = 1;\nconst subtotal = 2;\nconsole.log(grandTotal);\n',
    );
  });

  it('sin word: true, "total" también cambia dentro de "subtotal"', async () => {
    await write('a.ts', 'total subtotal\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'find',
          match: 'exact',
          find: 'total',
          replace: 'X',
          all: true,
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('X subX\n');
  });
});

describe('applyOperations — patch lines', () => {
  it('reemplaza un rango por otro contenido', async () => {
    await write('a.ts', 'l1\nl2\nl3\nl4\nl5\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'lines',
          from: 2,
          to: 4,
          content: 'NEW\n',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('l1\nNEW\nl5\n');
  });

  it('permite crecer el número de líneas', async () => {
    await write('a.ts', 'l1\nl2\nl3\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'lines',
          from: 2,
          to: 2,
          content: 'x\ny\nz\n',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('ok');
    expect(await read('a.ts')).toBe('l1\nx\ny\nz\nl3\n');
  });

  it('falla si el rango está fuera del archivo', async () => {
    await write('a.ts', 'l1\n');
    const results = await applyOperations(
      [
        {
          op: 'patch',
          path: 'a.ts',
          mode: 'lines',
          from: 1,
          to: 5,
          content: 'x\n',
        },
      ],
      { cwd: tmp },
    );
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toMatch(/out of range/);
  });
});

describe('applyOperations — backup', () => {
  it('guarda copia del archivo modificado', async () => {
    await write('a.txt', 'viejo');
    await applyOperations([{ op: 'write', path: 'a.txt', content: 'nuevo' }], {
      cwd: tmp,
      backup: true,
    });
    const backupsRoot = path.join(tmp, '.graft', 'backups');
    const entries = await fs.readdir(backupsRoot);
    expect(entries.length).toBe(1);
    const backedUp = path.join(backupsRoot, entries[0], 'a.txt');
    expect(await fs.readFile(backedUp, 'utf8')).toBe('viejo');
  });

  it('no hace backup si el archivo es nuevo', async () => {
    await applyOperations([{ op: 'write', path: 'a.txt', content: 'nuevo' }], {
      cwd: tmp,
      backup: true,
    });
    expect(await exists('.graft')).toBe(false);
  });
});

describe('applyOperations — múltiples operaciones', () => {
  it('aplica en orden', async () => {
    const ops: Operation[] = [
      { op: 'mkdir', path: 'src' },
      { op: 'write', path: 'src/a.txt', content: 'hola\n' },
      {
        op: 'patch',
        path: 'src/a.txt',
        mode: 'find',
        match: 'exact',
        find: 'hola\n',
        replace: 'adios\n',
      },
    ];
    const results = await applyOperations(ops, { cwd: tmp });
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
    expect(await read('src/a.txt')).toBe('adios\n');
  });

  it('sigue tras un fallo', async () => {
    const ops: Operation[] = [
      {
        op: 'patch',
        path: 'no.ts',
        mode: 'find',
        match: 'exact',
        find: 'x',
        replace: 'y',
      },
      { op: 'write', path: 'b.txt', content: 'hola\n' },
    ];
    const results = await applyOperations(ops, { cwd: tmp });
    expect(results[0].status).toBe('failed');
    expect(results[1].status).toBe('ok');
    expect(await read('b.txt')).toBe('hola\n');
  });

  it('dry-run: un patch ve el efecto de un write anterior', async () => {
    const ops: Operation[] = [
      { op: 'write', path: 'a.txt', content: 'hola\n' },
      {
        op: 'patch',
        path: 'a.txt',
        mode: 'find',
        match: 'exact',
        find: 'hola\n',
        replace: 'adios\n',
      },
    ];
    const results = await applyOperations(ops, { cwd: tmp, dryRun: true });
    expect(results[0].status).toBe('would-apply');
    expect(results[1].status).toBe('would-apply');
    expect(await exists('a.txt')).toBe(false);
  });

  it('dry-run: un patch ve el efecto de otro patch anterior', async () => {
    await write('a.txt', 'uno\ndos\n');
    const ops: Operation[] = [
      {
        op: 'patch',
        path: 'a.txt',
        mode: 'find',
        match: 'exact',
        find: 'uno\n',
        replace: 'UNO\n',
      },
      {
        op: 'patch',
        path: 'a.txt',
        mode: 'find',
        match: 'exact',
        find: 'UNO\n',
        replace: 'ONE\n',
      },
    ];
    const results = await applyOperations(ops, { cwd: tmp, dryRun: true });
    expect(results[0].status).toBe('would-apply');
    expect(results[1].status).toBe('would-apply');
    expect(await read('a.txt')).toBe('uno\ndos\n');
  });

  it('dry-run: un rename afecta a las operaciones siguientes', async () => {
    await write('a.txt', 'hola\n');
    const ops: Operation[] = [
      { op: 'rename', path: 'a.txt', to: 'b.txt' },
      {
        op: 'patch',
        path: 'b.txt',
        mode: 'find',
        match: 'exact',
        find: 'hola\n',
        replace: 'adios\n',
      },
    ];
    const results = await applyOperations(ops, { cwd: tmp, dryRun: true });
    expect(results[0].status).toBe('would-apply');
    expect(results[1].status).toBe('would-apply');
    expect(await read('a.txt')).toBe('hola\n');
    expect(await exists('b.txt')).toBe(false);
  });
});
