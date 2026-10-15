import { promises as fs } from 'node:fs';
import { parseGraftFile, GraftParseError } from './parser.js';
import { applyOperations } from './engine.js';
import {
  computeHash,
  readAppliedRecord,
  writeAppliedRecord,
} from './state.js';
import type {
  ApplyFileResult,
  ApplyOptions,
  AppliedRecord,
  OperationResult,
  OperationStatus,
} from './types.js';

function countByStatus(
  results: OperationResult[],
): Record<OperationStatus, number> {
  const counts: Record<OperationStatus, number> = {
    ok: 0,
    skipped: 0,
    'would-apply': 0,
    failed: 0,
  };
  for (const r of results) counts[r.status]++;
  return counts;
}

/**
 * High-level entry point: read a .graft file, apply it, and manage the
 * `.applied` sidecar record.
 *
 * Behaviour:
 * - If the sidecar exists with a hash matching the current file, and `force`
 *   is not set and we are not in dry-run mode, returns `alreadyApplied: true`
 *   without touching the project.
 * - Otherwise, parses and applies the operations. If everything succeeds
 *   (no `failed`), writes the sidecar with the new hash.
 * - Dry-run never writes the sidecar and never short-circuits on an already
 *   applied record.
 */
export async function applyGraftFile(
  graftPath: string,
  options: ApplyOptions,
): Promise<ApplyFileResult> {
  let source: string;
  try {
    source = await fs.readFile(graftPath, 'utf8');
  } catch (e) {
    return {
      alreadyApplied: false,
      readError: e instanceof Error ? e.message : String(e),
    };
  }

  const hash = computeHash(source);

  if (!options.force && !options.dryRun) {
    const record = await readAppliedRecord(graftPath);
    if (record && record.hash === hash) {
      return { alreadyApplied: true, appliedRecord: record };
    }
  }

  let ops;
  try {
    ops = parseGraftFile(source, graftPath);
  } catch (e) {
    if (e instanceof GraftParseError) {
      return {
        alreadyApplied: false,
        parseError: { message: e.message, line: e.line },
      };
    }
    throw e;
  }

  const results = await applyOperations(ops, options);
  const counts = countByStatus(results);

  let recorded = false;
  if (!options.dryRun && counts.failed === 0) {
    const newRecord: AppliedRecord = {
      appliedAt: new Date().toISOString(),
      hash,
      operations: ops.length,
    };
    try {
      await writeAppliedRecord(graftPath, newRecord);
      recorded = true;
    } catch {
      // Si no podemos escribir el sidecar, no rompemos la aplicación.
      recorded = false;
    }
  }

  return {
    alreadyApplied: false,
    results,
    counts,
    recorded,
  };
}