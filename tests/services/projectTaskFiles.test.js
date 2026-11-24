// Files on tasks (CONTRACT 27, Task files and Notifications): create with upload keys, edit with
// files added and removed, POST /api/project-tasks/:id/files, told and toldName, the 20-file limit
// under the task row lock, refused keys with nothing written, a task delete taking its files,
// GET /api/project-tasks/:id and getForViewer per viewer, countsByPhase, and the task writes
// before migration 019. Files are made through the shared kit (projectFiles.storeFile).
import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { resetRateLimitsForTests } from '@/lib/route';
import { setNowForTests } from '@/lib/time';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject, createReport } from './dashboardKit.js';
import { emptyFilesDir, expectCode, heldUpload, pngBytes, taskFile } from './projectFilesKit.js';

const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;

vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));
// The reports module belongs to another owner; the projects module imports it for requests.
vi.mock('@/modules/reports', () => ({
  reports: {
    hasEntriesForProjectRequest: vi.fn(async () => false),
    moveProjectRequestEntries: vi.fn(async () => 0),
  },
}));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const taskRoute = await import('@/app/api/project-tasks/[id]/route.js');
const filesRoute = await import('@/app/api/project-tasks/[id]/files/route.js');

const T0 = '2026-11-23T05:00:00Z';
const EXPIRES = new Date('2026-11-30T05:00:00Z');

let admin;
let pm; // Riya: the PM of acme and side, never a member
let pm2; // another PM, not on acme
let pmMember; // another PM who is a member of acme
let vishal;
let simran;
let gone; // a deactivated member
let hr; // HR, not on acme
let outsider; // an employee on side only
let acme; // pm: vishal, simran, pmMember, gone
let side; // pm: outsider

const add = (input, user = pm, project = acme) =>
  projectTasks.create({ user, projectId: project.id, input, ip: '10.0.0.1' });
const edit = (task, input, user = pm) =>
  projectTasks.update({ user, id: task.id, input, ip: '10.0.0.1' });
const attach = (task, uploadKeys, user = pm) =>
  projectTasks.attachFiles({ user, id: task.id, uploadKeys, ip: '10.0.0.1' });
const held = (name = 'brief.pdf', { user = pm, project = acme, taskId = null } = {}) =>
  heldUpload({ user, projectId: project.id, taskId, name }).then(({ key }) => key);
const fileOn = (task, name = 'brief.pdf', user = pm) =>
  taskFile({ user, projectId: task.projectId, taskId: task.id, name });
const notes = (type) => db('notifications').where({ type }).orderBy('id');
const activeFiles = (taskId) =>
  db('projectFiles').where({ taskId, status: 'active' }).orderBy('id').select('id', 'name');
const randomKey = () => crypto.randomBytes(16).toString('hex');

/** Fills a task up to `count` active file rows straight in the table (no disk: only counted). */
async function fillFiles(task, count) {
  for (let index = 0; index < count; index += 1) {
    const at = new Date(T0);
    await db('projectFiles').insert({
      projectId: task.projectId,
      scope: 'task',
      taskId: task.id,
      phase: null,
      visibility: 'managers',
      status: 'active',
      name: `filler-${index}.txt`,
      ext: 'txt',
      sizeBytes: 10,
      storageKey: `2026/11/${randomKey()}`,
      createdBy: pm.id,
      createdAt: at,
      updatedAt: at,
    });
  }
}

