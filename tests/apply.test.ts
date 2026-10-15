import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyGraftFile } from '../src/core/apply.js';
import { sidecarPathFor } from '../src/core/state.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'graft-apply-test-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeGraft(content: string): Promise<string> {
  const p = path.join(tmp, 'changes.graft');
  await fs.writeFile(p, content, 'utf8');
  return p;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const SIMPLE_GRAFT = `[op: mkdir]
path: out

[op: write]
path: out/a.txt
<<<CONTENT
hola
CONTENT>>>
`;

describe('applyGraftFile — sidecar', () => {
  it('aplica, escribe el sidecar, y en la segunda ejecución avisa ya aplicado', async () => {
    const graftPath = await writeGraft(SIMPLE_GRAFT);

    const r1 = await applyGraftFile(graftPath, { cwd: tmp });
    expect(r1.alreadyApplied).toBe(false);
    expect(r1.counts?.failed).toBe(0);
    expect(r1.recorded).toBe(true);
    expect(await exists(sidecarPathFor(graftPath))).toBe(true);

    const r2 = await applyGraftFile(graftPath, { cwd: tmp });
    expect(r2.alreadyApplied).toBe(true);
    expect(r2.appliedRecord?.operations).toBe(2);
  });

  it('--force ignora el sidecar y vuelve a aplicar', async () => {
    const graftPath = await writeGraft(SIMPLE_GRAFT);
    await applyGraftFile(graftPath, { cwd: tmp });

    const r2 = await applyGraftFile(graftPath, { cwd: tmp, force: true });
    expect(r2.alreadyApplied).toBe(false);
    expect(r2.counts?.failed).toBe(0);
  });

  it('dry-run nunca escribe el sidecar', async () => {
    const graftPath = await writeGraft(SIMPLE_GRAFT);
    const r = await applyGraftFile(graftPath, { cwd: tmp, dryRun: true });
    expect(r.alreadyApplied).toBe(false);
    expect(r.recorded).toBe(false);
    expect(await exists(sidecarPathFor(graftPath))).toBe(false);
  });

  it('dry-run nunca avisa ya aplicado (siempre muestra el preview)', async () => {
    const graftPath = await writeGraft(SIMPLE_GRAFT);
    await applyGraftFile(graftPath, { cwd: tmp });

    const r2 = await applyGraftFile(graftPath, { cwd: tmp, dryRun: true });
    expect(r2.alreadyApplied).toBe(false);
    expect(r2.results?.length).toBe(2);
  });

  it('si cambia el contenido del .graft, el hash cambia y se reaplica', async () => {
    const graftPath = await writeGraft(SIMPLE_GRAFT);
    await applyGraftFile(graftPath, { cwd: tmp });

    const modified = SIMPLE_GRAFT + `\n[op: mkdir]\npath: other\n`;
    await fs.writeFile(graftPath, modified, 'utf8');

    const r2 = await applyGraftFile(graftPath, { cwd: tmp });
    expect(r2.alreadyApplied).toBe(false);
    expect(r2.results?.length).toBe(3);
  });

  it('CRLF vs LF no invalida el hash', async () => {
    const graftPath = await writeGraft(SIMPLE_GRAFT);
    await applyGraftFile(graftPath, { cwd: tmp });

    const crlf = SIMPLE_GRAFT.replace(/\n/g, '\r\n');
    await fs.writeFile(graftPath, crlf, 'utf8');

    const r2 = await applyGraftFile(graftPath, { cwd: tmp });
    expect(r2.alreadyApplied).toBe(true);
  });

  it('no escribe el sidecar si hay algún fallo', async () => {
    const bad = `[op: patch]
path: does-not-exist.txt
<<<FIND
foo
FIND>>>
<<<REPLACE
bar
REPLACE>>>
`;
    const graftPath = await writeGraft(bad);
    const r = await applyGraftFile(graftPath, { cwd: tmp });
    expect(r.counts?.failed).toBe(1);
    expect(r.recorded).toBe(false);
    expect(await exists(sidecarPathFor(graftPath))).toBe(false);
  });

  it('archivo ilegible → readError', async () => {
    const r = await applyGraftFile(path.join(tmp, 'nope.graft'), { cwd: tmp });
    expect(r.readError).toBeDefined();
    expect(r.alreadyApplied).toBe(false);
  });

  it('archivo con error de parseo → parseError', async () => {
    const graftPath = await writeGraft('[op: mkdir]\n');
    const r = await applyGraftFile(graftPath, { cwd: tmp });
    expect(r.parseError).toBeDefined();
    expect(r.alreadyApplied).toBe(false);
  });

  it('sidecar corrupto se ignora silenciosamente', async () => {
    const graftPath = await writeGraft(SIMPLE_GRAFT);
    await fs.writeFile(sidecarPathFor(graftPath), 'not json', 'utf8');
    const r = await applyGraftFile(graftPath, { cwd: tmp });
    expect(r.alreadyApplied).toBe(false);
    expect(r.counts?.failed).toBe(0);
  });
});