// The nightly files step (CONTRACT 27, Storage "Nightly cleanup") and the wipe of `seed:demo` and
// `reset`. Only names Daybook makes are ever removed (`tmp/<32 hex>.part`, `files/<yyyy>/<mm>/<32
// hex>` and its `.t`); everything else in the folder is left alone.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { now, nowDate } from '@/lib/time';
import { removeFile } from './disk';
import { guard019Read } from './migration019';
import { MARKER, ensureReady, partPath, storedPath, thumbPath, tmpDir } from './storage';

const UNDO_WINDOW_MINUTES = 10;
const STRAY_PIECE_HOURS = 24;
const KEEP_UPLOAD_ROWS_DAYS = 7;
const PART_NAME = /^[0-9a-f]{32}\.part$/;
const YEAR = /^\d{4}$/;
const MONTH = /^\d{2}$/;
const STORED_NAME = /^[0-9a-f]{32}(\.t)?$/;

/** Removes files; a file already gone counts as removed. Other errors throw (the row is skipped). */
async function removeAll(...targets) {
  for (const target of targets) await removeFile(target);
}

/**
 * Runs `handle` for each row in id order until the budget is used; a row that fails is skipped
 * with one warning, so it never blocks the rows after it.
 * @returns {Promise<{ count: number, stopped: boolean }>}
 */
async function eachRow(rows, budget, part, handle) {
  let count = 0;
  for (const row of rows) {
    if (budget.used()) return { count, stopped: true };
    try {
      await handle(row);
      count += 1;
    } catch (error) {
      logger.warn({ part, id: row.id, code: error?.code }, 'Files cleanup skipped a row');
    }
  }
  return { count, stopped: false };
}

/** 1. Abandoned uploads: `receiving` past `expires_at` (and a crash during Finish). */
async function abandonedUploads(root, limit, budget) {
  const rows = await db('fileUploads')
    .where({ status: 'receiving' })
    .where('expiresAt', '<=', nowDate())
    .orderBy('id')
    .limit(limit)
    .select('id', 'uploadKey', 'storageKey');
  return eachRow(rows, budget, 'abandoned', async (row) => {
    await removeAll(partPath(root, row.uploadKey));
    if (row.storageKey) {
      await removeAll(storedPath(root, row.storageKey), thumbPath(root, row.storageKey));
    }
    await db('fileUploads')
      .where({ id: row.id, status: 'receiving' })
      .update({ status: 'expired', busyUntil: null, updatedAt: nowDate() });
  });
}

/** 2. Held uploads never attached: `ready` past `expires_at`. */
async function heldUploads(root, limit, budget) {
  const rows = await db('fileUploads')
    .where({ status: 'ready' })
    .where('expiresAt', '<=', nowDate())
    .orderBy('id')
    .limit(limit)
    .select('id', 'storageKey');
  return eachRow(rows, budget, 'held', async (row) => {
    if (row.storageKey) {
      await removeAll(storedPath(root, row.storageKey), thumbPath(root, row.storageKey));
    }
    await db('fileUploads')
      .where({ id: row.id, status: 'ready' })
      .update({ status: 'expired', updatedAt: nowDate() });
  });
}

/** 3. Files of tasks deleted outside the service: marked deleted (purged by part 4 next night). */
async function orphanTaskFiles(limit) {
  const ids = await db('projectFiles')
    .where({ scope: 'task', status: 'active' })
    .whereNull('taskId')
    .orderBy('id')
    .limit(limit)
    .pluck('id');
  if (!ids.length) return { count: 0, stopped: false };
  const at = nowDate();
  const count = await db('projectFiles')
    .whereIn('id', ids)
    .where({ status: 'active' })
    .update({ status: 'deleted', deletedAt: at, updatedAt: at });
  return { count, stopped: false };
}

/** 4. Deleted files after the Undo window: the disk file and its `.t`, then the row. */
async function deletedFiles(root, limit, budget) {
  const before = now().subtract(UNDO_WINDOW_MINUTES, 'minute').toDate();
  const rows = await db('projectFiles')
    .where({ status: 'deleted' })
    .where('deletedAt', '<=', before)
    .orderBy('id')
    .limit(limit)
    .select('id', 'storageKey');
  return eachRow(rows, budget, 'deleted', async (row) => {
    await removeAll(storedPath(root, row.storageKey), thumbPath(root, row.storageKey));
    await db('projectFiles').where({ id: row.id, status: 'deleted' }).delete();
  });
}