async function fieldError(promise) {
  const error = await expectCode(promise, 'VALIDATION_FAILED');
  return error.fields ?? {};
}

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function call(handler, { method = 'GET', path, id, body }) {
  const request = new Request(`${env.appOrigin}${path}`, {
    method,
    headers: { origin: env.appOrigin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve({ id: String(id) }) });
  return { status: response.status, json: await response.json() };
}

const getTask = (id) => call(taskRoute.GET, { path: `/api/project-tasks/${id}`, id });
const postFiles = (id, body) =>
  call(filesRoute.POST, { method: 'POST', path: `/api/project-tasks/${id}/files`, id, body });

beforeAll(async () => {
  await resetDatabase();
  await emptyFilesDir();
  setNowForTests(T0);
  admin = await createUser({ name: 'The CEO', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  pm2 = await createUser({ name: 'Paul Other', role: 'pm', tracksAttendance: false });
  pmMember = await createUser({ name: 'Pia Member', role: 'pm', tracksAttendance: false });
  vishal = await createUser({ name: 'Vishal Saini' });
  simran = await createUser({ name: 'Simran Kaur' });
  gone = await createUser({ name: 'Gus Gone' });
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  outsider = await createUser({ name: 'Otto Outsider' });
  acme = await createProject(pm, { name: 'acme-store' });
  side = await createProject(pm, { name: 'side-project' });
  await addMembers(acme, [vishal, simran, pmMember, gone]);
  await addMembers(side, [outsider]);
  await db('users').where({ id: gone.id }).update({ status: 'deactivated' });
});

afterAll(async () => {
  await emptyFilesDir();
});

beforeEach(async () => {
  setNowForTests(T0);
  resetRateLimitsForTests();
  jar.clear();
  sessionUser = null;
  await db('notifications').del();
});

describe('create with upload keys', () => {
  it('attaches the files and names them in the added body, after the first sentence', async () => {
    const keys = [await held('brief.pdf'), await held('logo.png')];
    const task = await add({
      title: 'Fix the login page',
      details: 'Use the new logo.',
      priority: 'p1',
      phase: 'development',
      assigneeId: vishal.id,
      uploadKeys: keys,
    });
    expect(task).toMatchObject({ told: 'person', toldName: 'Vishal Saini' });
    expect((await activeFiles(task.id)).map((file) => file.name)).toEqual([
      'brief.pdf',
      'logo.png',
    ]);
    const [row] = await notes('project_task.added');
    expect(row).toMatchObject({
      userId: vishal.id,
      body: 'Riya Kapoor assigned it to you. 2 files attached: brief.pdf, logo.png. Use the new logo.',
      link: `/projects/${acme.id}?task=${task.id}`,
    });
    const uploads = await db('fileUploads').whereIn('uploadKey', keys);
    expect(uploads.map((upload) => upload.status)).toEqual(['attached', 'attached']);
    // Audit lines for the files: ids and sizes, never the name.
    const lines = await db('auditLogs').where({
      action: 'project_file.add',
      entityType: 'project_file',
    });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(JSON.stringify(line)).not.toContain('brief.pdf');
  });

  it('tells everyone on the project for an Anyone task, and no files_added on create', async () => {
    const task = await add({ title: 'Shared brief', uploadKeys: [await held('brief.pdf')] });
    expect(task).toMatchObject({ told: 'members', toldName: null });
    const rows = await notes('project_task.added');
    expect(rows.map((row) => row.userId).sort((a, b) => a - b)).toEqual(
      [vishal.id, simran.id, pmMember.id].sort((a, b) => a - b),
    );
    expect(rows[0].body).toBe(
      'Riya Kapoor added it for anyone on the project. 1 file attached: brief.pdf.',
    );
    expect(await notes('project_task.files_added')).toEqual([]);
  });

  it("refuses someone else's, another project's, an expired and an unknown key, writing nothing", async () => {
    const before = await db('projectTasks').count({ n: '*' }).first();
    const filesBefore = await db('projectFiles').count({ n: '*' }).first();
    const others = await held('theirs.pdf', { user: admin });
    let fields = await fieldError(add({ title: 'Not mine', uploadKeys: [others] }));
    expect(fields.uploadKeys).toBe("A file couldn't be added. Add it again.");
    const elsewhere = await held('elsewhere.pdf', { project: side });
    fields = await fieldError(add({ title: 'Wrong place', uploadKeys: [elsewhere] }));
    expect(fields.uploadKeys).toBe("elsewhere.pdf couldn't be added. Add it again.");
    const old = await held('old.pdf');
    await db('fileUploads')
      .where({ uploadKey: old })
      .update({ expiresAt: new Date('2026-11-23T04:00:00Z') });
    fields = await fieldError(add({ title: 'Too late', uploadKeys: [await held('ok.pdf'), old] }));
    expect(fields.uploadKeys).toBe("old.pdf couldn't be added. Add it again.");
    fields = await fieldError(add({ title: 'Unknown', uploadKeys: [randomKey()] }));
    expect(fields.uploadKeys).toBe("A file couldn't be added. Add it again.");
    expect(await db('projectTasks').count({ n: '*' }).first()).toEqual(before);
    expect(await db('projectFiles').count({ n: '*' }).first()).toEqual(filesBefore);
    expect(await notes('project_task.added')).toEqual([]);
  });
});

describe('edit with files', () => {
  it('removes first, then adds; an id already deleted is skipped', async () => {
    const task = await add({ title: 'Checkout fix', assigneeId: simran.id });
    const first = await fileOn(task, 'old.pdf');
    const second = await fileOn(task, 'keep.pdf');
    await db('notifications').del();
    const saved = await edit(task, {
      removeFileIds: [first.id],
      addUploadKeys: [await held('new.png', { taskId: task.id })],
    });
    expect(saved).toMatchObject({ title: 'Checkout fix', told: 'person', toldName: 'Simran Kaur' });
    expect((await activeFiles(task.id)).map((file) => file.name)).toEqual(['keep.pdf', 'new.png']);
    const gone1 = await db('projectFiles').where({ id: first.id }).first();
    expect(gone1).toMatchObject({ status: 'deleted', deletedBy: pm.id });
    // Files added alone: files_added, to the person only.
    const [row] = await notes('project_task.files_added');
    expect(row).toMatchObject({
      userId: simran.id,
      title: 'Riya Kapoor added 1 file to Checkout fix',
      body: 'acme-store: new.png',
      link: `/projects/${acme.id}?task=${task.id}`,
    });
    expect(await notes('project_task.changed')).toEqual([]);
    // The same id again: already gone as asked, so nothing changes and nothing is said.
    const again = await edit(task, { removeFileIds: [first.id] });
    expect(again).toMatchObject({ told: null, toldName: null });
    expect(await notes('project_task.files_added')).toHaveLength(1);
    expect((await activeFiles(task.id)).map((file) => file.id)).toContain(second.id);
  });

  it("refuses another task's file id, writing nothing", async () => {
    const task = await add({ title: 'Mine' });
    const other = await add({ title: 'Other' });
    const file = await fileOn(other, 'other.pdf');
    const fields = await fieldError(
      edit(task, { title: 'Renamed', removeFileIds: [file.id, 999999] }),
    );
    expect(fields.removeFileIds).toBe("That file isn't on this task any more.");
    expect((await db('projectTasks').where({ id: task.id }).first()).title).toBe('Mine');
    expect(await db('projectFiles').where({ id: file.id }).first()).toMatchObject({
      status: 'active',
    });
  });

  it('puts the files line in changed when the same save changes the priority', async () => {
    const task = await add({ title: 'Login copy', priority: 'p2', assigneeId: vishal.id });
    await db('notifications').del();
    const saved = await edit(task, {
      priority: 'p1',
      addUploadKeys: [await held('copy.docx', { taskId: task.id })],
    });
    expect(saved).toMatchObject({ priority: 'p1', told: 'person', toldName: 'Vishal Saini' });
    const [row] = await notes('project_task.changed');
    expect(row.body).toBe('Riya Kapoor changed it from P2 to P1. 1 file attached: copy.docx.');
    expect(await notes('project_task.files_added')).toEqual([]);
  });

  it('removing files alone tells nobody', async () => {
    const task = await add({ title: 'Clean up', assigneeId: vishal.id });
    const file = await fileOn(task, 'draft.pdf');
    await db('notifications').del();
    const saved = await edit(task, { removeFileIds: [file.id] });
    expect(saved).toMatchObject({ told: null, toldName: null });
    expect(await db('notifications')).toEqual([]);
  });
});

describe('attach later (POST /api/project-tasks/:id/files)', () => {
  it('tells the person once and answers 201 { files, told, toldName }', async () => {
    const task = await add({ title: 'Fix the login page', assigneeId: vishal.id });
    await db('notifications').del();
    signInAs(pm);
    const keys = [
      await held('brief.pdf', { taskId: task.id }),
      await held('logo.png', { taskId: task.id }),
    ];
    const result = await postFiles(task.id, { uploadKeys: keys });
    expect(result.status).toBe(201);
    expect(result.json.data).toMatchObject({ told: 'person', toldName: 'Vishal Saini' });
    expect(result.json.data.files.map((file) => file.name)).toEqual(['brief.pdf', 'logo.png']);
    const rows = await notes('project_task.files_added');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: vishal.id,
      title: 'Riya Kapoor added 2 files to Fix the login page',
      body: 'acme-store: brief.pdf, logo.png',
    });
  });

  it('tells every active member for an Anyone task, never the actor or a deactivated one', async () => {
    const task = await add({ title: 'Shared files' }, admin);
    await db('notifications').del();
    const done = await attach(task, [await held('a.pdf', { user: admin, taskId: task.id })], admin);
    expect(done).toMatchObject({ told: 'members', toldName: null });
    const rows = await notes('project_task.files_added');
    expect(rows.map((row) => row.userId).sort((a, b) => a - b)).toEqual(
      [vishal.id, simran.id, pmMember.id].sort((a, b) => a - b),
    );
  });

  it('tells nobody for a done task, the actor as the person, or an away person', async () => {
    const done = await add({ title: 'Already done', assigneeId: vishal.id });
    await projectTasks.setStatus({ user: pm, id: done.id, status: 'done' });
    const own = await add({ title: 'For me', assigneeId: pm.id });
    const away = await add({ title: 'For Simran', assigneeId: simran.id });
    await db('projectMembers').where({ projectId: acme.id, userId: simran.id }).del();
    try {
      await db('notifications').del();
      for (const task of [done, own, away]) {
        const result = await attach(task, [await held('x.pdf', { taskId: task.id })]);
        expect(result.files).toHaveLength(1);
        expect(result).toMatchObject({ told: null, toldName: null });
      }
      expect(await db('notifications')).toEqual([]);
    } finally {
      await addMembers(acme, [simran]);
    }
  });

  it('answers 403, 404, 400 and 429 as the contract says', async () => {
    const task = await add({ title: 'Guarded' });
    signInAs(vishal);
    expect((await postFiles(task.id, { uploadKeys: [randomKey()] })).status).toBe(403);
    signInAs(pm2);
    expect((await postFiles(task.id, { uploadKeys: [randomKey()] })).status).toBe(403);
    signInAs(pm);
    expect((await postFiles(999999, { uploadKeys: [randomKey()] })).status).toBe(404);
    expect((await postFiles('abc', { uploadKeys: [randomKey()] })).status).toBe(404);
    const empty = await postFiles(task.id, { uploadKeys: [] });
    expect(empty.status).toBe(400);
    expect(empty.json.error.fields.uploadKeys).toBe('Pick files to add.');
    const unknown = await postFiles(task.id, { uploadKeys: [randomKey()] });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error.fields.uploadKeys).toBe("A file couldn't be added. Add it again.");
    resetRateLimitsForTests();
    let last;
    for (let index = 0; index < 61; index += 1) {
      last = await postFiles(task.id, { uploadKeys: [randomKey()] });
    }
    expect(last.status).toBe(429);
    expect(last.json.error.code).toBe('RATE_LIMITED');
  });
});

