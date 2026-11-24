// The nightly files step (CONTRACT 27, Storage "Nightly cleanup") and the reset wipe: each of the
// six parts, the row bound, the time budget, a storage problem (0, no throw), a row that fails
// skipped without stopping the others, only Daybook-named files removed.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase } from '../helpers/db.js';
import { createProject } from './dashboardKit.js';
import {
  createTask,
  emptyFilesDir,
  fileRow,
  heldUpload,
  onDisk,
  partFilePath,
  projectFile,
  storedFilePath,
  taskFile,
  uploadRow,
} from './projectFilesKit.js';

const disk = vi.hoisted(() => ({}));
vi.mock('@/modules/projectFiles/disk', async (importOriginal) => {
  const real = await importOriginal();
  disk.removeFile = vi.fn(real.removeFile);
  return { ...real, removeFile: disk.removeFile };
});
vi.mock('@/modules/reports', () => ({ reports: {} }));

const { projectFiles } = await import('@/modules/projectFiles');

const T0 = '2026-11-23T06:00:00Z';
const LATER = '2026-11-25T06:00:00Z'; // two days on: every upload of T0 has expired
const run = (options = {}) => projectFiles.cleanUp({ limit: 500, budgetMs: 20_000, ...options });

let pm;
let project;

/** A receiving upload with its empty .part. */
async function receiving(name = 'big.zip') {
  const { key } = await projectFiles.startUpload({
    user: pm,
    input: {
      projectId: project.id,
      target: 'project',
      phase: null,
      visibility: 'managers',
      name,
      size: 1000,
    },
  });
  return key;
}

/** A file soft deleted `minutesAgo` minutes before T0. */
async function deletedFile(minutesAgo, name = 'old.pdf') {
  const file = await projectFile({ user: pm, projectId: project.id, name });
  await db('projectFiles')
    .where({ id: file.id })
    .update({
      status: 'deleted',
      deletedAt: new Date(new Date(T0).getTime() - minutesAgo * 60_000),
    });
  return fileRow(file.id);
}

const tmpPath = (name) => path.join(env.filesDir, 'tmp', name);

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  project = await createProject(pm, { name: 'acme-store' });
});

