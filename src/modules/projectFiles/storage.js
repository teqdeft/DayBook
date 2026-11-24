// The files folder (CONTRACT 27, Storage): the check that FILES_DIR is a private folder Daybook
// may use, its 60 s cache, and every path on disk. Paths are built only from the real FILES_DIR,
// fixed parts and a key checked against its pattern, never from anything the browser sends.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { fileError } from './errors';

/** The marker file that says the folder is Daybook's (step 4 of the check). */
export const MARKER = '.daybook-files';
const MARKER_TEXT = "Daybook keeps project files here. Don't add or remove files by hand.\n";
const HTACCESS = 'Require all denied\nOptions -Indexes\n';
const CACHE_MS = 60_000;
const IS_WINDOWS = process.platform === 'win32';
const STORAGE_KEY = /^\d{4}\/\d{2}\/[0-9a-f]{32}$/;
const UPLOAD_KEY = /^[0-9a-f]{32}$/;

/** @typedef {{ ready: boolean, problem: string | null }} StorageStatus */

let cached = null; // { at, status, root }
let checking = null; // the check running now
const logged = new Set();

/** One error line per problem per process; never the path (it is in the server's own settings). */
function logProblemOnce(problem) {
  if (logged.has(problem)) return;
  logged.add(problem);
  logger.error({ problem }, "File storage isn't set up");
}