describe('at most 20 files on a task', () => {
  it('refuses the 21st file with TOO_MANY_FILES and writes nothing', async () => {
    const task = await add({ title: 'Full task' });
    await fillFiles(task, 20);
    const key = await held('one-more.pdf', { taskId: task.id });
    const error = await expectCode(attach(task, [key]), 'TOO_MANY_FILES');
    expect(error).toMatchObject({
      status: 409,
      message: 'A task can have up to 20 files. Remove one to add more.',
    });
    await expectCode(edit(task, { title: 'Still full', addUploadKeys: [key] }), 'TOO_MANY_FILES');
    expect((await db('projectTasks').where({ id: task.id }).first()).title).toBe('Full task');
    expect(await activeFiles(task.id)).toHaveLength(20);
    // Removing one in the same save makes room.
    const [first] = await activeFiles(task.id);
    const saved = await edit(task, { removeFileIds: [first.id], addUploadKeys: [key] });
    expect(saved.told).toBe('members');
    expect(await activeFiles(task.id)).toHaveLength(20);
  });

  it('lets only one of two saves at once pass the limit (the task row lock)', async () => {
    const task = await add({ title: 'Race' });
    await fillFiles(task, 18);
    const one = [
      await held('a1.pdf', { taskId: task.id }),
      await held('a2.pdf', { taskId: task.id }),
    ];
    const two = [
      await held('b1.pdf', { taskId: task.id }),
      await held('b2.pdf', { taskId: task.id }),
    ];
    const results = await Promise.allSettled([attach(task, one), attach(task, two)]);
    const passed = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');
    expect(passed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toMatchObject({ code: 'TOO_MANY_FILES' });
    expect(await activeFiles(task.id)).toHaveLength(20);
  });
});

describe('delete a task', () => {
  it('marks its files deleted in the same transaction', async () => {
    const task = await add({ title: 'Delete me', assigneeId: vishal.id });
    const files = [await fileOn(task, 'a.pdf'), await fileOn(task, 'b.png')];
    expect(await projectTasks.remove({ user: pm, id: task.id })).toEqual({
      id: task.id,
      deleted: true,
    });
    const rows = await db('projectFiles').whereIn(
      'id',
      files.map((file) => file.id),
    );
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'deleted', deletedBy: pm.id, taskId: null });
    }
  });
});

