// Deploy before migrate (CONTRACT 27 and 28): with migration 019 rolled back, the upload routes
// answer UPDATE_NEEDED (503), the task file reads count 0 without ending the caller's transaction,
// empty lists ask nothing, Space used reads as "update needed" and the files step counts 0; the
// link reads count nothing and the picker and link writes answer UPDATE_NEEDED. With only 020 rolled
// back, a save without links still commits and the picker says `linksReady: false`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase } from '../helpers/db.js';
import { createProject } from './dashboardKit.js';
import { createTask, emptyFilesDir, projectFile } from './projectFilesKit.js';

const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;
vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));
vi.mock('@/modules/reports', () => ({ reports: {} }));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const { projectFiles } = await import('@/modules/projectFiles');
const startRoute = await import('@/app/api/uploads/route.js');
const keyRoute = await import('@/app/api/uploads/[key]/route.js');
const piecesRoute = await import('@/app/api/uploads/[key]/pieces/route.js');
const finishRoute = await import('@/app/api/uploads/[key]/finish/route.js');

const EXPIRES = new Date('2026-12-30T04:00:00Z');
const KEY = 'a'.repeat(32);
let pm;
let project;
let task;

async function call(handler, { method = 'POST', key, body, query = '' }) {
  const request = new Request(`${env.appOrigin}/api/uploads${key ? `/${key}` : ''}${query}`, {
    method,
    headers: { origin: env.appOrigin, 'content-type': 'application/json', 'content-length': '2' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve({ key }) });
  return { status: response.status, json: await response.json() };
}

beforeAll(async () => {
  await resetDatabase();
  await emptyFilesDir();
  setNowForTests('2026-11-23T06:00:00Z');
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  project = await createProject(pm, { name: 'acme-store' });
  task = await createTask(project);
  await db.migrate.down({ name: '020_task_file_links.js' });
  await db.migrate.down({ name: '019_project_files.js' });
  sessionUser = { ...pm, status: 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
});

afterAll(async () => {
  await db.migrate.latest();
});

describe('before migration 019', () => {
  it('answers UPDATE_NEEDED (503) on every upload route', async () => {
    const start = {
      projectId: project.id,
      target: 'project',
      phase: null,
      visibility: 'everyone',
      name: 'brief.pdf',
      size: 10,
    };
    const answers = [
      await call(startRoute.POST, { body: start }),
      await call(keyRoute.GET, { method: 'GET', key: KEY }),
      await call(keyRoute.DELETE, { method: 'DELETE', key: KEY }),
      await call(piecesRoute.POST, { key: KEY, query: '?offset=0' }),
      await call(finishRoute.POST, { key: KEY }),
    ];
    for (const answer of answers) {
      expect(answer).toMatchObject({
        status: 503,
        json: {
          error: {
            code: 'UPDATE_NEEDED',
            message: 'This needs the latest database update. Ask an Admin.',
          },
        },
      });
    }
  });

  it('counts 0 inside a task transaction that still commits; empty lists ask nothing', async () => {
    await db.transaction(async (trx) => {
      expect(await projectFiles.countActiveForTask(task.id, trx)).toBe(0);
      expect(await projectFiles.deleteFilesOfTask({ user: pm, taskId: task.id }, trx)).toBe(0);
      const args = { user: pm, projectId: project.id, taskId: task.id };
      expect(await projectFiles.attachUploads({ ...args, uploadKeys: [] }, trx)).toEqual([]);
      expect(await projectFiles.removeTaskFiles({ ...args, fileIds: [] }, trx)).toEqual([]);
      await trx('projectTasks').where({ id: task.id }).update({ title: 'Still saved' });
    });
    expect((await db('projectTasks').where({ id: task.id }).first()).title).toBe('Still saved');
  });

  it('answers UPDATE_NEEDED for a save that names upload keys or file ids', async () => {
    const args = { user: pm, projectId: project.id, taskId: task.id };
    await expect(
      db.transaction((trx) => projectFiles.attachUploads({ ...args, uploadKeys: [KEY] }, trx)),
    ).rejects.toMatchObject({ code: 'UPDATE_NEEDED', status: 503 });
    await expect(
      db.transaction((trx) => projectFiles.removeTaskFiles({ ...args, fileIds: [1] }, trx)),
    ).rejects.toMatchObject({ code: 'UPDATE_NEEDED', status: 503 });
  });

  it('reads Space used as "update needed", keeps the limits and counts 0 in the cleanup', async () => {
    expect(await projectFiles.spaceUsage()).toEqual({
      usedBytes: 0,
      heldBytes: 0,
      deletedBytes: 0,
      fileCount: 0,
      projectCount: 0,
      diskFullAt: null,
      updateNeeded: true,
      limitBytes: 10 * 1024 ** 3,
      storage: { ready: true, problem: null },
    });
    expect(await projectFiles.limits()).toEqual({
      maxFileBytes: 500 * 1024 ** 2,
      maxTaskFiles: 20,
      pickMax: 50,
    });
    expect(await projectFiles.cleanUp({ limit: 500, budgetMs: 20_000 })).toBe(0);
  });
});

describe('links before migration 019 (CONTRACT 28)', () => {
  it('reads no links inside a task transaction that still commits; writes need the update', async () => {
    await db.transaction(async (trx) => {
      expect(await projectFiles.countActiveLinks(task.id, trx)).toBe(0);
      expect(await projectFiles.privateLinkCounts([task.id], trx)).toEqual({});
      const save = { user: pm, project, task: { id: task.id, assigneeId: null } };
      expect(await projectFiles.linkFiles({ ...save, fileIds: [] }, trx)).toEqual([]);
      expect(await projectFiles.unlinkFiles({ ...save, fileIds: [] }, trx)).toEqual([]);
      await trx('projectTasks').where({ id: task.id }).update({ title: 'Saved again' });
    });
    expect((await db('projectTasks').where({ id: task.id }).first()).title).toBe('Saved again');
    expect(await projectFiles.chipsForTasks({ viewer: pm, tasks: [task] })).toEqual({});
    const save = { user: pm, project, task: { id: task.id, assigneeId: null }, fileIds: [1] };
    await expect(db.transaction((trx) => projectFiles.linkFiles(save, trx))).rejects.toMatchObject({
      code: 'UPDATE_NEEDED',
      status: 503,
    });
    await expect(
      projectFiles.pickerFiles({ viewer: pm, projectId: project.id }),
    ).rejects.toMatchObject({ code: 'UPDATE_NEEDED', status: 503 });
  });
});

describe('before migration 020 only (CONTRACT 28)', () => {
  let file;

  beforeAll(async () => {
    await db.migrate.latest();
    file = await projectFile({ user: pm, projectId: project.id, name: 'brief.pdf' });
    await db.migrate.down({ name: '020_task_file_links.js' });
  });

  it('commits a save without links, refuses one with links, and the picker waits', async () => {
    await db.transaction(async (trx) => {
      expect(await projectFiles.countActiveLinks(task.id, trx)).toBe(0);
      await trx('projectTasks').where({ id: task.id }).update({ title: 'Without links' });
    });
    expect((await db('projectTasks').where({ id: task.id }).first()).title).toBe('Without links');
    const save = { user: pm, project, task: { id: task.id, assigneeId: null }, fileIds: [file.id] };
    await expect(db.transaction((trx) => projectFiles.linkFiles(save, trx))).rejects.toMatchObject({
      code: 'UPDATE_NEEDED',
      status: 503,
    });
    const unlink = { user: pm, taskId: task.id, fileId: file.id };
    await expect(projectFiles.unlinkFile(unlink)).rejects.toMatchObject({ code: 'UPDATE_NEEDED' });
    const picker = await projectFiles.pickerFiles({ viewer: pm, projectId: project.id });
    expect(picker).toEqual({ files: [], places: [], taskPhase: null, linksReady: false });
  });
});
