// Shared kit for the file tests (CONTRACT 27, Tests "Services"): the test files folder (always
// under the system temp folder, one per DB_NAME), small bytes built in code (no fixture files),
// files made through `projectFiles.storeFile`, so no test copies storage code, and links made as
// a task save makes them (`linkFile`, CONTRACT 28).
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { projectFiles } from '@/modules/projectFiles';

/** The small piece size every file test uses (never an env value). */
export const TEST_PIECE_BYTES = 65_536;

/** The real test files folder. */
export const filesRoot = () => env.filesDir;

/**
 * Deletes the test files folder (the next storage check makes it again with its marker), forgets
 * the cached check and sets the test piece size. Refuses any folder outside the system temp
 * folder, so a test can never empty a real files folder.
 */
export async function emptyFilesDir() {
  const dir = path.resolve(env.filesDir || '.');
  const tmp = path.resolve(os.tmpdir());
  if (!dir.startsWith(tmp + path.sep) || !dir.includes('daybook-test-files')) {
    throw new Error(`Refusing to empty a files folder outside the system temp folder: ${dir}`);
  }
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  projectFiles.resetStorageForTests();
  projectFiles.setPieceBytesForTests(TEST_PIECE_BYTES);
}

/** A file's path under the test folder from its storage key ('yyyy/mm/<hex>'). */
export function storedFilePath(storageKey) {
  return path.join(env.filesDir, 'files', ...storageKey.split('/'));
}

/** An upload's `.part` path under the test folder. */
export function partFilePath(uploadKey) {
  return path.join(env.filesDir, 'tmp', `${uploadKey}.part`);
}

/** True when a file is on disk. */
export async function onDisk(target) {
  try {
    await fsp.stat(target);
    return true;
  } catch {
    return false;
  }
}

// ---------- bytes ----------

/** The first bytes of a PNG of `width` × `height` (signature and IHDR; enough for the header). */
export function pngBytes(width = 4, height = 3, extra = 64) {
  const bytes = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

/** A JPEG start with an APP0 segment and a SOF0 of `width` × `height`. */
export function jpegBytes(width = 4, height = 3, extra = 64) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 255, width >> 8, width & 255, 3];
  const components = [1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, ...app0, ...sof, ...components]),
    Buffer.alloc(extra),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A small plain-text PDF-looking file (Daybook never opens it). */
export const pdfBytes = (size = 1200) =>
  Buffer.concat([Buffer.from('%PDF-1.4\n% test file\n'), Buffer.alloc(size, 0x20)]);

/** `size` bytes in a repeating pattern that differs per offset (so a wrong offset shows). */
export function patternBytes(size) {
  const bytes = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 31 + (index >> 8)) & 255;
  return bytes;
}

// ---------- files through storeFile ----------

/**
 * A held task upload (`ready`, not attached): for a task not saved yet (`taskId` null), or for an
 * existing task (`taskId`).
 * @returns {Promise<{ key: string }>}
 */
export function heldUpload({ user, projectId, taskId = null, name = 'brief.pdf', bytes }) {
  return projectFiles.storeFile({
    user,
    projectId,
    target: 'task',
    taskId,
    name,
    bytes: bytes ?? pdfBytes(),
    hold: true,
  });
}

/**
 * A project file in a place ('Whole project' when `phase` is null) with who sees it.
 * @returns {Promise<import('@/modules/projectFiles/service').ProjectFile>}
 */
export function projectFile({
  user,
  projectId,
  phase = null,
  visibility = 'everyone',
  name = 'brief.pdf',
  bytes,
  thumb = null,
}) {
  return projectFiles.storeFile({
    user,
    projectId,
    target: 'project',
    phase,
    visibility,
    name,
    bytes: bytes ?? pdfBytes(),
    thumb,
  });
}

/**
 * A file attached to an existing task.
 * @returns {Promise<import('@/modules/projectFiles/service').ProjectFile>}
 */
export function taskFile({ user, projectId, taskId, name = 'brief.pdf', bytes, thumb = null }) {
  return projectFiles.storeFile({
    user,
    projectId,
    target: 'task',
    taskId,
    name,
    bytes: bytes ?? pdfBytes(),
    thumb,
  });
}

/** A task row straight into the table (`assigneeId` null: Anyone on the project). */
export async function createTask(project, overrides = {}) {
  const [id] = await db('projectTasks').insert({
    projectId: project.id,
    title: 'Fix the login page',
    priority: 'p2',
    status: 'open',
    assigneeId: null,
    createdBy: project.pmId,
    ...overrides,
  });
  return db('projectTasks').where({ id }).first();
}

/**
 * Links project files to a task as B's save does (CONTRACT 28): one transaction, the task row
 * locked first, the person after the save read from the task row (`assigneeId` overrides it, as a
 * save that also changes the person).
 * @param {{ user: object, project: { id: number, pmId: number }, task: { id: number },
 *   fileIds: number | number[], shareConfirmed?: boolean, shareWith?: number | '' | null,
 *   assigneeId?: number | null }} args
 * @returns {Promise<import('@/modules/projectFiles/service').ProjectFile[]>} the new links
 */
export function linkFile({ user, project, task, fileIds, shareConfirmed, shareWith, ...rest }) {
  return db.transaction(async (trx) => {
    const row = await trx('projectTasks')
      .where({ id: task.id })
      .forUpdate()
      .first('id', 'projectId', 'assigneeId');
    const assigneeId = Object.hasOwn(rest, 'assigneeId') ? rest.assigneeId : row.assigneeId;
    return projectFiles.linkFiles(
      {
        user,
        project: { id: project.id, pmId: project.pmId },
        task: { id: row.id, projectId: row.projectId, assigneeId },
        fileIds: [].concat(fileIds),
        shareConfirmed,
        shareWith,
      },
      trx,
    );
  });
}

/** The link rows of a task, oldest first. */
export const linkRowsOf = (taskId) =>
  db('taskFileLinks').where({ taskId }).orderBy(['createdAt', 'fileId']).select('*');

/** One `project_files` row by id. */
export const fileRow = (id) => db('projectFiles').where({ id }).first();

/** One `file_uploads` row by key. */
export const uploadRow = (uploadKey) => db('fileUploads').where({ uploadKey }).first();

/** Awaits a promise that must fail with an AppError of `code`; returns the error. */
export async function expectCode(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  if (!error) throw new Error(`expected ${code}, but it succeeded`);
  if (error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`);
  return error;
}