async function exists(target) {
  try {
    await fsp.stat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

/**
 * Step 3 (production): walking up from the real folder, a folder holding Daybook's `server.cjs`
 * and `package.json` is the app; a part named `public_html` is the web folder.
 * @returns {Promise<'inside_app' | 'public' | null>}
 */
async function placeProblem(real) {
  let current = real;
  for (;;) {
    if (path.basename(current) === 'public_html') return 'public';
    const app =
      (await exists(path.join(current, 'server.cjs'))) &&
      (await exists(path.join(current, 'package.json')));
    if (app) return 'inside_app';
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Step 4: the marker is there, or the folder is empty and the marker is written now. */
async function claimFolder(root) {
  if (await exists(path.join(root, MARKER))) return true;
  const entries = await fsp.readdir(root);
  // Another process's check (a second app process, doctor, the worker) wrote the marker between
  // the two looks: the folder is Daybook's, not one in use.
  if (entries.includes(MARKER)) return true;
  if (entries.length > 0) return false;
  try {
    await fsp.writeFile(path.join(root, MARKER), MARKER_TEXT, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error; // another check wrote it just now
  }
  return true;
}

/** Step 5: tmp/, files/, the .htaccess, mode 0700 (POSIX) and a probe write. */
async function prepareFolder(root) {
  for (const part of ['tmp', 'files']) {
    // The folder is FILES_DIR, never a project path: without the hint Turbopack traces the whole
    // project (the dev files folder included) into every route that imports this module.
    await fsp.mkdir(path.join(/* turbopackIgnore: true */ root, part), {
      recursive: true,
      mode: 0o700,
    });
  }
  try {
    await fsp.writeFile(path.join(root, '.htaccess'), HTACCESS, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  if (!IS_WINDOWS) {
    for (const part of ['', 'tmp', 'files']) await fsp.chmod(path.join(root, part), 0o700);
  }
  const probe = path.join(root, 'tmp', `.probe-${crypto.randomBytes(8).toString('hex')}`);
  await fsp.writeFile(probe, 'ok', { flag: 'wx', mode: 0o600 });
  await fsp.unlink(probe);
}

/**
 * The check with its own inputs, uncached, and the real folder when it passes.
 * @param {string} dir
 * @param {boolean} isProduction
 * @returns {Promise<StorageStatus & { root: string | null }>}
 */
async function inspect(dir, isProduction) {
  const fail = (problem) => ({ ready: false, problem, root: null });
  if (!dir) return fail('not_set');
  if (!path.isAbsolute(dir)) return fail('not_absolute');
  let root;
  try {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    // From here on the real folder: a symlink or /home vs /home2 can't hide where it is.
    root = await fsp.realpath(dir);
  } catch {
    return fail('not_writable');
  }
  if (isProduction) {
    const problem = await placeProblem(root).catch(() => null);
    if (problem) return fail(problem);
  }
  try {
    if (!(await claimFolder(root))) return fail('not_empty');
    await prepareFolder(root);
  } catch {
    return fail('not_writable');
  }
  return { ready: true, problem: null, root };
}

/**
 * The storage check (Storage, "The check"), in order: absolute, made or there, not inside the app
 * or public_html (production), the marker or an empty folder, tmp/ files/ .htaccess and a probe.
 * Tests pass their own inputs; without them it checks env (uncached: storageStatus() caches).
 * @param {{ dir?: string, isProduction?: boolean }} [input]
 * @returns {Promise<StorageStatus>} problem: not_set, not_absolute, inside_app, public, not_empty,
 *   not_writable, or null when ready
 */
export async function checkStorage({ dir = env.filesDir, isProduction = env.isProduction } = {}) {
  const { ready, problem } = await inspect(dir, isProduction);
  if (!ready) logProblemOnce(problem);
  return { ready, problem };
}

/** The env check, cached 60 s per process; checks asked at the same moment share one run. */
async function current() {
  const at = performance.now();
  if (cached && at - cached.at < CACHE_MS) return cached;
  if (!checking) {
    checking = inspect(env.filesDir, env.isProduction)
      .then((result) => {
        if (!result.ready) logProblemOnce(result.problem);
        const status = { ready: result.ready, problem: result.problem };
        cached = { at: performance.now(), status, root: result.root };
        return cached;
      })
      .finally(() => {
        checking = null;
      });
  }
  return checking;
}

/**
 * Whether FILES_DIR is usable now (cached 60 s).
 * @returns {Promise<StorageStatus>}
 */
export async function storageStatus() {
  return { ...(await current()).status };
}

/**
 * The real files folder, or FILES_UNAVAILABLE (503) "File storage isn't set up yet. Ask an Admin."
 * @returns {Promise<string>}
 * @throws FILES_UNAVAILABLE
 */
export async function ensureReady() {
  const { status, root } = await current();
  if (!status.ready) throw fileError('FILES_UNAVAILABLE');
  return root;
}

/** Test seam: forgets the cached check (and the problems already logged). */
export function resetStorageForTests() {
  cached = null;
  checking = null;
  logged.clear();
}

/** Forgets the cached check after a write found the folder gone or unusable. */
export function forgetStorageCheck() {
  cached = null;
}

// ---------- paths and names ----------

/** A path under the real root, refused when it would leave it. */
function under(root, ...parts) {
  const full = path.resolve(path.join(root, ...parts));
  if (!full.startsWith(root + path.sep)) throw new Error('A files path left the files folder');
  return full;
}

/** True for an upload key: 32 lower hex characters. */
export const isUploadKey = (key) => typeof key === 'string' && UPLOAD_KEY.test(key);

/** True for a storage key: 'yyyy/mm/<32 lower hex>'. */
export const isStorageKey = (key) => typeof key === 'string' && STORAGE_KEY.test(key);

/** A new random upload key (the only id the browser sees). */
export const newUploadKey = () => crypto.randomBytes(16).toString('hex');

/**
 * A new storage key in the UTC month of `at` (the month the upload finished).
 * @param {Date} at
 * @returns {string} 'yyyy/mm/<32 hex>'
 */
export function newStorageKey(at) {
  const yyyy = String(at.getUTCFullYear()).padStart(4, '0');
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${crypto.randomBytes(16).toString('hex')}`;
}

/** `FILES_DIR/tmp/<key>.part`. */
export function partPath(root, uploadKey) {
  if (!isUploadKey(uploadKey)) throw new Error('Not an upload key');
  return under(root, 'tmp', `${uploadKey}.part`);
}

/** `FILES_DIR/files/<yyyy>/<mm>/<32 hex>`. */
export function storedPath(root, storageKey) {
  if (!isStorageKey(storageKey)) throw new Error('Not a storage key');
  return under(root, 'files', ...storageKey.split('/'));
}

/** `FILES_DIR/files/<yyyy>/<mm>/<32 hex>.t`, the thumbnail. */
export function thumbPath(root, storageKey) {
  return `${storedPath(root, storageKey)}.t`;
}

/** `FILES_DIR/tmp` and `FILES_DIR/files`. */
export const tmpDir = (root) => under(root, 'tmp');
export const filesDir = (root) => under(root, 'files');
