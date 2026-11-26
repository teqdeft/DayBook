// Managing files (CONTRACT 27, Modules "Management"): rename by base name (cleaned, the extension
// kept), move and change who sees a project file, a task file's place refused, the soft delete
// (never listed, counted or served again), who may change a file (403 to a member who can see it,
// 404 to anyone who can't), syncFileDocument called inside each transaction (the document itself is
// E's test), audit rows without the name, the routes, a file on tasks through links (CONTRACT 28:
// changed and deleted in one place, links kept until the purge), and before migrations 020 and 019.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import {
  createTask,
  emptyFilesDir,
  expectCode,
  fileRow,
  linkFile,
  linkRowsOf,
  onDisk,
  projectFile,
  storedFilePath,
  taskFile,
} from './projectFilesKit.js';

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
const { resetRateLimitsForTests } = await import('@/lib/route');
const { projectFiles } = await import('@/modules/projectFiles');
const { projectSummaries } = await import('@/modules/projectSummaries');
const fileRoute = await import('@/app/api/project-files/[id]/route.js');

const T0 = '2026-11-23T06:00:00Z';
const T1 = '2026-11-23T07:00:00Z';
const EXPIRES = new Date('2026-12-30T04:00:00Z');
const NOT_FOUND = "We couldn't find that file.";
const CANT_CHANGE = "You can't change files on this project.";
const TASK_PLACE = "A task's files go where the task goes.";

let admin;
let pm;
let otherPm;
let member;
let project;
let task;

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

