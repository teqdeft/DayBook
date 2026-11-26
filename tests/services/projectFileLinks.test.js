// Files from the project on tasks (CONTRACT 28, Linking, unlinking, the 20-file limit and the share
// confirm; Every read with links; The original file): the share confirm with `shareConfirmed` and
// `shareWith` (failing closed), what can't be linked, the 20 files with links, the row lock, crossed
// saves without a deadlock, unlinking, every read per viewer before and after an unlink and a new
// person, the original deleted, renamed or moved, a task deleted, and before migration 020. Files
// are made through storeFile (projectFilesKit.js) in the test files folder. Also in the MySQL 8.4
// workflow (ONLY_FULL_GROUP_BY and the locking reads).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { resetDatabase } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import {
  createTask,
  emptyFilesDir,
  expectCode,
  linkFile,
  linkRowsOf,
  projectFile,
  taskFile,
} from './projectFilesKit.js';
import { fileRows, linkAudits, matrixSetup, VIEWERS } from './projectFileLinksKit.js';

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
const fileRoute = await import('@/app/api/project-files/[id]/route.js');
const viewRoute = await import('@/app/api/project-files/[id]/view/route.js');
const thumbRoute = await import('@/app/api/project-files/[id]/thumb/route.js');
const unlinkRoute = await import('@/app/api/project-tasks/[id]/links/[fileId]/route.js');

const T0 = '2026-11-24T06:00:00Z';
const EXPIRES = new Date('2026-12-30T04:00:00Z');
const CONFIRM = 'A file you picked is only for PM and Admins. Confirm to share it with this task.';
const STALE = 'This task is now for someone else. Check who it is for and confirm again.';
const GONE = "That file isn't in this project's files any more.";

let w; // the world of matrixSetup: people, project, other project, tasks, files

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function get(route, id) {
  const request = new Request(`${env.appOrigin}/api/project-files/${id}`);
  const response = await route.GET(request, { params: Promise.resolve({ id: String(id) }) });
  await response.arrayBuffer();
  return response.status;
}

async function unlinkCall(taskId, fileId) {
  const request = new Request(`${env.appOrigin}/api/project-tasks/${taskId}/links/${fileId}`, {
    method: 'DELETE',
    headers: { origin: env.appOrigin },
  });
  const response = await unlinkRoute.DELETE(request, {
    params: Promise.resolve({ id: String(taskId), fileId: String(fileId) }),
  });
  return { status: response.status, json: await response.json() };
}

const asPm = (task, fileIds, options = {}) =>
  linkFile({ user: w.people.pm, project: w.project, task, fileIds, ...options });

beforeAll(async () => {
  setNowForTests(T0);
  await resetDatabase();
  await emptyFilesDir();
  w = await matrixSetup();
});

beforeEach(() => {
  setNowForTests(T0);
  resetRateLimitsForTests();
});

afterEach(() => {
  sessionUser = null;
  jar.clear();
});

