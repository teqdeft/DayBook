// The Table's bulk save (CONTRACT 28, Bulk actions in the Table): POST /api/projects/[id]/tasks/bulk
// gives tasks to one person or moves them to a phase in one transaction, all or nothing, with one
// notification per person per kind and one audit row per task; its schema's messages, the 16 KB
// cap, the 404 for a task of another project, a refused person rolling everything back, the share
// confirm, Undo with per-task values (back to No phase yet too), the changed-only answer, 403 for
// members and other PMs, the rate limit, and other task saves at the same moment (no deadlock, no
// wait on another project, a deadlock run again).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { resetRateLimitsForTests } from '@/lib/route';
import { setNowForTests } from '@/lib/time';
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
const bulkRoute = await import('@/app/api/projects/[id]/tasks/bulk/route.js');

const T0 = '2026-11-23T05:00:00Z';
const EXPIRES = new Date('2026-11-30T05:00:00Z');

let ceo;
let riya;
let pia; // another PM, not on acme-store
let vishal;
let simran;
let sneha;
let gone;
let acme;
let other; // pia's project

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function bulk(projectId, body, { raw } = {}) {
  const request = new Request(`${env.appOrigin}/api/projects/${projectId}/tasks/bulk`, {
    method: 'POST',
    headers: { origin: env.appOrigin, 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
  const response = await bulkRoute.POST(request, {
    params: Promise.resolve({ id: String(projectId) }),
  });
  return { status: response.status, json: await response.json() };
}

const add = (input, project = acme, user = riya) =>
  projectTasks.create({ user, projectId: project.id, input, ip: '10.0.0.1' });
const notes = (type) => db('notifications').where({ type }).orderBy('id');
const rowOf = (id) => db('projectTasks').where({ id }).first();
const give = (tasks, assigneeId) => ({
  changes: tasks.map((task) => ({ id: task.id, assigneeId })),
});
const move = (tasks, phase) => ({ changes: tasks.map((task) => ({ id: task.id, phase })) });

beforeAll(async () => {
  await resetDatabase();
  await emptyFilesDir();
  setNowForTests(T0);
  ceo = await createUser({ name: 'Arvind Menon', role: 'admin', tracksAttendance: false });
  riya = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  pia = await createUser({ name: 'Pia Manager', role: 'pm', tracksAttendance: false });
  vishal = await createUser({ name: 'Vishal Saini' });
  simran = await createUser({ name: 'Simran Kaur' });
  sneha = await createUser({ name: 'Sneha Patil' });
  gone = await createUser({ name: 'Gus Gone' });
  acme = await createProject(riya, { name: 'acme-store' });
  other = await createProject(pia, { name: 'other-project' });
  await addMembers(acme, [vishal, simran, sneha, gone]);
  await addMembers(other, [vishal]);
  await db('users').where({ id: gone.id }).update({ status: 'deactivated' });
});

beforeEach(async () => {
  setNowForTests(T0);
  resetRateLimitsForTests();
  jar.clear();
  sessionUser = null;
  await db('notifications').del();
});

describe('Give to…', () => {
  it('gives 3 tasks to Vishal: one grouped changed, one reassigned per earlier person, 3 audit rows', async () => {
    const a = await add({ title: 'Fix the login page', assigneeId: simran.id });
    const b = await add({ title: 'Payment settings page', assigneeId: simran.id });
    const c = await add({ title: 'Order emails', assigneeId: sneha.id });
    await db('notifications').del();
    signInAs(riya);
    const saved = await bulk(acme.id, give([a, b, c], vishal.id));
    expect(saved.status).toBe(200);
    expect(saved.json.data).toEqual({
      tasks: [a, b, c].map((task) => ({ id: task.id, assigneeId: vishal.id, phase: null })),
      changed: 3,
      told: { people: ['Vishal Saini', 'Simran Kaur', 'Sneha Patil'], members: false },
    });
    expect(
      (await notes('project_task.changed')).map((row) => [
        row.userId,
        row.title,
        row.body,
        row.link,
      ]),
    ).toEqual([
      [
        vishal.id,
        '3 tasks on acme-store assigned to you',
        'Riya Kapoor assigned them to you: Fix the login page, Payment settings page and Order emails.',
        `/projects/${acme.id}`,
      ],
    ]);
    expect(
      (await notes('project_task.reassigned')).map((row) => [row.userId, row.title, row.body]),
    ).toEqual([
      [
        simran.id,
        '2 of your tasks on acme-store are now for Vishal Saini',
        'Riya Kapoor gave them to Vishal Saini: Fix the login page and Payment settings page.',
      ],
      [
        sneha.id,
        'Order emails on acme-store is now for Vishal Saini',
        'Riya Kapoor gave it to Vishal Saini.',
      ],
    ]);
    const audits = await db('auditLogs')
      .where({ action: 'project_task.update', entityType: 'project_task' })
      .whereIn('entityId', [a.id, b.id, c.id])
      .orderBy('entityId');
    expect(
      audits.map((row) => [
        row.entityId,
        parseJson(row.before).assigneeId,
        parseJson(row.after).assigneeId,
      ]),
    ).toEqual([
      [a.id, simran.id, vishal.id],
      [b.id, simran.id, vishal.id],
      [c.id, sneha.id, vishal.id],
    ]);
  });

  it('answers only the tasks it changed when one is already the person', async () => {
    const a = await add({ title: 'Mine already', assigneeId: riya.id });
    const b = await add({ title: 'Take me', assigneeId: vishal.id });
    const c = await add({ title: 'Take me too' });
    signInAs(riya);
    const saved = await bulk(acme.id, give([a, b, c], riya.id));
    expect(saved.json.data.changed).toBe(2);
    expect(saved.json.data.tasks.map((task) => task.id)).toEqual([b.id, c.id]);
  });

  it('answers "nothing changed" when every task already has the person', async () => {
    const a = await add({ title: 'Already Simran', assigneeId: simran.id });
    await db('notifications').del();
    signInAs(riya);
    const saved = await bulk(acme.id, give([a], simran.id));
    expect(saved.json.data).toEqual({
      tasks: [],
      changed: 0,
      told: { people: [], members: false },
    });
    expect(await db('notifications')).toEqual([]);
  });

  it('lets an Admin not on the project take tasks, and tells members once for Anyone', async () => {
    const a = await add({ title: 'CEO one', assigneeId: vishal.id });
    const b = await add({ title: 'CEO two', assigneeId: vishal.id });
    signInAs(ceo);
    const taken = await bulk(acme.id, give([a, b], ceo.id));
    expect(taken.json.data.told).toEqual({ people: ['Vishal Saini'], members: false });
    await db('notifications').del();
    signInAs(riya);
    const opened = await bulk(acme.id, give([a, b], ''));
    expect(opened.json.data.told).toEqual({ people: ['Arvind Menon'], members: true });
    const changed = await notes('project_task.changed');
    expect(changed.map((row) => row.title)).toEqual(
      expect.arrayContaining(['2 tasks on acme-store are open to anyone']),
    );
    expect(new Set(changed.map((row) => row.userId))).toEqual(
      new Set([vishal.id, simran.id, sneha.id]),
    );
  });

  it('rolls everything back when one person is refused (an Undo with per-task values)', async () => {
    const a = await add({ title: 'Roll one', assigneeId: vishal.id });
    const b = await add({ title: 'Roll two', assigneeId: vishal.id });
    await db('notifications').del();
    signInAs(riya);
    const refused = await bulk(acme.id, {
      changes: [
        { id: a.id, assigneeId: simran.id },
        { id: b.id, assigneeId: gone.id },
      ],
    });
    expect(refused.status).toBe(400);
    expect(refused.json.error.fields.assigneeId).toBe(
      'Pick someone who is on this project, or anyone on the project.',
    );
    expect((await rowOf(a.id)).assigneeId).toBe(vishal.id);
    expect((await rowOf(b.id)).assigneeId).toBe(vishal.id);
    expect(await db('notifications')).toEqual([]);
  });

  it('undoes with each task going back to its earlier person', async () => {
    const a = await add({ title: 'Undo one', assigneeId: simran.id });
    const b = await add({ title: 'Undo two', assigneeId: sneha.id });
    signInAs(riya);
    await bulk(acme.id, give([a, b], vishal.id));
    await db('notifications').del();
    const undo = await bulk(acme.id, {
      changes: [
        { id: a.id, assigneeId: simran.id },
        { id: b.id, assigneeId: sneha.id },
      ],
      shareConfirmed: true,
    });
    expect(undo.status).toBe(200);
    expect(undo.json.data.changed).toBe(2);
    expect((await rowOf(a.id)).assigneeId).toBe(simran.id);
    expect((await rowOf(b.id)).assigneeId).toBe(sneha.id);
    // Vishal held both: one reassigned per new person (mixed targets in one Undo).
    const reassigned = await notes('project_task.reassigned');
    expect(reassigned.map((row) => [row.userId, row.title])).toEqual([
      [vishal.id, 'Undo one on acme-store is now for Simran Kaur'],
      [vishal.id, 'Undo two on acme-store is now for Sneha Patil'],
    ]);
  });
});

describe('Move to phase…', () => {
  it('moves 3 tasks without a notification', async () => {
    const tasks = [];
    for (const title of ['Move one', 'Move two', 'Move three']) {
      tasks.push(await add({ title, assigneeId: vishal.id, phase: 'development' }));
    }
    await db('notifications').del();
    signInAs(riya);
    const moved = await bulk(acme.id, move(tasks, 'testing'));
    expect(moved.json.data).toEqual({
      tasks: tasks.map((task) => ({ id: task.id, assigneeId: vishal.id, phase: 'testing' })),
      changed: 3,
      told: { people: [], members: false },
    });
    expect(await db('notifications')).toEqual([]);
    for (const task of tasks) expect((await rowOf(task.id)).phase).toBe('testing');
  });

  it('undoes a move out of No phase yet (phase null)', async () => {
    const task = await add({ title: 'No phase task' });
    signInAs(riya);
    await bulk(acme.id, move([task], 'testing'));
    const undo = await bulk(acme.id, {
      changes: [{ id: task.id, phase: null }],
      shareConfirmed: true,
    });
    expect(undo.status).toBe(200);
    expect((await rowOf(task.id)).phase).toBeNull();
  });
});

describe('refusals', () => {
  let a;
  let b;
  beforeAll(async () => {
    a = await add({ title: 'Refusal one' });
    b = await add({ title: 'Refusal two' });
  });

  it.each([
    [
      'mixed kinds',
      () => ({
        changes: [
          { id: a.id, phase: 'testing' },
          { id: b.id, assigneeId: null },
        ],
      }),
      'Change one thing at a time.',
    ],
    [
      'both keys in one item',
      () => ({ changes: [{ id: a.id, phase: 'testing', assigneeId: null }] }),
      'Change one thing at a time.',
    ],
    [
      'an unknown phase',
      () => ({ changes: [{ id: a.id, phase: 'nope' }] }),
      'Pick a phase from the list.',
    ],
    ['no tasks', () => ({ changes: [] }), 'Pick at least one task.'],
    [
      'over 100',
      () => ({ changes: Array.from({ length: 101 }, (_, i) => ({ id: i + 1, phase: 'testing' })) }),
      'Pick up to 100 tasks.',
    ],
    [
      'a duplicate',
      () => ({
        changes: [
          { id: a.id, phase: 'testing' },
          { id: a.id, phase: 'design' },
        ],
      }),
      'A task is in the list twice.',
    ],
  ])('answers 400 for %s', async (_, body, message) => {
    signInAs(riya);
    const refused = await bulk(acme.id, body());
    expect(refused.status).toBe(400);
    expect(refused.json.error.code).toBe('VALIDATION_FAILED');
    expect(refused.json.error.message).toBe(message);
  });

  it('answers 413 over 16 KB, before parsing', async () => {
    signInAs(riya);
    const raw = JSON.stringify({
      changes: [{ id: a.id, phase: 'testing' }],
      pad: 'x'.repeat(17 * 1024),
    });
    const refused = await bulk(acme.id, null, { raw });
    expect(refused.status).toBe(413);
    expect(refused.json.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'That request is too large.',
    });
  });

  it("answers 404 for another project's task and changes nothing", async () => {
    const elsewhere = await add({ title: 'Elsewhere', assigneeId: vishal.id }, other, pia);
    signInAs(riya);
    const refused = await bulk(acme.id, move([a, elsewhere], 'testing'));
    expect(refused.status).toBe(404);
    expect(refused.json.error.message).toBe(
      "A task you picked was deleted or isn't on this project. Nothing was changed.",
    );
    expect((await rowOf(a.id)).phase).toBeNull();
    expect((await rowOf(elsewhere.id)).phase).toBeNull();
    expect((await bulk(acme.id, move([{ id: 999999 }], 'testing'))).status).toBe(404);
  });

  it('answers 403 to a member and to another PM', async () => {
    signInAs(vishal);
    expect((await bulk(acme.id, move([a], 'testing'))).status).toBe(403);
    signInAs(pia);
    expect((await bulk(acme.id, move([a], 'testing'))).status).toBe(403);
    expect((await rowOf(a.id)).phase).toBeNull();
  });

  it('answers 429 past 30 requests a minute for one person', async () => {
    signInAs(riya);
    for (let index = 0; index < 30; index += 1) {
      expect((await bulk(acme.id, move([a], null))).status).toBe(200);
    }
    const limited = await bulk(acme.id, move([a], null));
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe('RATE_LIMITED');
  });
});

describe('the share confirm (with links)', () => {
  let privateFile;
  beforeAll(async () => {
    privateFile = await projectFile({
      user: riya,
      projectId: acme.id,
      visibility: 'managers',
      name: 'acme-store-contract-signed.pdf',
    });
  });

  it('refuses giving a task with a private link to a member without the confirm', async () => {
    const a = await add({ title: 'Plain task', assigneeId: riya.id });
    const b = await add({ title: 'Private task', assigneeId: riya.id });
    await linkFile({ user: riya, project: acme, task: b, fileIds: privateFile.id });
    signInAs(riya);
    const refused = await bulk(acme.id, give([a, b], simran.id));
    expect(refused.status).toBe(400);
    expect(refused.json.error.fields.shareConfirmed).toBe(
      'A task you picked has a file only for PM and Admins. Confirm to share it with the new person.',
    );
    expect((await rowOf(a.id)).assigneeId).toBe(riya.id);
    const saved = await bulk(acme.id, { ...give([a, b], simran.id), shareConfirmed: true });
    expect(saved.status).toBe(200);
    expect(saved.json.data.changed).toBe(2);
  });

  it("refuses it for someone in HR who still holds the project's pm_id", async () => {
    const neha = await createUser({ name: 'Neha Gupta', role: 'hr' });
    const hiring = await createProject(neha, { name: 'hiring' });
    await addMembers(hiring, [neha]);
    const secret = await projectFile({
      user: ceo,
      projectId: hiring.id,
      visibility: 'managers',
      name: 'hiring-notes.pdf',
    });
    const task = await add({ title: 'Private for HR', assigneeId: ceo.id }, hiring, ceo);
    await linkFile({ user: ceo, project: hiring, task, fileIds: secret.id });
    signInAs(ceo);
    const refused = await bulk(hiring.id, give([task], neha.id));
    expect(refused.status).toBe(400);
    expect(Object.keys(refused.json.error.fields)).toEqual(['shareConfirmed']);
    expect((await rowOf(task.id)).assigneeId).toBe(ceo.id);
  });

  it('needs no confirm to take, and an Undo of a take sends it and saves', async () => {
    const task = await add({ title: 'Private for Vishal', assigneeId: vishal.id });
    await linkFile({
      user: riya,
      project: acme,
      task,
      fileIds: privateFile.id,
      shareConfirmed: true,
      shareWith: vishal.id,
    });
    signInAs(ceo);
    expect((await bulk(acme.id, give([task], ceo.id))).status).toBe(200);
    const undo = await bulk(acme.id, { ...give([task], vishal.id), shareConfirmed: true });
    expect(undo.status).toBe(200);
    expect((await rowOf(task.id)).assigneeId).toBe(vishal.id);
  });
});

describe('other saves at the same moment', () => {
  let busy;
  let ids;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const takeAll = (list) =>
    projectTasks.bulkUpdate({
      user: riya,
      projectId: busy.id,
      changes: list.map((id) => ({ id, assigneeId: riya.id })),
    });
  const deadlock = () => Object.assign(new Error('Deadlock found'), { errno: 1213 });

  beforeAll(async () => {
    busy = await createProject(riya, { name: 'busy-project' });
    await db('projectTasks').insert(
      Array.from({ length: 60 }, (_, index) => ({
        projectId: busy.id,
        title: `Busy task ${index}`,
        priority: ['p1', 'p2', 'p3'][index % 3],
        status: 'open',
        createdBy: riya.id,
      })),
    );
    await db.raw('ANALYZE TABLE ??', ['projectTasks']);
    ids = (await db('projectTasks').where({ projectId: busy.id }).orderBy('id')).map((r) => r.id);
  });

  afterEach(() => vi.restoreAllMocks());

  it('waits for a tick of one of its tasks and never deadlocks it', async () => {
    const target = ids[15];
    let saving;
    // A tick's own statements (setStatus): the row by its id, then its status, which moves the
    // row's entry in the (project_id, status, priority) index. The bulk save comes in between.
    await db.transaction(async (trx) => {
      await trx('projectTasks').where({ id: target }).forUpdate().first('id');
      saving = takeAll(ids.slice(0, 30));
      saving.catch(() => {});
      await pause(400);
      await trx('projectTasks').where({ id: target }).update({ status: 'done' });
    });
    expect((await saving).changed).toBe(30);
    expect(await rowOf(target)).toMatchObject({ status: 'done', assigneeId: riya.id });
  });

  it('locks only its own tasks: another project saving meanwhile never holds it up', async () => {
    const elsewhere = await add({ title: 'Elsewhere, busy' }, other, pia);
    await db('projectTasks').where({ projectId: busy.id }).update({ assigneeId: null });
    await db.transaction(async (trx) => {
      await trx('projectTasks').where({ id: elsewhere.id }).forUpdate().first('id');
      const saving = takeAll(ids);
      saving.catch(() => {});
      const done = await Promise.race([saving, pause(5000).then(() => 'held up')]);
      expect(done).toMatchObject({ changed: 60 });
    });
  });

  it('runs a single save again after a deadlock, and answers CONFLICT on the third', async () => {
    const transaction = vi.spyOn(db, 'transaction');
    transaction.mockRejectedValueOnce(deadlock()).mockRejectedValueOnce(deadlock());
    const done = await projectTasks.setStatus({ user: riya, id: ids[0], status: 'done' });
    expect([done.status, transaction.mock.calls.length]).toEqual(['done', 3]);
    const again = [
      () => projectTasks.setStatus({ user: riya, id: ids[0], status: 'open' }),
      () => projectTasks.update({ user: riya, id: ids[0], input: { priority: 'p1' } }),
      () => projectTasks.remove({ user: riya, id: ids[0] }),
    ];
    for (const save of again) {
      for (let tries = 0; tries < 3; tries += 1) transaction.mockRejectedValueOnce(deadlock());
      await expect(save()).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
        message: 'Something else changed at the same moment. Try again.',
      });
    }
    expect((await rowOf(ids[0])).status).toBe('done');
    transaction.mockRejectedValueOnce(Object.assign(new Error('Waited'), { errno: 1205 }));
    const waited = projectTasks.setStatus({ user: riya, id: ids[0], status: 'open' });
    await expect(waited).rejects.toMatchObject({ errno: 1205 });
  });
});