/** A file route call as the browser sends it (Origin set, JSON body). */
async function call(method, id, body) {
  const request = new Request(`${env.appOrigin}/api/project-files/${id}`, {
    method,
    headers: { origin: env.appOrigin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await fileRoute[method](request, {
    params: Promise.resolve({ id: String(id) }),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

/** The audit rows of a file's changes (Finish wrote its `project_file.add` row). */
const auditRows = (id) =>
  db('auditLogs')
    .where({ entityType: 'project_file', entityId: id })
    .whereNot({ action: 'project_file.add' })
    .orderBy('id');

const newFile = (overrides = {}) =>
  projectFile({ user: pm, projectId: project.id, phase: 'design', ...overrides });

beforeAll(async () => {
  setNowForTests(T0);
  await resetDatabase();
  await emptyFilesDir();
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  otherPm = await createUser({ name: 'Omar Other', role: 'pm', tracksAttendance: false });
  member = await createUser({ name: 'Vishal Saini' });
  project = await createProject(pm, { name: 'acme-store' });
  await addMembers(project, [member]);
  task = await createTask(project, { assigneeId: member.id, phase: 'development' });
});

beforeEach(() => {
  setNowForTests(T0);
  resetRateLimitsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionUser = null;
  jar.clear();
});

describe('updateFile', () => {
  it('renames by the base name, cleaned, and keeps the stored extension', async () => {
    const file = await newFile({ name: 'brief.pdf' });
    setNowForTests(T1);
    const renamed = await projectFiles.updateFile({
      user: pm,
      id: file.id,
      input: { name: '  folder/final <draft>.docx  ' },
    });
    expect(renamed).toMatchObject({ id: file.id, name: 'final _draft_.docx.pdf', ext: 'pdf' });
    expect(renamed.kind).toBe('pdf');
    const row = await fileRow(file.id);
    expect(row).toMatchObject({ name: 'final _draft_.docx.pdf', ext: 'pdf', updatedBy: pm.id });
    expect(row.updatedAt.toISOString()).toBe(new Date(T1).toISOString());
  });

  it('never gives a file stored without an extension one, so no program comes without its line', async () => {
    const file = await newFile({ name: 'README' });
    expect(file).toMatchObject({ ext: '', kind: 'file' });
    const renamed = await projectFiles.updateFile({
      user: pm,
      id: file.id,
      input: { name: 'setup.exe' },
    });
    expect(renamed).toMatchObject({ name: 'setup_exe', ext: '', kind: 'file', typeLabel: 'File' });
    expect(await fileRow(file.id)).toMatchObject({ name: 'setup_exe', ext: '' });
    const seen = await projectFiles.getForDownload({ viewer: member, id: file.id });
    expect(seen.file.name).toBe('setup_exe');
  });

  it('moves a project file and changes who sees it; members follow at once', async () => {
    const file = await newFile({ name: 'scope.pdf', visibility: 'managers' });
    const seen = async () =>
      (await projectFiles.listForProject({ viewer: member, projectId: project.id })).files.some(
        (item) => item.id === file.id,
      );
    expect(await seen()).toBe(false);
    const moved = await projectFiles.updateFile({
      user: admin,
      id: file.id,
      input: { phase: null, visibility: 'everyone' },
    });
    expect(moved).toMatchObject({ phase: null, visibility: 'everyone', canManage: true });
    expect(await seen()).toBe(true);
    await projectFiles.updateFile({ user: pm, id: file.id, input: { phase: 'testing' } });
    expect(await fileRow(file.id)).toMatchObject({ phase: 'testing', visibility: 'everyone' });
  });

  it("refuses a task file's place or who sees it, but renames it", async () => {
    const file = await taskFile({ user: pm, projectId: project.id, taskId: task.id });
    const error = await expectCode(
      projectFiles.updateFile({ user: pm, id: file.id, input: { phase: 'testing' } }),
      'VALIDATION_FAILED',
    );
    expect(error.message).toBe(TASK_PLACE);
    expect(error.fields).toEqual({ phase: TASK_PLACE });
    const both = await expectCode(
      projectFiles.updateFile({
        user: pm,
        id: file.id,
        input: { name: 'x', visibility: 'everyone' },
      }),
      'VALIDATION_FAILED',
    );
    expect(both.fields).toEqual({ visibility: TASK_PLACE });
    expect((await fileRow(file.id)).name).toBe('brief.pdf');
    const renamed = await projectFiles.updateFile({
      user: pm,
      id: file.id,
      input: { name: 'login steps' },
    });
    expect(renamed).toMatchObject({ name: 'login steps.pdf', scope: 'task', phase: null });
  });

  it('checks the input: a name, something to change', async () => {
    const file = await newFile();
    const empty = await expectCode(
      projectFiles.updateFile({ user: pm, id: file.id, input: {} }),
      'VALIDATION_FAILED',
    );
    expect(empty.message).toBe('Nothing to change.');
    const blank = await expectCode(
      projectFiles.updateFile({ user: pm, id: file.id, input: { name: '   ' } }),
      'VALIDATION_FAILED',
    );
    expect(blank.fields).toEqual({ name: 'Write a name.' });
    const long = await expectCode(
      projectFiles.updateFile({ user: pm, id: file.id, input: { name: 'a'.repeat(201) } }),
      'VALIDATION_FAILED',
    );
    expect(long.fields).toEqual({ name: 'Keep the name to 200 characters.' });
  });

  it('writes nothing when nothing really changes', async () => {
    const file = await newFile({ name: 'same.pdf' });
    const spy = vi.spyOn(projectSummaries, 'syncFileDocument');
    await projectFiles.updateFile({
      user: pm,
      id: file.id,
      input: { name: 'same', phase: 'design' },
    });
    expect(spy).not.toHaveBeenCalled();
    expect(await auditRows(file.id)).toEqual([]);
  });

  it('audits the place and who sees it, and only whether the name changed', async () => {
    const file = await newFile({ name: 'secret-contract.pdf', visibility: 'managers' });
    await projectFiles.updateFile({
      user: pm,
      id: file.id,
      input: { name: 'renamed-contract', visibility: 'everyone' },
      ip: '203.0.113.9',
    });
    const [row] = await auditRows(file.id);
    expect(row).toMatchObject({ action: 'project_file.update', actorId: pm.id, ip: '203.0.113.9' });
    expect(parseJson(row.before)).toEqual({
      phase: 'design',
      visibility: 'managers',
      nameChanged: true,
    });
    expect(parseJson(row.after)).toEqual({
      phase: 'design',
      visibility: 'everyone',
      nameChanged: true,
    });
    expect(`${row.before}${row.after}`).not.toMatch(/contract/);
  });
});

describe('removeFile', () => {
  it('soft deletes: never listed, counted or served again; the disk file stays for the cleanup', async () => {
    const file = await taskFile({
      user: pm,
      projectId: project.id,
      taskId: task.id,
      name: 'a.pdf',
    });
    const before = await projectFiles.countsForTasks({ viewer: member, tasks: [task] });
    setNowForTests(T1);
    expect(await projectFiles.removeFile({ user: pm, id: file.id })).toEqual({ id: file.id });
    const row = await fileRow(file.id);
    expect(row).toMatchObject({ status: 'deleted', deletedBy: pm.id });
    expect(row.deletedAt.toISOString()).toBe(new Date(T1).toISOString());
    expect(await onDisk(storedFilePath(row.storageKey))).toBe(true);
    const after = await projectFiles.countsForTasks({ viewer: member, tasks: [task] });
    expect((after[task.id] ?? 0) + 1).toBe(before[task.id]);
    const list = await projectFiles.listForProject({ viewer: pm, projectId: project.id });
    expect(list.files.map((item) => item.id)).not.toContain(file.id);
    expect(await projectFiles.listForTask({ viewer: pm, task })).not.toContainEqual(
      expect.objectContaining({ id: file.id }),
    );
    await expectCode(projectFiles.getForDownload({ viewer: pm, id: file.id }), 'NOT_FOUND');
    // Deleting it again finds nothing.
    await expectCode(projectFiles.removeFile({ user: pm, id: file.id }), 'NOT_FOUND');
  });

  it('audits the delete with ids and numbers, never the name', async () => {
    const file = await newFile({ name: 'secret-contract.pdf', visibility: 'managers' });
    await projectFiles.removeFile({ user: admin, id: file.id, ip: '203.0.113.9' });
    const [row] = await auditRows(file.id);
    expect(row).toMatchObject({ action: 'project_file.delete', actorId: admin.id });
    expect(parseJson(row.before)).toEqual({
      projectId: project.id,
      scope: 'project',
      taskId: null,
      phase: 'design',
      visibility: 'managers',
      sizeBytes: file.sizeBytes,
      ext: 'pdf',
    });
    expect(row.before).not.toMatch(/contract/);
  });
});

describe('who may change a file', () => {
  it('403 to a member who can see it, 404 to a member or another PM who cannot', async () => {
    const everyone = await newFile({ visibility: 'everyone' });
    const managers = await newFile({ visibility: 'managers' });
    const forbidden = await expectCode(
      projectFiles.updateFile({ user: member, id: everyone.id, input: { name: 'x' } }),
      'FORBIDDEN',
    );
    expect(forbidden.message).toBe(CANT_CHANGE);
    await expectCode(projectFiles.removeFile({ user: member, id: everyone.id }), 'FORBIDDEN');
    for (const [user, file] of [
      [member, managers],
      [otherPm, everyone],
      [otherPm, managers],
    ]) {
      const error = await expectCode(
        projectFiles.updateFile({ user, id: file.id, input: { name: 'x' } }),
        'NOT_FOUND',
      );
      expect(error.message).toBe(NOT_FOUND);
      await expectCode(projectFiles.removeFile({ user, id: file.id }), 'NOT_FOUND');
    }
    expect(await fileRow(everyone.id)).toMatchObject({ status: 'active', name: 'brief.pdf' });
  });

  it('an unknown or malformed id is NOT_FOUND', async () => {
    for (const id of [999999, 'abc', 0, null]) {
      await expectCode(
        projectFiles.updateFile({ user: pm, id, input: { name: 'x' } }),
        'NOT_FOUND',
      );
      await expectCode(projectFiles.removeFile({ user: pm, id }), 'NOT_FOUND');
    }
  });
});

describe('syncFileDocument inside the transaction', () => {
  const isTransaction = (trx) => Boolean(trx?.isTransaction);

  it('rename, move and delete call it with the right arguments', async () => {
    const file = await newFile({ name: 'brief.pdf' });
    const spy = vi.spyOn(projectSummaries, 'syncFileDocument');
    await projectFiles.updateFile({ user: pm, id: file.id, input: { name: 'scope' } });
    expect(spy).toHaveBeenLastCalledWith(
      { fileId: file.id, title: 'scope.pdf', phase: undefined },
      expect.anything(),
    );
    expect(isTransaction(spy.mock.lastCall[1])).toBe(true);
    await projectFiles.updateFile({ user: pm, id: file.id, input: { phase: null } });
    expect(spy).toHaveBeenLastCalledWith(
      { fileId: file.id, title: undefined, phase: null },
      expect.anything(),
    );
    await projectFiles.updateFile({ user: pm, id: file.id, input: { visibility: 'managers' } });
    expect(spy).toHaveBeenCalledTimes(2); // who sees a file never touches its text
    await projectFiles.removeFile({ user: pm, id: file.id });
    expect(spy).toHaveBeenLastCalledWith({ fileId: file.id, remove: true }, expect.anything());
    expect(isTransaction(spy.mock.lastCall[1])).toBe(true);
  });

  it("a failure there undoes the file's change", async () => {
    const file = await newFile({ name: 'keep.pdf' });
    vi.spyOn(projectSummaries, 'syncFileDocument').mockRejectedValue(new Error('boom'));
    await expect(
      projectFiles.updateFile({ user: pm, id: file.id, input: { name: 'lost' } }),
    ).rejects.toThrow('boom');
    await expect(projectFiles.removeFile({ user: pm, id: file.id })).rejects.toThrow('boom');
    expect(await fileRow(file.id)).toMatchObject({ name: 'keep.pdf', status: 'active' });
    expect(await auditRows(file.id)).toEqual([]);
  });

  it('task files have no text, so their changes never call it', async () => {
    const file = await taskFile({ user: pm, projectId: project.id, taskId: task.id });
    const spy = vi.spyOn(projectSummaries, 'syncFileDocument');
    await projectFiles.updateFile({ user: pm, id: file.id, input: { name: 'renamed' } });
    await projectFiles.removeFile({ user: pm, id: file.id });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('hasText', () => {
  it('marks a project file whose text a document holds, for managers only', async () => {
    const file = await newFile({ name: 'scope.pdf', visibility: 'everyone' });
    await db('projectDocuments').insert({
      projectId: project.id,
      phase: 'design',
      kind: 'file',
      title: 'scope.pdf',
      body: 'Scope text.',
      pages: 1,
      pagesTotal: 1,
      charCount: 11,
      visibility: 'managers',
      fileId: file.id,
      createdBy: pm.id,
    });
    const find = async (viewer) =>
      (await projectFiles.listForProject({ viewer, projectId: project.id })).files.find(
        (item) => item.id === file.id,
      );
    expect((await find(pm)).hasText).toBe(true);
    expect((await find(member)).hasText).toBe(false);
    const renamed = await projectFiles.updateFile({ user: pm, id: file.id, input: { name: 'x' } });
    expect(renamed.hasText).toBe(true);
  });
});

describe('the routes', () => {
  it('PATCH answers { file }, DELETE { id }; errors keep their codes', async () => {
    const file = await newFile({ name: 'route.pdf' });
    signInAs(pm);
    const patched = await call('PATCH', file.id, { name: 'routed' });
    expect(patched.status).toBe(200);
    expect(patched.json.data.file).toMatchObject({ id: file.id, name: 'routed.pdf' });
    const bad = await call('PATCH', file.id, { phase: 'nowhere' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.fields).toEqual({ phase: 'Pick a place from the list.' });
    signInAs(member);
    expect((await call('PATCH', file.id, { name: 'x' })).status).toBe(403);
    expect((await call('DELETE', file.id)).status).toBe(403);
    signInAs(otherPm);
    const hidden = await call('DELETE', file.id);
    expect(hidden.status).toBe(404);
    expect(hidden.json.error.message).toBe(NOT_FOUND);
    signInAs(pm);
    const removed = await call('DELETE', file.id);
    expect(removed).toEqual({ status: 200, json: { data: { id: file.id } } });
  });

  it('counts 120 edits and deletes a minute per person', async () => {
    signInAs(member);
    for (let index = 0; index < 120; index += 1) {
      expect((await call('DELETE', 999999)).status).toBe(404);
    }
    const limited = await call('PATCH', 999999, { name: 'x' });
    expect(limited.status).toBe(429);
    signInAs(pm);
    expect((await call('DELETE', 999999)).status).toBe(404);
  });

  it('refuses a body far bigger than any edit before reading it', async () => {
    signInAs(pm);
    const big = await call('PATCH', 1, { name: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
  });
});

describe('a file linked to tasks (CONTRACT 28)', () => {
  it('keeps its links through a rename, a move and a change of who sees it', async () => {
    const file = await newFile({ name: 'plan.pdf', visibility: 'everyone' });
    await linkFile({ user: pm, project, task, fileIds: file.id });
    const input = { name: 'launch plan', phase: 'launch', visibility: 'managers' };
    const changed = await projectFiles.updateFile({ user: pm, id: file.id, input });
    expect(changed).toMatchObject({ name: 'launch plan.pdf', phase: 'launch' });
    expect((await linkRowsOf(task.id)).map((row) => row.fileId)).toContain(file.id);
    // Now "Only PM and Admins": still open to the task's person through the task.
    const shown = await projectFiles.listForTask({ viewer: member, task });
    expect(shown.find((one) => one.id === file.id)).toMatchObject({
      name: 'launch plan.pdf',
      linked: true,
    });
  });

  it('a delete takes it off every task at once; the links stay until the purge', async () => {
    const file = await newFile({ name: 'old.pdf', visibility: 'everyone' });
    await linkFile({ user: pm, project, task, fileIds: file.id });
    await projectFiles.removeFile({ user: pm, id: file.id });
    const ids = (await projectFiles.listForTask({ viewer: pm, task })).map((one) => one.id);
    expect(ids).not.toContain(file.id);
    expect((await linkRowsOf(task.id)).map((row) => row.fileId)).toContain(file.id);
    const audits = await auditRows(file.id);
    expect(audits.map((row) => row.action)).toEqual(['project_file.link', 'project_file.delete']);
  });
});

describe('before migration 020', () => {
  let file;

  beforeAll(async () => {
    file = await newFile({ name: 'before-020.pdf' });
    await db.migrate.down({ name: '020_task_file_links.js' });
  });

  afterAll(async () => {
    await db.migrate.latest();
  });

  it('renames and deletes as 1.12; the Files tab has no links', async () => {
    const renamed = await projectFiles.updateFile({ user: pm, id: file.id, input: { name: 'b' } });
    expect(renamed).toMatchObject({ name: 'b.pdf', linkCount: 0, linkedTasks: [] });
    const list = await projectFiles.listForProject({ viewer: pm, projectId: project.id });
    expect(list.links).toEqual([]);
    expect(list.files.find((one) => one.id === file.id)).toMatchObject({ linkCount: 0 });
    await projectFiles.removeFile({ user: pm, id: file.id });
    expect((await fileRow(file.id)).status).toBe('deleted');
  });
});

describe('before migration 019', () => {
  let file;

  beforeAll(async () => {
    file = await newFile({ name: 'before.pdf' });
    await db.migrate.down({ name: '020_task_file_links.js' });
    await db.migrate.down({ name: '019_project_files.js' });
  });

  afterAll(async () => {
    await db.migrate.latest();
  });

  it('lists and counts read as empty, never failing a page', async () => {
    const list = await projectFiles.listForProject({ viewer: pm, projectId: project.id });
    expect(list).toEqual({ files: [], links: [], canSee: true, canManage: true });
    expect(await projectFiles.listForTask({ viewer: member, task })).toEqual([]);
    expect(await projectFiles.countsForTasks({ viewer: member, tasks: [task] })).toEqual({});
    expect(
      await projectFiles.countTaskFilesForMember({ userId: member.id, projectIds: [project.id] }),
    ).toEqual({});
  });

  it('downloads, edits and deletes answer UPDATE_NEEDED', async () => {
    // Each call starts only when it is awaited: one started early could fail before its handler
    // is there, an unhandled rejection that fails the whole run.
    for (const run of [
      () => projectFiles.getForDownload({ viewer: pm, id: file.id }),
      () => projectFiles.updateFile({ user: pm, id: file.id, input: { name: 'x' } }),
      () => projectFiles.removeFile({ user: pm, id: file.id }),
      () => projectFiles.fileForDocument({ projectId: project.id, fileId: file.id }),
    ]) {
      const error = await expectCode(run(), 'UPDATE_NEEDED');
      expect(error.status).toBe(503);
      expect(error.message).toBe('This needs the latest database update. Ask an Admin.');
    }
    signInAs(pm);
    const route = await call('DELETE', file.id);
    expect(route.status).toBe(503);
    expect(route.json.error.code).toBe('UPDATE_NEEDED');
  });
});