describe('every read per viewer', () => {
  /** What one viewer gets from each read, in one plain object. */
  async function readsOf(viewer) {
    const { tasks, files, project } = w;
    const list = [tasks.vishal, tasks.simran, tasks.anyone];
    signInAs(viewer);
    const routes = {};
    for (const [kind, file] of Object.entries(files.matrix))
      routes[kind] = await get(fileRoute, file.id);
    routes.view = await get(viewRoute, files.matrix.picture.id);
    routes.thumb = await get(thumbRoute, files.matrix.picture.id);
    const onTask = {};
    for (const key of ['vishal', 'simran', 'anyone']) {
      const task = tasks[key];
      onTask[key] = (await projectFiles.listForTask({ viewer, task })).map((file) => file.name);
    }
    const tab = await projectFiles.listForProject({ viewer, projectId: project.id });
    const ids = new Set(Object.values(files.matrix).map((file) => file.id));
    const chips = await projectFiles.chipsForTasks({ viewer, tasks: list });
    return {
      routes,
      onTask,
      counts: await projectFiles.countsForTasks({ viewer, tasks: list }),
      chips: Object.fromEntries(Object.entries(chips).map(([id, c]) => [id, c.count])),
      tab: tab.files
        .filter((file) => ids.has(file.id))
        .map((file) => file.name)
        .sort(),
      tabLinks: tab.links.map((link) => `${link.fileId}:${link.taskId}`).sort(),
      member: await projectFiles.countTaskFilesForMember({
        userId: viewer.id,
        projectIds: [project.id],
      }),
    };
  }

  for (const [who, expected] of Object.entries(VIEWERS)) {
    it(`${who} gets only what the table allows, on every read`, async () => {
      const got = await readsOf(w.people[who]);
      expect(got).toEqual(expected(w));
    });
  }

  it("never names another person's task to a member, even under an Everyone file", async () => {
    const tab = await projectFiles.listForProject({
      viewer: w.people.vishal,
      projectId: w.project.id,
    });
    const everyone = tab.files.find((file) => file.id === w.files.matrix.everyone.id);
    expect(everyone).toMatchObject({ linkCount: 0, linkedTasks: [], sharedByLink: false });
    expect(JSON.stringify(tab)).not.toContain(w.tasks.simran.title);
    const contract = tab.files.find((file) => file.id === w.files.matrix.picture.id);
    expect(contract).toMatchObject({ sharedByLink: true, linkCount: 1 });
    expect(contract.linkedTasks).toEqual([{ id: w.tasks.vishal.id, title: w.tasks.vishal.title }]);
    const pm = await projectFiles.listForProject({ viewer: w.people.pm, projectId: w.project.id });
    const seen = pm.files.find((file) => file.id === w.files.matrix.picture.id);
    expect(seen.linkedTasks).toEqual([
      {
        id: w.tasks.vishal.id,
        title: w.tasks.vishal.title,
        assigneeId: w.people.vishal.id,
        assigneeName: w.people.vishal.name,
        assigneeManages: false,
      },
    ]);
  });

  it('privateLinkCounts counts links to files only for PM and Admins, also inside a save', async () => {
    const ids = [w.tasks.vishal.id, w.tasks.simran.id, w.tasks.anyone.id];
    const expected = { [w.tasks.vishal.id]: 1, [w.tasks.anyone.id]: 1 };
    expect(await projectFiles.privateLinkCounts(ids)).toEqual(expected);
    expect(await db.transaction((trx) => projectFiles.privateLinkCounts(ids, trx))).toEqual(
      expected,
    );
  });

  it('follows the task: given to Simran, Vishal loses the file at once and Simran opens it', async () => {
    const picture = w.files.matrix.picture.id;
    await db('projectTasks')
      .where({ id: w.tasks.vishal.id })
      .update({ assigneeId: w.people.simran.id });
    signInAs(w.people.vishal);
    expect(await get(fileRoute, picture)).toBe(404);
    signInAs(w.people.simran);
    expect(await get(fileRoute, picture)).toBe(200);
    const names = (
      await projectFiles.listForTask({ viewer: w.people.simran, task: w.tasks.vishal })
    ).map((f) => f.name);
    expect(names).toContain(w.files.matrix.picture.name);
    await db('projectTasks')
      .where({ id: w.tasks.vishal.id })
      .update({ assigneeId: w.people.vishal.id });
  });
});