describe('getForViewer and GET /api/project-tasks/:id', () => {
  let forVishal;
  let forSimran;
  let forAnyone;
  let forPmMember;

  beforeAll(async () => {
    setNowForTests(T0);
    forVishal = await add({
      title: 'Vishal task',
      details: 'Line one\nLine two',
      priority: 'p1',
      phase: 'development',
      dueDate: '2026-11-30',
      assigneeId: vishal.id,
    });
    forSimran = await add({ title: 'Simran task', assigneeId: simran.id });
    forAnyone = await add({ title: 'Anyone task' });
    forPmMember = await add({ title: 'Pia task', assigneeId: pmMember.id });
    await taskFile({
      user: pm,
      projectId: acme.id,
      taskId: forVishal.id,
      name: 'photo.png',
      bytes: pngBytes(),
    });
    await fileOn(forVishal, 'brief.pdf');
    await fileOn(forSimran, 'simran.pdf');
    await fileOn(forAnyone, 'shared.pdf');
    await fileOn(forPmMember, 'pia.pdf');
    // Simran reported on the Anyone task last: Vishal must not see her line.
    const { taskIds } = await createReport(simran, '2026-11-20', {
      entries: [{ projectId: acme.id, minutes: 60, tasks: [{ title: 'Work', status: 'blocked' }] }],
    });
    await db('reportTasks').whereIn('id', taskIds).update({ projectTaskId: forAnyone.id });
  });

  const names = (details) => details.files.map((file) => file.name);

  it('gives the PM and Admin any task, with every file and canManage', async () => {
    for (const viewer of [pm, admin]) {
      const details = await projectTasks.getForViewer({ viewer, id: forVishal.id });
      expect(details).toMatchObject({
        id: forVishal.id,
        projectId: acme.id,
        project: { id: acme.id, name: 'acme-store', status: 'active', isUrgent: false },
        title: 'Vishal task',
        details: 'Line one\nLine two',
        priority: 'p1',
        status: 'open',
        phase: 'development',
        dueDate: '2026-11-30',
        assignee: { id: vishal.id, name: 'Vishal Saini', initials: 'VS', isMember: true },
        createdBy: { id: pm.id, name: 'Riya Kapoor' },
        doneAt: null,
        latestReport: null,
        fileCount: 2,
        canManage: true,
        canSeeFiles: true,
      });
      expect(names(details).sort()).toEqual(['brief.pdf', 'photo.png']);
    }
  });

  it('gives a member their own and Anyone tasks only, without other people’s report lines', async () => {
    const own = await projectTasks.getForViewer({ viewer: vishal, id: forVishal.id });
    expect(own).toMatchObject({ canManage: false, canSeeFiles: true, fileCount: 2 });
    const shared = await projectTasks.getForViewer({ viewer: vishal, id: forAnyone.id });
    expect(names(shared)).toEqual(['shared.pdf']);
    expect(shared.latestReport).toBeNull();
    const simranView = await projectTasks.getForViewer({ viewer: simran, id: forAnyone.id });
    expect(simranView.latestReport).toMatchObject({ userId: simran.id, status: 'blocked' });
    await expectCode(projectTasks.getForViewer({ viewer: vishal, id: forSimran.id }), 'NOT_FOUND');
  });

  it('gives another PM any task without files, and a PM who is a member their own and Anyone files', async () => {
    const other = await projectTasks.getForViewer({ viewer: pm2, id: forVishal.id });
    expect(other).toMatchObject({ files: [], fileCount: 0, canSeeFiles: false, canManage: false });
    const report = await projectTasks.getForViewer({ viewer: pm2, id: forAnyone.id });
    expect(report.latestReport).toMatchObject({ userId: simran.id }); // team.view sees every line
    const ownTask = await projectTasks.getForViewer({ viewer: pmMember, id: forPmMember.id });
    expect(ownTask).toMatchObject({ canSeeFiles: true, canManage: false });
    expect(names(ownTask)).toEqual(['pia.pdf']);
    const anyone = await projectTasks.getForViewer({ viewer: pmMember, id: forAnyone.id });
    expect(names(anyone)).toEqual(['shared.pdf']);
    const someoneElse = await projectTasks.getForViewer({ viewer: pmMember, id: forVishal.id });
    expect(someoneElse).toMatchObject({ canSeeFiles: true, files: [], fileCount: 0 });
  });

  it('answers 404 to HR not on the project, an outsider, a deactivated person and an unknown id', async () => {
    for (const viewer of [hr, outsider, { ...gone, status: 'deactivated' }]) {
      const error = await expectCode(
        projectTasks.getForViewer({ viewer, id: forAnyone.id }),
        'NOT_FOUND',
      );
      expect(error.message).toBe("We couldn't find that task.");
    }
    await expectCode(projectTasks.getForViewer({ viewer: pm, id: 999999 }), 'NOT_FOUND');
    await expectCode(projectTasks.getForViewer({ viewer: pm, id: 'abc' }), 'NOT_FOUND');
  });

  it('serves the same through the route', async () => {
    signInAs(vishal);
    const own = await getTask(forVishal.id);
    expect(own.status).toBe(200);
    expect(own.json.data).toMatchObject({ id: forVishal.id, canSeeFiles: true, fileCount: 2 });
    const hidden = await getTask(forSimran.id);
    expect(hidden.status).toBe(404);
    expect(hidden.json.error.message).toBe("We couldn't find that task.");
    expect((await getTask('007')).status).toBe(404);
    signInAs(outsider);
    expect((await getTask(forAnyone.id)).status).toBe(404);
    signInAs(null);
    sessionUser = null;
    expect((await getTask(forAnyone.id)).status).toBe(401);
  });
});

