import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import type { AppliedRecord } from './types.js';

export function computeHash(source: string): string {
  const normalized = source.replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function sidecarPathFor(graftPath: string): string {
  return `${graftPath}.applied`;
}

export async function readAppliedRecord(
  graftPath: string,
): Promise<AppliedRecord | null> {
  try {
    const raw = await fs.readFile(sidecarPathFor(graftPath), 'utf8');
    const data = JSON.parse(raw) as Partial<AppliedRecord>;
    if (
      typeof data.appliedAt !== 'string' ||
      typeof data.hash !== 'string' ||
      typeof data.operations !== 'number'
    ) {
      return null;
    }
    return {
      appliedAt: data.appliedAt,
      hash: data.hash,
      operations: data.operations,
    };
  } catch {
    return null;
  }
}

export async function writeAppliedRecord(
  graftPath: string,
  record: AppliedRecord,
): Promise<void> {
  const json = JSON.stringify(record, null, 2) + '\n';
  await fs.writeFile(sidecarPathFor(graftPath), json, 'utf8');
}

export async function deleteAppliedRecord(graftPath: string): Promise<void> {
  try {
    await fs.unlink(sidecarPathFor(graftPath));
  } catch {
    // ya no existe, o nunca existió: da igual
  }
}