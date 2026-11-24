// Disk work of uploads (CONTRACT 27, Storage): the empty `.part`, positional piece writes with an
// optional SHA-256, the atomic finish (sync, then rename), thumbnails, removals and the error map.
// Every path comes from storage.js. Every handle is closed in `finally`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const IS_WINDOWS = process.platform === 'win32';
const WINDOWS_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const WINDOWS_RETRIES = 10;
const WINDOWS_RETRY_MS = 100;
// Node 20 reports a cPanel quota as code UNKNOWN with errno -EDQUOT (-122 on Linux).
const EDQUOT = os.constants.errno.EDQUOT ?? 122;
const DISK_FULL_CODES = new Set(['ENOSPC', 'EFBIG', 'EDQUOT']);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Windows only (development and tests): an antivirus or the search indexer briefly holds new
 * files, so rename, unlink and truncate try again up to 10 times, 100 ms apart. Linux: no retry.
 * @template T
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
export async function withWindowsRetry(run) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!IS_WINDOWS || !WINDOWS_RETRY_CODES.has(error?.code) || attempt >= WINDOWS_RETRIES) {
        throw error;
      }
      await pause(WINDOWS_RETRY_MS);
    }
  }
}

/** ENOSPC, EFBIG, EDQUOT, or EDQUOT reported as code UNKNOWN with errno -122. */
export function isDiskFull(error) {
  if (DISK_FULL_CODES.has(error?.code)) return true;
  return error?.code === 'UNKNOWN' && error?.errno === -EDQUOT;
}

/**
 * What a disk error means for the person (Storage, Disk-full handling).
 * @param {unknown} error
 * @returns {'disk_full' | 'unavailable' | 'busy' | 'missing' | null} null: not a known disk error
 */
export function diskProblem(error) {
  if (isDiskFull(error)) return 'disk_full';
  const code = error?.code;
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'unavailable';
  if (code === 'EMFILE' || code === 'ENFILE') return 'busy';
  if (code === 'ENOENT') return 'missing';
  return null;
}

/** Creates the empty `.part` of a new upload (fails if it is already there), mode 0600. */
export async function createPart(part) {
  const handle = await fsp.open(part, 'wx', 0o600);
  await handle.close();
}

/** The size of a file on disk, or null when it isn't there. */
export async function sizeOnDisk(target) {
  try {
    return (await fsp.stat(target)).size;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/** True when the file is there. */
export async function isOnDisk(target) {
  return (await sizeOnDisk(target)) !== null;
}

/** Shortens a file to `size` bytes (it only ever drops a half-written tail). */
export function truncateTo(target, size) {
  return withWindowsRetry(() => fsp.truncate(target, size));
}

/**
 * Writes a piece's bytes at `offset` of the `.part`, positional (never append mode), after
 * cutting off anything past `offset` an earlier try left. With `hash` the SHA-256 of the bytes
 * is computed while they are written.
 * @param {string} part
 * @param {number} offset
 * @param {ReadableStream<Uint8Array>} stream the piece (`piece.stream()`)
 * @param {{ hash?: boolean }} [options]
 * @returns {Promise<{ bytes: number, sha256: string | null }>}
 */
export async function writeAt(part, offset, stream, { hash = false } = {}) {
  await truncateTo(part, offset);
  const hasher = hash ? crypto.createHash('sha256') : null;
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      hasher?.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(stream),
    counter,
    fs.createWriteStream(part, { flags: 'r+', start: offset }),
  );
  return { bytes, sha256: hasher ? hasher.digest('hex') : null };
}

/**
 * The atomic finish: sync the `.part` to disk, make the month folder, rename it into place (the
 * same file system, so it never copies).
 * @param {string} part
 * @param {string} final
 */
export async function syncAndMove(part, final) {
  const handle = await fsp.open(part, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.mkdir(path.dirname(final), { recursive: true, mode: 0o700 });
  await withWindowsRetry(() => fsp.rename(part, final));
}

/**
 * Opens a stored file for positional reads (the picture header) and closes it after `withRead`.
 * @template T
 * @param {string} target
 * @param {(read: (position: number, length: number) => Promise<Buffer>) => Promise<T>} withRead
 * @returns {Promise<T>}
 */
export async function withReader(target, withRead) {
  const handle = await fsp.open(target, 'r');
  try {
    return await withRead(async (position, length) => {
      const buffer = Buffer.alloc(Math.max(0, length));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      return buffer.subarray(0, bytesRead);
    });
  } finally {
    await handle.close();
  }
}

/** Writes a thumbnail next to its file, mode 0600. */
export async function writeThumb(target, bytes) {
  await fsp.writeFile(target, bytes, { mode: 0o600 });
}

/** Deletes a file; a file already gone counts as removed. */
export async function removeFile(target) {
  try {
    await withWindowsRetry(() => fsp.unlink(target));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

/** Deletes files, ignoring every error (best effort: the nightly cleanup removes what is left). */
export async function removeQuietly(...targets) {
  for (const target of targets) {
    try {
      await removeFile(target);
    } catch {
      // left to the nightly cleanup
    }
  }
}

/** Free bytes for this account on the files folder's disk (`bavail * bsize`). */
export async function freeBytes(root) {
  const stats = await fsp.statfs(root);
  return Number(stats.bavail) * Number(stats.bsize);
}