describe('linking and the share confirm', () => {
  it('links an Everyone file without a confirm and audits it without the name', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.vishal.id });
    const [linked] = await asPm(task, w.files.everyone.id);
    expect(linked).toMatchObject({ id: w.files.everyone.id, linked: true, scope: 'project' });
    const [audit] = await linkAudits(w.files.everyone.id, task.id);
    expect(JSON.parse(audit.after)).toEqual({
      projectId: w.project.id,
      taskId: task.id,
      shared: false,
    });
    expect(JSON.stringify(audit)).not.toContain(w.files.everyone.name);
  });

  it('asks the confirm for a file only for PM and Admins, and writes nothing without it', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.vishal.id });
    const error = await expectCode(asPm(task, w.files.spare.id), 'VALIDATION_FAILED');
    expect(error.fields).toEqual({ shareConfirmed: CONFIRM });
    expect(await linkRowsOf(task.id)).toEqual([]);
    const shareWith = w.people.vishal.id;
    await asPm(task, w.files.spare.id, { shareConfirmed: true, shareWith });
    expect((await linkRowsOf(task.id)).map((row) => row.fileId)).toEqual([w.files.spare.id]);
    const [audit] = await linkAudits(w.files.spare.id, task.id);
    expect(JSON.parse(audit.after)).toMatchObject({ shared: true });
    expect(JSON.stringify(audit)).not.toContain(w.files.spare.name);
  });

  it("needs no confirm on the PM's or an Admin's task", async () => {
    for (const person of [w.people.pm, w.people.adminOutside]) {
      const task = await createTask(w.project, { assigneeId: person.id });
      expect(await asPm(task, w.files.spare.id)).toHaveLength(1);
      const [audit] = await linkAudits(w.files.spare.id, task.id);
      expect(JSON.parse(audit.after).shared).toBe(false);
    }
  });

  it("asks it for whoever still holds the project's pm_id but can't manage it (HR)", async () => {
    const { adminOutside: admin, hrMember: hr } = w.people;
    const project = await createProject(hr, { name: 'hiring' });
    await addMembers(project, [hr]);
    const secret = await projectFile({
      user: admin,
      projectId: project.id,
      visibility: 'managers',
      name: 'hiring-notes.pdf',
    });
    const task = await createTask(project, { assigneeId: hr.id, createdBy: admin.id });
    const link = (options) =>
      linkFile({ user: admin, project, task, fileIds: secret.id, ...options });
    const error = await expectCode(link(), 'VALIDATION_FAILED');
    expect(error.fields).toEqual({ shareConfirmed: CONFIRM });
    signInAs(hr);
    expect(await get(fileRoute, secret.id)).toBe(404);
    await link({ shareConfirmed: true, shareWith: hr.id });
    expect(await get(fileRoute, secret.id)).toBe(200);
    const [audit] = await linkAudits(secret.id, task.id);
    expect(JSON.parse(audit.after).shared).toBe(true);
    const tab = await projectFiles.listForProject({ viewer: admin, projectId: project.id });
    expect(tab.files[0].linkedTasks).toMatchObject([{ id: task.id, assigneeManages: false }]);
  });

  it('fails closed on a stale confirm: the task went to someone else, or shareWith is missing', async () => {
    const task = await createTask(w.project, { assigneeId: null });
    const stale = { shareConfirmed: true, shareWith: w.people.vishal.id };
    const error = await expectCode(asPm(task, w.files.spare.id, stale), 'VALIDATION_FAILED');
    expect(error.fields).toEqual({ shareConfirmed: STALE });
    const missing = { shareConfirmed: true };
    const again = await expectCode(asPm(task, w.files.spare.id, missing), 'VALIDATION_FAILED');
    expect(again.message).toBe(STALE);
    expect(await linkRowsOf(task.id)).toEqual([]);
    // Anyone on the project is '' (or null after the schema's transform).
    await asPm(task, w.files.spare.id, { shareConfirmed: true, shareWith: '' });
    const other = await createTask(w.project, { assigneeId: null });
    await asPm(other, w.files.spare.id, { shareConfirmed: true, shareWith: null });
    expect(await linkRowsOf(other.id)).toHaveLength(1);
  });

  it('refuses a task file, a file of another project and a deleted file, naming no file', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.pm.id });
    for (const id of [w.files.ownTask.id, w.files.otherProject.id, w.files.deleted.id]) {
      const error = await expectCode(asPm(task, [w.files.everyone.id, id]), 'VALIDATION_FAILED');
      expect(error.fields).toEqual({ linkFileIds: GONE });
    }
    expect(await linkRowsOf(task.id)).toEqual([]);
  });

  it('skips a file already on the task and links [5, 5] once', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.pm.id });
    const id = w.files.everyone.id;
    expect(await asPm(task, [id, id])).toHaveLength(1);
    expect(await asPm(task, [id])).toEqual([]);
    expect(await linkRowsOf(task.id)).toHaveLength(1);
    expect(await linkAudits(id, task.id)).toHaveLength(1);
  });
});