beforeEach(async () => {
  setNowForTests(T0);
  await db('projectFiles').delete();
  await db('fileUploads').delete();
  await emptyFilesDir();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('cleanUp', () => {
  it('1 and 2: expires abandoned and held uploads past their time and deletes their files', async () => {
    const running = await receiving();
    const fresh = await receiving();
    const held = await heldUpload({ user: pm, projectId: project.id });
    const heldKey = (await uploadRow(held.key)).storageKey;
    // A crash during Finish: the file is renamed but the row still receiving.
    const crashed = await receiving();
    const crashKey = '2026/11/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await fsp.mkdir(path.dirname(storedFilePath(crashKey)), { recursive: true });
    await fsp.rename(partFilePath(crashed), storedFilePath(crashKey));
    await db('fileUploads').where({ uploadKey: crashed }).update({ storageKey: crashKey });
    await db('fileUploads')
      .where({ uploadKey: fresh })
      .update({ expiresAt: new Date('2026-11-26T00:00:00Z') });

    setNowForTests(LATER);
    expect(await run()).toBe(3);
    expect((await uploadRow(running)).status).toBe('expired');
    expect(await onDisk(partFilePath(running))).toBe(false);
    expect((await uploadRow(crashed)).status).toBe('expired');
    expect(await onDisk(storedFilePath(crashKey))).toBe(false);
    expect((await uploadRow(held.key)).status).toBe('expired');
    expect(await onDisk(storedFilePath(heldKey))).toBe(false);
    expect((await uploadRow(fresh)).status).toBe('receiving');
    expect(await onDisk(partFilePath(fresh))).toBe(true);
  });

  it('3 and 4: marks files of deleted tasks, then purges deleted files after the Undo window', async () => {
    const task = await createTask(project);
    const onTask = await taskFile({ user: pm, projectId: project.id, taskId: task.id });
    await db('projectTasks').where({ id: task.id }).delete(); // outside the service: SET NULL
    const old = await deletedFile(11);
    const recent = await deletedFile(5);

    expect(await run()).toBe(2); // the task file marked, the old deleted file purged
    expect(await fileRow(onTask.id)).toMatchObject({ status: 'deleted', taskId: null });
    expect(await fileRow(old.id)).toBeUndefined();
    expect(await onDisk(storedFilePath(old.storageKey))).toBe(false);
    expect(await fileRow(recent.id)).toMatchObject({ status: 'deleted' });
    expect(await onDisk(storedFilePath(recent.storageKey))).toBe(true);

    setNowForTests('2026-11-24T06:00:00Z');
    expect(await run()).toBe(2); // the task file and the recent one, both past 10 minutes now
    expect(await fileRow(onTask.id)).toBeUndefined();
    expect(await fileRow(recent.id)).toBeUndefined();
  });

  it('5: removes only Daybook-named .part files older than 24 h without a receiving row', async () => {
    const live = await receiving();
    const stray = 'b'.repeat(32);
    const young = 'c'.repeat(32);
    const files = [`${stray}.part`, `${young}.part`, 'notes.txt', `${'D'.repeat(32)}.part`];
    for (const name of files) await fsp.writeFile(tmpPath(name), 'x');
    const old = new Date(new Date(T0).getTime() - 25 * 3_600_000);
    const recent = new Date(new Date(T0).getTime() - 3_600_000);
    for (const name of [`${stray}.part`, 'notes.txt', `${'D'.repeat(32)}.part`, `${live}.part`]) {
      await fsp.utimes(tmpPath(name), old, old);
    }
    await fsp.utimes(tmpPath(`${young}.part`), recent, recent);

    expect(await run()).toBe(1);
    expect(await onDisk(tmpPath(`${stray}.part`))).toBe(false);
    for (const name of [`${young}.part`, 'notes.txt', `${'D'.repeat(32)}.part`, `${live}.part`]) {
      expect(await onDisk(tmpPath(name)), name).toBe(true);
    }
  });

  it('6: deletes attached, cancelled and expired upload rows older than 7 days', async () => {
    const keys = [await receiving(), await receiving(), await receiving(), await receiving()];
    const statuses = ['attached', 'cancelled', 'expired', 'cancelled'];
    for (const [index, key] of keys.entries()) {
      await db('fileUploads')
        .where({ uploadKey: key })
        .update({
          status: statuses[index],
          expiresAt: new Date('2026-12-01T00:00:00Z'),
          updatedAt: new Date(index < 3 ? '2026-11-15T00:00:00Z' : '2026-11-20T00:00:00Z'),
        });
    }
    expect(await run()).toBe(3);
    expect((await db('fileUploads').select('uploadKey')).map((row) => row.uploadKey)).toEqual([
      keys[3],
    ]);
  });

  it('handles at most `limit` rows per part, and stops when the time budget is used', async () => {
    for (let index = 0; index < 3; index += 1) await receiving();
    setNowForTests(LATER);
    expect(await run({ limit: 2 })).toBe(2);
    expect(
      await db('fileUploads').where({ status: 'receiving' }).count({ n: '*' }).first(),
    ).toEqual({ n: 1 });
    expect(await run({ budgetMs: 0 })).toBe(0);
    expect(await run()).toBe(1);
  });

  it('skips a row it cannot clean (a missing .part is fine, EPERM is skipped) and goes on', async () => {
    const missing = await receiving();
    await fsp.unlink(partFilePath(missing));
    const first = await deletedFile(30, 'a.pdf');
    const second = await deletedFile(30, 'b.pdf');
    disk.removeFile.mockImplementation(async (target) => {
      if (target === storedFilePath(first.storageKey)) {
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      }
      return (await vi.importActual('@/modules/projectFiles/disk')).removeFile(target);
    });
    setNowForTests(LATER);
    expect(await run()).toBe(2);
    expect((await uploadRow(missing)).status).toBe('expired');
    expect(await fileRow(first.id)).toMatchObject({ status: 'deleted' });
    expect(await fileRow(second.id)).toBeUndefined();
    disk.removeFile.mockReset();
  });

  it('answers 0 without throwing when file storage is not usable', async () => {
    await receiving();
    projectFiles.resetStorageForTests();
    await fsp.rm(env.filesDir, { recursive: true, force: true });
    await fsp.mkdir(env.filesDir, { recursive: true });
    await fsp.writeFile(path.join(env.filesDir, 'stranger.txt'), 'x');
    setNowForTests(LATER);
    expect(await run()).toBe(0);
    expect(
      await db('fileUploads').where({ status: 'receiving' }).count({ n: '*' }).first(),
    ).toEqual({ n: 1 });
  });
});

describe('wipeStorageForReset', () => {
  it('removes only names Daybook makes, and only with the marker', async () => {
    const file = await projectFile({ user: pm, projectId: project.id });
    const key = (await fileRow(file.id)).storageKey;
    await fsp.writeFile(`${storedFilePath(key)}.t`, 'thumb');
    const part = await receiving();
    await fsp.writeFile(path.join(path.dirname(storedFilePath(key)), 'stranger.txt'), 'keep me');
    await fsp.writeFile(tmpPath('notes.txt'), 'keep me too');

    expect(await projectFiles.wipeStorageForReset()).toEqual({ removed: 3 });
    expect(await onDisk(storedFilePath(key))).toBe(false);
    expect(await onDisk(partFilePath(part))).toBe(false);
    expect(await onDisk(path.join(path.dirname(storedFilePath(key)), 'stranger.txt'))).toBe(true);
    expect(await onDisk(tmpPath('notes.txt'))).toBe(true);

    // Without the marker nothing is touched.
    await projectFile({ user: pm, projectId: project.id });
    await fsp.unlink(path.join(env.filesDir, '.daybook-files'));
    expect(await projectFiles.wipeStorageForReset()).toEqual({ removed: 0 });
    expect(await db('projectFiles').count({ n: '*' }).first()).toEqual({ n: 2 });
  });

  it('empties the month and year folders it leaves empty', async () => {
    const file = await projectFile({ user: pm, projectId: project.id });
    const key = (await fileRow(file.id)).storageKey;
    expect(await projectFiles.wipeStorageForReset()).toEqual({ removed: 1 });
    expect(await onDisk(path.dirname(storedFilePath(key)))).toBe(false);
    expect(await fsp.readdir(path.join(env.filesDir, 'files'))).toEqual([]);
  });
});