/** 5. Stray pieces: Daybook-named `.part` files older than 24 h without a `receiving` row. */
async function strayPieces(root, limit, budget) {
  const names = (await fsp.readdir(tmpDir(root))).filter((name) => PART_NAME.test(name)).sort();
  const before = now().subtract(STRAY_PIECE_HOURS, 'hour').valueOf();
  const candidates = [];
  for (const name of names) {
    if (candidates.length >= limit || budget.used()) break;
    const stats = await fsp.stat(path.join(tmpDir(root), name)).catch(() => null);
    if (stats && stats.mtimeMs < before) candidates.push({ id: name, key: name.slice(0, 32) });
  }
  if (!candidates.length) return { count: 0, stopped: false };
  // `pluck` would read the snake_case name back; select and map instead.
  const rows = await db('fileUploads')
    .whereIn(
      'uploadKey',
      candidates.map((item) => item.key),
    )
    .where({ status: 'receiving' })
    .select('uploadKey');
  const receiving = new Set(rows.map((row) => row.uploadKey));
  const strays = candidates.filter((item) => !receiving.has(item.key));
  return eachRow(strays, budget, 'stray', (item) => removeAll(partPath(root, item.key)));
}

/** 6. Old upload rows: attached, cancelled and expired rows older than 7 days. */
async function oldUploadRows(limit) {
  const before = now().subtract(KEEP_UPLOAD_ROWS_DAYS, 'day').toDate();
  const ids = await db('fileUploads')
    .whereIn('status', ['attached', 'cancelled', 'expired'])
    .where('updatedAt', '<', before)
    .orderBy('id')
    .limit(limit)
    .pluck('id');
  const count = ids.length ? await db('fileUploads').whereIn('id', ids).delete() : 0;
  return { count, stopped: false };
}

/** The six parts in order, stopping when the time budget is used (the rest waits a night). */
async function runParts(root, limit, budget) {
  const parts = [
    () => abandonedUploads(root, limit, budget),
    () => heldUploads(root, limit, budget),
    () => orphanTaskFiles(limit),
    () => deletedFiles(root, limit, budget),
    () => strayPieces(root, limit, budget),
    () => oldUploadRows(limit),
  ];
  let total = 0;
  for (const part of parts) {
    if (budget.used()) break;
    const { count, stopped } = await part();
    total += count;
    if (stopped) break;
  }
  return total;
}

/**
 * The nightly files step: abandoned uploads, held uploads never attached, files of deleted
 * tasks, deleted files after the Undo window, stray pieces, old upload rows. Each part handles at
 * most `limit` rows in id order. It never throws (the rest of the cleanup run isn't marked failed):
 * a storage problem or a missing migration answers 0 with one warning, a row that fails is skipped.
 * @param {{ limit?: number, budgetMs?: number }} [args]
 * @returns {Promise<number>} rows handled
 */
export async function cleanUp({ limit = 500, budgetMs = 20_000 } = {}) {
  const started = performance.now();
  const budget = { used: () => performance.now() - started >= budgetMs };
  let root;
  try {
    root = await ensureReady();
  } catch {
    logger.warn('Files cleanup skipped: file storage is not set up');
    return 0;
  }
  try {
    return await guard019Read(
      'files',
      () => runParts(root, limit, budget),
      () => 0,
    );
  } catch (error) {
    logger.warn({ errno: error?.errno, code: error?.code }, 'Files cleanup stopped early');
    return 0;
  }
}

/** Removes the Daybook-named files of one month folder, then the folder when it is empty. */
async function wipeMonth(folder) {
  let removed = 0;
  for (const name of await fsp.readdir(folder)) {
    if (STORED_NAME.test(name) && (await removeFile(path.join(folder, name)))) removed += 1;
  }
  await fsp.rmdir(folder).catch(() => {});
  return removed;
}

/** Removes Daybook-named files under `files/<yyyy>/<mm>/`, then the empty folders. */
async function wipeFiles(root) {
  const files = path.join(root, 'files');
  let removed = 0;
  for (const year of await fsp.readdir(files).catch(() => [])) {
    if (!YEAR.test(year)) continue;
    const yearFolder = path.join(files, year);
    for (const month of await fsp.readdir(yearFolder).catch(() => [])) {
      if (MONTH.test(month)) removed += await wipeMonth(path.join(yearFolder, month));
    }
    await fsp.rmdir(yearFolder).catch(() => {});
  }
  return removed;
}

/**
 * Empties the files folder for `seed:demo` and `reset`, only when the marker file is there, and
 * only names Daybook makes (never anything else).
 * @returns {Promise<{ removed: number }>}
 */
export async function wipeStorageForReset() {
  const dir = env.filesDir;
  if (!dir || !path.isAbsolute(dir)) return { removed: 0 };
  let root;
  try {
    root = await fsp.realpath(dir);
    await fsp.stat(path.join(root, MARKER));
  } catch {
    return { removed: 0 };
  }
  let removed = 0;
  for (const name of await fsp.readdir(path.join(root, 'tmp')).catch(() => [])) {
    if (PART_NAME.test(name) && (await removeFile(path.join(root, 'tmp', name)))) removed += 1;
  }
  removed += await wipeFiles(root);
  return { removed };
}