describe('the 20 files of a task, with links', () => {
  it('counts own files and links: 19 own + 2 links is 409, 19 + 1 is fine', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.pm.id });
    await fileRows(w, task, 19);
    const both = [w.files.everyone.id, w.files.spare.id];
    const error = await expectCode(asPm(task, both), 'TOO_MANY_FILES');
    expect(error.status).toBe(409);
    expect(error.message).toBe('A task can have up to 20 files. Remove one to add more.');
    expect(await asPm(task, w.files.everyone.id)).toHaveLength(1);
    const counted = await db.transaction((trx) => projectFiles.countActiveLinks(task.id, trx));
    expect(counted).toBe(1);
  });

  it('keeps two saves at once under the row lock: the second sees the first', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.pm.id });
    await fileRows(w, task, 19);
    const results = await Promise.allSettled([
      asPm(task, w.files.everyone.id),
      asPm(task, w.files.spare.id),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((result) => result.reason)?.reason.code).toBe('TOO_MANY_FILES');
    expect(await linkRowsOf(task.id)).toHaveLength(1);
  });

  it('links crossed files to two tasks at the same moment without a deadlock', async () => {
    const one = await createTask(w.project, { assigneeId: w.people.pm.id });
    const two = await createTask(w.project, { assigneeId: w.people.pm.id });
    const [f, g] = [w.files.everyone.id, w.files.spare.id];
    await asPm(one, g);
    await asPm(two, f);
    const results = await Promise.allSettled([asPm(one, f), asPm(two, g)]);
    expect(results.map((result) => result.reason?.errno ?? result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect((await linkRowsOf(one.id)).map((row) => row.fileId).sort()).toEqual([f, g].sort());
    expect((await linkRowsOf(two.id)).map((row) => row.fileId).sort()).toEqual([f, g].sort());
  });

  it('links to neighbouring new tasks at the same moment without a deadlock (no gap locks)', async () => {
    // Two saves of new tasks next to each other in the link table's key: a locking read of each
    // task's link rows would gap-lock the same gap and deadlock both inserts (errno 1213).
    const failures = [];
    for (let round = 0; round < 10; round += 1) {
      const one = await createTask(w.project, { assigneeId: w.people.pm.id });
      const two = await createTask(w.project, { assigneeId: w.people.pm.id });
      const results = await Promise.allSettled([
        asPm(one, w.files.everyone.id),
        asPm(two, [w.files.everyone.id, w.files.spare.id]),
      ]);
      failures.push(...results.filter((result) => result.reason).map((r) => r.reason.errno));
    }
    expect(failures).toEqual([]);
  });
});

describe('unlinking', () => {
  it('unlinks in a save and one at a time, 200 again when already gone, with audit rows', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.vishal.id });
    const secret = await projectFile({
      user: w.people.pm,
      projectId: w.project.id,
      visibility: 'managers',
      name: 'secret.pdf',
    });
    const shareWith = w.people.vishal.id;
    await asPm(task, [w.files.everyone.id, secret.id], { shareConfirmed: true, shareWith });
    signInAs(w.people.vishal);
    expect(await get(fileRoute, secret.id)).toBe(200);
    const removed = await db.transaction((trx) =>
      projectFiles.unlinkFiles(
        { user: w.people.pm, task, fileIds: [w.files.everyone.id, w.files.deleted.id] },
        trx,
      ),
    );
    expect(removed).toEqual([w.files.everyone.id]);
    signInAs(w.people.pm);
    expect(await unlinkCall(task.id, secret.id)).toEqual({
      status: 200,
      json: { data: { removed: true } },
    });
    expect((await unlinkCall(task.id, secret.id)).status).toBe(200);
    expect(await linkRowsOf(task.id)).toEqual([]);
    const audits = await db('auditLogs').where({ action: 'project_file.unlink' }).orderBy('id');
    expect(audits.map((row) => JSON.parse(row.before))).toEqual([
      { projectId: w.project.id, taskId: task.id },
      { projectId: w.project.id, taskId: task.id },
    ]);
    signInAs(w.people.vishal);
    expect(await get(fileRoute, secret.id)).toBe(404);
    expect(await get(fileRoute, w.files.everyone.id)).toBe(200); // still an Everyone file
  });

  it('answers 403 to another PM and a member, 404 for an unknown task', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.vishal.id });
    await asPm(task, w.files.everyone.id);
    signInAs(w.people.otherPm);
    const other = await unlinkCall(task.id, w.files.everyone.id);
    expect([other.status, other.json.error.message]).toEqual([
      403,
      "You can't change files on this project.",
    ]);
    signInAs(w.people.vishal);
    expect((await unlinkCall(task.id, w.files.everyone.id)).status).toBe(403);
    signInAs(w.people.pm);
    const unknown = await unlinkCall(999_999, w.files.everyone.id);
    expect([unknown.status, unknown.json.error.message]).toEqual([
      404,
      "We couldn't find that task.",
    ]);
    expect(await linkRowsOf(task.id)).toHaveLength(1);
    const member = { user: w.people.vishal, taskId: task.id, fileId: w.files.everyone.id };
    expect((await expectCode(projectFiles.unlinkFile(member), 'FORBIDDEN')).status).toBe(403);
    const outsider = { ...member, user: w.people.hrOutside };
    await expectCode(projectFiles.unlinkFile(outsider), 'NOT_FOUND');
  });
});

