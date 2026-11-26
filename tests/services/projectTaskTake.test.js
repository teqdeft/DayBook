// Assign to me and the earlier person (CONTRACT 28, The assignee rule, Notifications): an Admin who
// isn't on the project takes a task through PATCH /api/project-tasks/[id] without becoming a member,
// the earlier person gets `project_task.reassigned`, the answer carries `toldEarlierName`; the
// assignee rule's refusals through the route; who is never told; a change to Anyone; the PM's
// later change reaching the Admin who took it; listAssigneeOptions per viewer; and, with builder
// A's links, the reassign share check, a PATCH that changes the person and adds a private link at
// once, and an Undo of a take.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { projectFiles } from '@/modules/projectFiles';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import { emptyFilesDir, linkFile, projectFile } from './projectFilesKit.js';

const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;

vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));
vi.mock('@/modules/reports', () => ({
  reports: {
    hasEntriesForProjectRequest: vi.fn(async () => false),
    moveProjectRequestEntries: vi.fn(async () => 0),
  },
}));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const taskRoute = await import('@/app/api/project-tasks/[id]/route.js');

const T0 = '2026-11-23T05:00:00Z';
const EXPIRES = new Date('2026-11-30T05:00:00Z');

let ceo; // Arvind Menon: an Admin, not on acme-store
let meera; // an Admin who is a member of acme-store
let riya; // acme-store's PM, not a member
let pia; // another PM, not on acme-store
let otherAdmin; // another Admin, not on acme-store
let vishal;
let simran;
let uma; // an untracked member
let gone; // a deactivated member
let leaver; // taken off acme-store
let acme;

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function patch(id, body) {
  const request = new Request(`${env.appOrigin}/api/project-tasks/${id}`, {
    method: 'PATCH',
    headers: { origin: env.appOrigin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await taskRoute.PATCH(request, { params: Promise.resolve({ id: String(id) }) });
  return { status: response.status, json: await response.json() };
}

const add = (input, user = riya) =>
  projectTasks.create({ user, projectId: acme.id, input, ip: '10.0.0.1' });
const notes = (type) => db('notifications').where({ type }).orderBy('id');

beforeAll(async () => {
  await resetDatabase();
  await emptyFilesDir();
  setNowForTests(T0);
  ceo = await createUser({ name: 'Arvind Menon', role: 'admin', tracksAttendance: false });
  meera = await createUser({ name: 'Meera Pillai', role: 'admin' });
  riya = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  pia = await createUser({ name: 'Pia Manager', role: 'pm', tracksAttendance: false });
  otherAdmin = await createUser({ name: 'Omar Admin', role: 'admin', tracksAttendance: false });
  vishal = await createUser({ name: 'Vishal Saini', avatarUrl: 'https://example.com/v.png' });
  simran = await createUser({ name: 'Simran Kaur', designation: 'Full stack developer' });
  uma = await createUser({ name: 'Uma Untracked', tracksAttendance: false });
  gone = await createUser({ name: 'Gus Gone' });
  leaver = await createUser({ name: 'Lena Leaver' });
  acme = await createProject(riya, { name: 'acme-store' });
  await addMembers(acme, [vishal, simran, uma, gone, meera]);
  await db('users').where({ id: gone.id }).update({ status: 'deactivated' });
});

beforeEach(async () => {
  setNowForTests(T0);
  jar.clear();
  sessionUser = null;
  await db('notifications').del();
});

describe('Assign to me', () => {
  it("lets the CEO take a task on a project he isn't on, without becoming a member", async () => {
    const task = await add({ title: 'Checkout fix before client demo', assigneeId: simran.id });
    await db('notifications').del();
    signInAs(ceo);
    const taken = await patch(task.id, { assigneeId: ceo.id });
    expect(taken.status).toBe(200);
    expect(taken.json.data).toMatchObject({
      assigneeId: ceo.id,
      assignee: { id: ceo.id, name: 'Arvind Menon', role: 'admin', isMember: true },
      told: null,
      toldName: null,
      toldEarlierName: 'Simran Kaur',
    });
    expect(await db('projectMembers').where({ projectId: acme.id, userId: ceo.id })).toEqual([]);
    const reassigned = await notes('project_task.reassigned');
    expect(reassigned.map((row) => [row.userId, row.title, row.body, row.link])).toEqual([
      [
        simran.id,
        'Checkout fix before client demo on acme-store is now for Arvind Menon',
        'Arvind Menon took it.',
        `/projects/${acme.id}`,
      ],
    ]);
    expect(await notes('project_task.changed')).toEqual([]);
    // The board reads the Admin as on the project (no "Not on the project").
    const [row] = await projectTasks.listForProject({ viewer: riya, projectId: acme.id });
    expect(row.assignee).toMatchObject({ id: ceo.id, isMember: true });
  });

  it('lets the PM take a task; the earlier person is told', async () => {
    const task = await add({ title: 'Payment settings page', assigneeId: vishal.id });
    await db('notifications').del();
    signInAs(riya);
    const taken = await patch(task.id, { assigneeId: riya.id });
    expect(taken.status).toBe(200);
    expect(taken.json.data).toMatchObject({ assigneeId: riya.id, toldEarlierName: 'Vishal Saini' });
    expect((await notes('project_task.reassigned')).map((row) => [row.userId, row.body])).toEqual([
      [vishal.id, 'Riya Kapoor took it.'],
    ]);
  });

  it('tells the person and the earlier one when the PM gives a task on', async () => {
    const task = await add({ title: 'Order emails', assigneeId: vishal.id });
    await db('notifications').del();
    signInAs(riya);
    const given = await patch(task.id, { assigneeId: simran.id });
    expect(given.json.data).toMatchObject({
      told: 'person',
      toldName: 'Simran Kaur',
      toldEarlierName: 'Vishal Saini',
    });
    expect((await notes('project_task.changed')).map((row) => row.userId)).toEqual([simran.id]);
    expect((await notes('project_task.reassigned')).map((row) => [row.userId, row.body])).toEqual([
      [vishal.id, 'Riya Kapoor gave it to Simran Kaur.'],
    ]);
  });
});

describe('the assignee rule through the route', () => {
  let task;
  beforeAll(async () => {
    task = await add({ title: 'Refund flow', assigneeId: vishal.id });
  });

  it.each([
    ['a PM giving it to an Admin who is not a member', () => riya, () => ceo],
    ['a PM giving it to another PM who is not a member', () => riya, () => pia],
    ['an Admin giving it to another Admin who is not a member', () => ceo, () => otherAdmin],
    ['anyone giving it to a deactivated member', () => riya, () => gone],
    ['anyone giving it to someone taken off', () => meera, () => leaver],
  ])('refuses %s', async (_, actor, person) => {
    signInAs(actor());
    const refused = await patch(task.id, { assigneeId: person().id });
    expect(refused.status).toBe(400);
    expect(refused.json.error.fields.assigneeId).toBe(
      'Pick someone who is on this project, or anyone on the project.',
    );
    expect((await db('projectTasks').where({ id: task.id }).first()).assigneeId).toBe(vishal.id);
  });

  it('lets an Admin who is a member, and an untracked member, be picked', async () => {
    signInAs(riya);
    expect((await patch(task.id, { assigneeId: meera.id })).status).toBe(200);
    expect((await patch(task.id, { assigneeId: uma.id })).status).toBe(200);
  });

  it('refuses another PM and a member as the actor (403)', async () => {
    signInAs(pia);
    expect((await patch(task.id, { assigneeId: pia.id })).status).toBe(403);
    signInAs(vishal);
    expect((await patch(task.id, { assigneeId: vishal.id })).status).toBe(403);
  });
});

describe('who is never told', () => {
  it('nobody when the earlier person makes the change themself', async () => {
    const task = await add({ title: 'PM gives own task', assigneeId: riya.id });
    await db('notifications').del();
    const saved = await projectTasks.update({
      user: riya,
      id: task.id,
      input: { assigneeId: vishal.id },
    });
    expect(saved.toldEarlierName).toBeNull();
    expect(await notes('project_task.reassigned')).toEqual([]);
  });

  it('nobody when the earlier person is deactivated or taken off', async () => {
    const task = await add({ title: 'Away person', assigneeId: leaver.id }, ceo).catch(() => null);
    expect(task).toBeNull(); // leaver isn't on the project: the rule refuses it
    await addMembers(acme, [leaver]);
    const theirs = await add({ title: 'Leaver task', assigneeId: leaver.id });
    const goneTask = await add({ title: 'Gone task', assigneeId: vishal.id });
    await db('projectTasks').where({ id: goneTask.id }).update({ assigneeId: gone.id });
    await db('projectMembers').where({ projectId: acme.id, userId: leaver.id }).del();
    await db('notifications').del();
    for (const id of [theirs.id, goneTask.id]) {
      const saved = await projectTasks.update({ user: riya, id, input: { assigneeId: simran.id } });
      expect(saved.toldEarlierName).toBeNull();
    }
    expect(await notes('project_task.reassigned')).toEqual([]);
    expect((await notes('project_task.changed')).map((row) => row.userId)).toEqual([
      simran.id,
      simran.id,
    ]);
  });

  it('nobody for a done task', async () => {
    const task = await add({ title: 'Already done', assigneeId: vishal.id });
    await projectTasks.setStatus({ user: riya, id: task.id, status: 'done' });
    await db('notifications').del();
    const saved = await projectTasks.update({
      user: ceo,
      id: task.id,
      input: { assigneeId: ceo.id },
    });
    expect(saved).toMatchObject({ assigneeId: ceo.id, told: null, toldEarlierName: null });
    expect(await db('notifications')).toEqual([]);
  });
});

describe('a change to anyone on the project', () => {
  it('tells the members once, an earlier member not twice', async () => {
    const task = await add({ title: 'Open it up', assigneeId: vishal.id });
    await db('notifications').del();
    const saved = await projectTasks.update({
      user: riya,
      id: task.id,
      input: { assigneeId: null },
    });
    expect(saved).toMatchObject({ told: 'members', toldName: null, toldEarlierName: null });
    const changed = (await notes('project_task.changed')).map((row) => row.userId);
    expect(changed.sort((a, b) => a - b)).toEqual(
      [vishal.id, simran.id, uma.id, meera.id].sort((a, b) => a - b),
    );
    expect(await notes('project_task.reassigned')).toEqual([]);
  });

  it('tells an earlier PM with reassigned', async () => {
    const task = await add({ title: 'PM lets go', assigneeId: riya.id });
    await db('notifications').del();
    const saved = await projectTasks.update({ user: ceo, id: task.id, input: { assigneeId: '' } });
    expect(saved).toMatchObject({ told: 'members', toldEarlierName: 'Riya Kapoor' });
    expect(
      (await notes('project_task.reassigned')).map((row) => [row.userId, row.title, row.body]),
    ).toEqual([
      [
        riya.id,
        'PM lets go on acme-store is now open to anyone',
        'Arvind Menon opened it to anyone on the project.',
      ],
    ]);
  });
});

describe("the PM's later change to a task the CEO took", () => {
  it('tells the CEO', async () => {
    const task = await add({ title: 'Approve the hosting invoice' });
    await projectTasks.update({ user: ceo, id: task.id, input: { assigneeId: ceo.id } });
    await db('notifications').del();
    const saved = await projectTasks.update({ user: riya, id: task.id, input: { priority: 'p1' } });
    expect(saved).toMatchObject({ told: 'person', toldName: 'Arvind Menon' });
    expect((await notes('project_task.changed')).map((row) => [row.userId, row.title])).toEqual([
      [ceo.id, 'Approve the hosting invoice on acme-store is now P1'],
    ]);
    // Keeping the CEO on it in a later save is allowed (the current person, unchanged).
    const kept = await projectTasks.update({
      user: riya,
      id: task.id,
      input: { assigneeId: ceo.id, title: 'Approve the hosting invoice today' },
    });
    expect(kept.assigneeId).toBe(ceo.id);
  });
});

describe('listAssigneeOptions per viewer', () => {
  it('the PM: Me first, then the active members A to Z, untracked included', async () => {
    const options = await projectTasks.listAssigneeOptions({ viewer: riya, projectId: acme.id });
    expect(options.map((option) => [option.name, option.kind])).toEqual([
      ['Riya Kapoor', 'me'],
      ['Meera Pillai', 'member'],
      ['Simran Kaur', 'member'],
      ['Uma Untracked', 'member'],
      ['Vishal Saini', 'member'],
    ]);
    expect(options.find((option) => option.id === vishal.id)).toEqual({
      id: vishal.id,
      name: 'Vishal Saini',
      initials: 'VS',
      avatarUrl: 'https://example.com/v.png',
      designation: 'Developer',
      role: 'employee',
      status: 'active',
      kind: 'member',
      openHere: expect.any(Number),
    });
    expect(options.find((option) => option.id === simran.id).designation).toBe(
      'Full stack developer',
    );
  });

  it('an Admin not on the project: Me, then the PM, then the members', async () => {
    const options = await projectTasks.listAssigneeOptions({ viewer: ceo, projectId: acme.id });
    expect(options.slice(0, 3).map((option) => [option.name, option.kind])).toEqual([
      ['Arvind Menon', 'me'],
      ['Riya Kapoor', 'pm'],
      ['Meera Pillai', 'member'],
    ]);
    expect(options.map((option) => option.id)).not.toContain(gone.id);
    expect(options.every((option) => option.status === 'active')).toBe(true);
  });

  it('counts open tasks per person on this project (openHere)', async () => {
    const before = await projectTasks.listAssigneeOptions({ viewer: riya, projectId: acme.id });
    const count = before.find((option) => option.id === simran.id).openHere;
    const task = await add({ title: 'One more for Simran', assigneeId: simran.id });
    const after = await projectTasks.listAssigneeOptions({ viewer: riya, projectId: acme.id });
    expect(after.find((option) => option.id === simran.id).openHere).toBe(count + 1);
    await projectTasks.setStatus({ user: riya, id: task.id, status: 'done' });
    const done = await projectTasks.listAssigneeOptions({ viewer: riya, projectId: acme.id });
    expect(done.find((option) => option.id === simran.id).openHere).toBe(count);
  });

  it("gives a member no 'me' and HR outside the project nothing", async () => {
    const options = await projectTasks.listAssigneeOptions({ viewer: vishal, projectId: acme.id });
    expect(options.map((option) => option.kind)).not.toContain('me');
    const hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
    await expect(
      projectTasks.listAssigneeOptions({ viewer: hr, projectId: acme.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('the reassign share check (with links)', () => {
  let privateFile;
  beforeAll(async () => {
    privateFile = await projectFile({
      user: riya,
      projectId: acme.id,
      visibility: 'managers',
      name: 'acme-store-contract-signed.pdf',
    });
  });

  async function taskWithPrivateLink(title, assigneeId = riya.id) {
    const task = await add({ title, assigneeId });
    await linkFile({ user: riya, project: acme, task, fileIds: privateFile.id });
    return task;
  }

  it('refuses giving it to Simran without the confirm, and saves with it', async () => {
    const task = await taskWithPrivateLink('Contract review');
    signInAs(riya);
    const refused = await patch(task.id, { assigneeId: simran.id });
    expect(refused.status).toBe(400);
    expect(refused.json.error.fields.shareConfirmed).toBe(
      'This task has a file only for PM and Admins. Confirm to share it with the new person.',
    );
    expect((await db('projectTasks').where({ id: task.id }).first()).assigneeId).toBe(riya.id);
    const stale = await patch(task.id, { assigneeId: simran.id, shareConfirmed: true });
    expect(stale.json.error.fields.shareConfirmed).toBe(
      'This task is now for someone else. Check who it is for and confirm again.',
    );
    const wrong = await patch(task.id, {
      assigneeId: simran.id,
      shareConfirmed: true,
      shareWith: vishal.id,
    });
    expect(wrong.status).toBe(400);
    const saved = await patch(task.id, {
      assigneeId: simran.id,
      shareConfirmed: true,
      shareWith: simran.id,
    });
    expect(saved.status).toBe(200);
  });

  it('needs no confirm to give it to an Admin, nor to take it', async () => {
    const task = await taskWithPrivateLink('Contract for Meera');
    signInAs(riya);
    expect((await patch(task.id, { assigneeId: meera.id })).status).toBe(200);
    signInAs(ceo);
    expect((await patch(task.id, { assigneeId: ceo.id })).status).toBe(200);
  });

  it("asks for a PM moved to employee who still holds the project's pm_id", async () => {
    const rohit = await createUser({ name: 'Rohit Moved', role: 'pm', tracksAttendance: false });
    const site = await createProject(rohit, { name: 'alpha-site' });
    await addMembers(site, [rohit]);
    await db('users').where({ id: rohit.id }).update({ role: 'employee' });
    const file = await projectFile({
      user: ceo,
      projectId: site.id,
      visibility: 'managers',
      name: 'alpha-contract.pdf',
    });
    const task = await projectTasks.create({
      user: ceo,
      projectId: site.id,
      input: { title: 'Alpha contract', assigneeId: ceo.id, linkFileIds: [file.id] },
    });
    signInAs(ceo);
    const refused = await patch(task.id, { assigneeId: rohit.id });
    expect(refused.status).toBe(400);
    expect(refused.json.error.fields.shareConfirmed).toBe(
      'This task has a file only for PM and Admins. Confirm to share it with the new person.',
    );
    expect((await db('projectTasks').where({ id: task.id }).first()).assigneeId).toBe(ceo.id);
    const viewer = { ...rohit, role: 'employee' };
    await expect(projectFiles.getForDownload({ viewer, id: file.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const confirm = { shareConfirmed: true, shareWith: rohit.id };
    expect((await patch(task.id, { assigneeId: rohit.id, ...confirm })).status).toBe(200);
    await expect(projectFiles.getForDownload({ viewer, id: file.id })).resolves.toBeTruthy();
  });

  it('asks for Anyone too (shareWith "")', async () => {
    const task = await taskWithPrivateLink('Contract for anyone');
    signInAs(riya);
    expect((await patch(task.id, { assigneeId: null })).status).toBe(400);
    const saved = await patch(task.id, { assigneeId: '', shareConfirmed: true, shareWith: '' });
    expect(saved.status).toBe(200);
  });

  it('judges a PATCH that changes the person and adds a private link against the new person', async () => {
    const task = await add({ title: 'New contract task', assigneeId: riya.id });
    signInAs(riya);
    const refused = await patch(task.id, {
      assigneeId: vishal.id,
      addLinkFileIds: [privateFile.id],
    });
    expect(refused.status).toBe(400);
    expect(Object.keys(refused.json.error.fields)).toContain('shareConfirmed');
    expect(await db('taskFileLinks').where({ taskId: task.id })).toEqual([]);
    const saved = await patch(task.id, {
      assigneeId: vishal.id,
      addLinkFileIds: [privateFile.id],
      shareConfirmed: true,
      shareWith: vishal.id,
    });
    expect(saved.status).toBe(200);
    expect(await db('taskFileLinks').where({ taskId: task.id })).toHaveLength(1);
  });

  it('takes a task with a private link from Vishal, then Undo gives it back and he opens the file', async () => {
    // Its own file: the shared one above is also on another of Vishal's tasks.
    const ownFile = await projectFile({
      user: riya,
      projectId: acme.id,
      visibility: 'managers',
      name: 'vishal-contract.pdf',
    });
    const task = await add({ title: 'Vishal contract', assigneeId: vishal.id });
    await linkFile({
      user: riya,
      project: acme,
      task,
      fileIds: ownFile.id,
      shareConfirmed: true,
      shareWith: vishal.id,
    });
    const download = () => projectFiles.getForDownload({ viewer: vishal, id: ownFile.id });
    await expect(download()).resolves.toBeTruthy();
    signInAs(ceo);
    expect((await patch(task.id, { assigneeId: ceo.id })).status).toBe(200);
    await expect(download()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const undo = await patch(task.id, {
      assigneeId: vishal.id,
      shareConfirmed: true,
      shareWith: vishal.id,
    });
    expect(undo.status).toBe(200);
    await expect(download()).resolves.toBeTruthy();
  });
});