describe('countsByPhase', () => {
  it('counts all and done tasks per phase, with zeros and none', async () => {
    const project = await createProject(pm, { name: 'counted' });
    const at = (phase, status = 'open') => ({ title: `T ${phase ?? 'none'} ${status}`, phase });
    for (const input of [at('development'), at('development'), at('testing'), at(null)]) {
      await add(input, pm, project);
    }
    const doneTask = await add(at('development'), pm, project);
    await projectTasks.setStatus({ user: pm, id: doneTask.id, status: 'done' });
    const counts = await projectTasks.countsByPhase(project.id);
    expect(counts).toMatchObject({
      development: { total: 3, done: 1 },
      testing: { total: 1, done: 0 },
      design: { total: 0, done: 0 },
      none: { total: 1, done: 0 },
    });
    expect(Object.keys(counts)).toHaveLength(7);
    expect(await projectTasks.countsByPhase('x')).toMatchObject({ none: { total: 0, done: 0 } });
  });
});

describe('before migration 019', () => {
  beforeAll(async () => {
    await db.migrate.down({ name: '019_project_files.js' });
  });

  afterAll(async () => {
    await db.migrate.latest();
  });

  it('creates, edits and deletes a task with no files as in 1.11', async () => {
    const task = await add({ title: 'Old style', assigneeId: vishal.id });
    expect(task).toMatchObject({ told: 'person', toldName: 'Vishal Saini' });
    const edited = await edit(task, { title: 'Old style, renamed', priority: 'p1' });
    expect(edited).toMatchObject({ title: 'Old style, renamed', priority: 'p1' });
    expect(await projectTasks.remove({ user: pm, id: task.id })).toEqual({
      id: task.id,
      deleted: true,
    });
    const details = await projectTasks.getForViewer({ viewer: pm, id: edited.id }).catch((e) => e);
    expect(details).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers UPDATE_NEEDED for a save that names upload keys or file ids', async () => {
    const error = await expectCode(
      add({ title: 'With files', uploadKeys: [randomKey()] }),
      'UPDATE_NEEDED',
    );
    expect(error).toMatchObject({
      status: 503,
      message: 'This needs the latest database update. Ask an Admin.',
    });
    const task = await add({ title: 'No files' });
    await expectCode(edit(task, { addUploadKeys: [randomKey()] }), 'UPDATE_NEEDED');
    await expectCode(edit(task, { removeFileIds: [1] }), 'UPDATE_NEEDED');
    await expectCode(attach(task, [randomKey()]), 'UPDATE_NEEDED');
    expect((await db('projectTasks').where({ title: 'With files' })).length).toBe(0);
  });

  it('reads a task with no files', async () => {
    const task = await add({ title: 'Readable', assigneeId: vishal.id });
    const details = await projectTasks.getForViewer({ viewer: vishal, id: task.id });
    expect(details).toMatchObject({ title: 'Readable', files: [], fileCount: 0 });
  });
});