describe('the original file and the task', () => {
  it('a rename and a move show at once on the task; the links stay', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.pm.id });
    const file = await projectFile({
      user: w.people.pm,
      projectId: w.project.id,
      name: 'plan.pdf',
    });
    await asPm(task, file.id);
    const input = { name: 'launch plan', phase: 'testing' };
    await projectFiles.updateFile({ user: w.people.pm, id: file.id, input });
    const [shown] = await projectFiles.listForTask({ viewer: w.people.pm, task });
    expect(shown).toMatchObject({ name: 'launch plan.pdf', phase: 'testing', linked: true });
    expect(await linkRowsOf(task.id)).toHaveLength(1);
  });

  it('a deleted original is gone from its tasks; the purge removes the link', async () => {
    const task = await createTask(w.project, { assigneeId: null });
    const file = await projectFile({ user: w.people.pm, projectId: w.project.id, name: 'old.pdf' });
    await asPm(task, file.id);
    await projectFiles.removeFile({ user: w.people.pm, id: file.id });
    expect(await projectFiles.listForTask({ viewer: w.people.pm, task })).toEqual([]);
    expect(await projectFiles.countsForTasks({ viewer: w.people.pm, tasks: [task] })).toEqual({});
    expect(await linkRowsOf(task.id)).toHaveLength(1);
    await db('projectFiles').where({ id: file.id, status: 'deleted' }).delete(); // the purge
    expect(await linkRowsOf(task.id)).toEqual([]);
  });

  it('a deleted task takes its links; the file stays in Files', async () => {
    const task = await createTask(w.project, { assigneeId: null });
    await asPm(task, w.files.everyone.id);
    await db('projectTasks').where({ id: task.id }).delete();
    expect(await linkRowsOf(task.id)).toEqual([]);
    const tab = await projectFiles.listForProject({ viewer: w.people.pm, projectId: w.project.id });
    expect(tab.files.map((file) => file.id)).toContain(w.files.everyone.id);
  });
});

describe('before migration 020', () => {
  beforeAll(async () => {
    await db.migrate.down({ name: '020_task_file_links.js' });
  });

  afterAll(async () => {
    await db.migrate.latest();
  });

  it('reads as 1.12: no links anywhere, nothing private for a member', async () => {
    const { vishal } = w.people;
    expect(await projectFiles.listForTask({ viewer: vishal, task: w.tasks.vishal })).toEqual([]);
    const list = [w.tasks.vishal, w.tasks.anyone];
    expect(await projectFiles.countsForTasks({ viewer: vishal, tasks: list })).toEqual({});
    expect(await projectFiles.chipsForTasks({ viewer: vishal, tasks: list })).toEqual({});
    const tab = await projectFiles.listForProject({ viewer: vishal, projectId: w.project.id });
    expect(tab.links).toEqual([]);
    expect(tab.files.map((file) => file.visibility)).not.toContain('managers');
    expect(await projectFiles.privateLinkCounts([w.tasks.vishal.id])).toEqual({});
    expect(
      await db.transaction((trx) => projectFiles.countActiveLinks(w.tasks.vishal.id, trx)),
    ).toBe(0);
    signInAs(vishal);
    expect(await get(fileRoute, w.files.matrix.picture.id)).toBe(404);
  });

  it('a save naming a private or a deleted file answers UPDATE_NEEDED, never a 400 first', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.vishal.id });
    for (const id of [w.files.spare.id, w.files.deleted.id, w.files.otherProject.id]) {
      expect((await expectCode(asPm(task, id), 'UPDATE_NEEDED')).status).toBe(503);
    }
  });

  it('link writes answer UPDATE_NEEDED and the unlink route 503; a save without links works', async () => {
    const task = await createTask(w.project, { assigneeId: w.people.pm.id });
    const error = await expectCode(asPm(task, w.files.everyone.id), 'UPDATE_NEEDED');
    expect([error.status, error.message]).toEqual([
      503,
      'This needs the latest database update. Ask an Admin.',
    ]);
    expect(await asPm(task, [])).toEqual([]);
    signInAs(w.people.pm);
    const route = await unlinkCall(task.id, w.files.everyone.id);
    expect([route.status, route.json.error.code]).toEqual([503, 'UPDATE_NEEDED']);
    await taskFile({ user: w.people.pm, projectId: w.project.id, taskId: task.id, name: 'a.pdf' });
    const [own] = await projectFiles.listForTask({ viewer: w.people.pm, task });
    expect(own).toMatchObject({ name: 'a.pdf', linked: false });
  });
});
