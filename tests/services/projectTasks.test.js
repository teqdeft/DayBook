// Priority tasks (CONTRACT 13): who may manage them, validation, notifications, audit, ordering,
// the reads for Today, My projects and the report picker, and the latest linked report line.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject, createReport } from './dashboardKit.js';

// The reports module belongs to another owner; the projects module imports it for requests.
vi.mock('@/modules/reports', () => ({
  reports: {
    hasEntriesForProjectRequest: vi.fn(async () => false),
    moveProjectRequestEntries: vi.fn(async () => 0),
  },
}));

let admin;
let pm;
let pm2;
let hr;
let alice;
let bob;
let carol;
let gone;
let untracked;
let lyra; // pm's project: alice, bob, pm2 (a PM on the team), gone (deactivated)
let vega; // pm2's project: carol
let orion; // pm's completed project: alice
let paused; // pm's on-hold project: alice

const T0 = '2026-09-30T05:00:00Z';

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

async function expectField(promise, field) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(Object.keys(error.fields ?? {})).toContain(field);
}

function notes(type, where = {}) {
  return db('notifications')
    .where({ type, ...where })
    .orderBy('id');
}

async function auditRows(action, entityId) {
  const rows = await db('auditLogs').where({ action, entityId }).orderBy('id');
  return rows.map((row) => ({
    ...row,
    before: parseJson(row.before),
    after: parseJson(row.after),
  }));
}

function add(user, project, input) {
  return projectTasks.create({ user, projectId: project.id, input, ip: '10.0.0.1' });
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(T0);
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Paul Manager', role: 'pm', tracksAttendance: false });
  pm2 = await createUser({ name: 'Pia Manager', role: 'pm', tracksAttendance: false });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  alice = await createUser({ name: 'Alice Dev' });
  bob = await createUser({ name: 'Bob Dev' });
  carol = await createUser({ name: 'Carol Dev' });
  gone = await createUser({ name: 'Gus Gone' });
  untracked = await createUser({ name: 'Uma Untracked', tracksAttendance: false });
  lyra = await createProject(pm, { name: 'lyra' });
  vega = await createProject(pm2, { name: 'vega' });
  orion = await createProject(pm, { name: 'orion', status: 'completed' });
  paused = await createProject(pm, { name: 'paused', status: 'on_hold' });
  await addMembers(lyra, [alice, bob, pm2, gone, untracked]);
  await addMembers(vega, [carol]);
  await addMembers(orion, [alice]);
  await addMembers(paused, [alice]);
  await db('users').where({ id: gone.id }).update({ status: 'deactivated' });
});

beforeEach(async () => {
  setNowForTests(T0);
  await db('notifications').del();
});

describe('who may manage priority tasks', () => {
  it('lets the project PM and Admin add tasks', async () => {
    const task = await add(pm, lyra, { title: 'Fix login timeout', priority: 'p1' });
    expect(task).toMatchObject({
      projectId: lyra.id,
      title: 'Fix login timeout',
      priority: 'p1',
      status: 'open',
      assignee: null,
      createdBy: pm.id,
    });
    const byAdmin = await add(admin, lyra, { title: 'Admin task' });
    expect(byAdmin.priority).toBe('p2'); // the default
  });

  it('refuses other PMs, HR and employees', async () => {
    await expectCode(add(pm2, lyra, { title: 'Not mine' }), 'FORBIDDEN');
    await expectCode(add(hr, lyra, { title: 'HR task' }), 'FORBIDDEN');
    await expectCode(add(alice, lyra, { title: 'Member task' }), 'FORBIDDEN');
    const task = await add(pm, lyra, { title: 'Guarded task' });
    for (const user of [pm2, hr, alice]) {
      await expectCode(
        projectTasks.update({ user, id: task.id, input: { title: 'Changed' } }),
        'FORBIDDEN',
      );
      await expectCode(projectTasks.setStatus({ user, id: task.id, status: 'done' }), 'FORBIDDEN');
      await expectCode(projectTasks.remove({ user, id: task.id }), 'FORBIDDEN');
    }
    expect(await projectTasks.findById(task.id)).toMatchObject({ title: 'Guarded task' });
  });

  it('answers NOT_FOUND for unknown projects and tasks', async () => {
    await expectCode(add(pm, { id: 999999 }, { title: 'Nowhere' }), 'NOT_FOUND');
    await expectCode(
      projectTasks.update({ user: pm, id: 999999, input: { title: 'Nope' } }),
      'NOT_FOUND',
    );
    await expectCode(projectTasks.remove({ user: pm, id: 'abc' }), 'NOT_FOUND');
  });

  it('does not add tasks to a completed project', async () => {
    await expectCode(add(pm, orion, { title: 'Too late' }), 'PROJECT_NOT_ACTIVE');
  });
});

describe('validation', () => {
  it('needs a title of 2-200 characters and details up to 1000', async () => {
    await expectField(add(pm, lyra, { title: ' ' }), 'title');
    await expectField(add(pm, lyra, { title: 'x' }), 'title');
    await expectField(add(pm, lyra, { title: 'x'.repeat(201) }), 'title');
    await expectField(add(pm, lyra, { title: 'Fine', details: 'd'.repeat(1001) }), 'details');
    await expectField(add(pm, lyra, { title: 'Fine', priority: 'p4' }), 'priority');
    const task = await add(pm, lyra, { title: '  Spaced   out  ', details: '   ' });
    expect(task).toMatchObject({ title: 'Spaced out', details: null });
    const long = await add(pm, lyra, { title: 'x'.repeat(200), details: 'd'.repeat(1000) });
    expect(long.title).toHaveLength(200);
    expect(long.details).toHaveLength(1000);
  });

  it('only assigns active members of the project', async () => {
    await expectField(add(pm, lyra, { title: 'For Carol', assigneeId: carol.id }), 'assigneeId');
    await expectField(add(pm, lyra, { title: 'For Gus', assigneeId: gone.id }), 'assigneeId');
    await expectField(add(pm, lyra, { title: 'For nobody', assigneeId: 999999 }), 'assigneeId');
    const task = await add(pm, lyra, { title: 'For Alice', assigneeId: alice.id });
    expect(task.assignee).toMatchObject({ id: alice.id, name: 'Alice Dev', initials: 'AD' });
    await expectField(
      projectTasks.update({ user: pm, id: task.id, input: { assigneeId: carol.id } }),
      'assigneeId',
    );
  });

  it('keeps a removed member as the assignee until someone else is picked', async () => {
    const task = await add(pm, lyra, { title: 'Bob keeps this', assigneeId: bob.id });
    await db('projectMembers').where({ projectId: lyra.id, userId: bob.id }).del();
    try {
      const [row] = await projectTasks
        .listForProject({ viewer: pm, projectId: lyra.id })
        .then((rows) => rows.filter((item) => item.id === task.id));
      expect(row.assignee).toMatchObject({ id: bob.id, isMember: false });
      // Editing other fields works; picking Bob again does not.
      const renamed = await projectTasks.update({
        user: pm,
        id: task.id,
        input: { title: 'Bob still has this', assigneeId: bob.id },
      });
      expect(renamed.title).toBe('Bob still has this');
    } finally {
      await addMembers(lyra, [bob]);
    }
  });
});

describe('notifications and audit', () => {
  it('tells the assignee about a new task, not the person adding it', async () => {
    const task = await add(pm, lyra, {
      title: 'API for leave form',
      details: 'Before Friday',
      priority: 'p1',
      assigneeId: alice.id,
    });
    const rows = await notes('project_task.added');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: alice.id,
      title: 'New P1 task on lyra: API for leave form',
      body: 'Paul Manager assigned it to you. Before Friday',
      link: '/today',
    });
    const [line] = await auditRows('project_task.create', task.id);
    expect(line).toMatchObject({ actorId: pm.id, entityType: 'project_task', ip: '10.0.0.1' });
    expect(line.after).toMatchObject({ projectId: lyra.id, priority: 'p1', assigneeId: alice.id });
  });

  it('cuts a long title or details at a word with an ellipsis, within the bell sizes', async () => {
    const title = `Rework ${'the checkout '.repeat(15)}flow`.slice(0, 200).trim();
    const details = 'Make every step faster. '.repeat(40).trim();
    await add(pm, lyra, { title, details, priority: 'p1', assigneeId: alice.id });
    const [row] = await notes('project_task.added');
    expect(row.title.length).toBeLessThanOrEqual(200);
    expect(row.title).toMatch(/^New P1 task on lyra: Rework the checkout .*checkout…$/);
    expect(row.body.length).toBeLessThanOrEqual(500);
    // A whole-word start of the full body, then the ellipsis.
    const full = `Paul Manager assigned it to you. ${details}`;
    expect(row.body.endsWith('…')).toBe(true);
    expect(full.startsWith(row.body.slice(0, -1))).toBe(true);
    expect(full[row.body.length - 1]).toBe(' ');
  });

  it('tells every active member about a task for anyone, PMs on the team get the project link', async () => {
    await add(admin, lyra, { title: 'Permissions check', priority: 'p2' });
    const rows = await notes('project_task.added');
    const byUser = Object.fromEntries(rows.map((row) => [row.userId, row]));
    expect(Object.keys(byUser).map(Number).sort()).toEqual(
      [alice.id, bob.id, pm2.id, untracked.id].sort(),
    );
    expect(byUser[alice.id]).toMatchObject({
      title: 'New P2 task on lyra: Permissions check',
      body: 'Ada Admin added it for anyone on the project.',
      link: '/today',
    });
    expect(byUser[pm2.id].link).toBe(`/projects/${lyra.id}#priority`);
  });

  it('notifies on a new priority or assignee, not on a new title', async () => {
    const task = await add(pm, lyra, { title: 'Checkout fix', priority: 'p2', assigneeId: bob.id });
    await db('notifications').del();

    await projectTasks.update({ user: pm, id: task.id, input: { title: 'Checkout fix v2' } });
    expect(await notes('project_task.changed')).toHaveLength(0);

    await projectTasks.update({ user: pm, id: task.id, input: { priority: 'p1' } });
    let rows = await notes('project_task.changed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: bob.id,
      title: 'Checkout fix v2 on lyra is now P1',
      body: 'Paul Manager changed it from P2 to P1.',
    });

    await db('notifications').del();
    await projectTasks.update({ user: pm, id: task.id, input: { assigneeId: alice.id } });
    rows = await notes('project_task.changed');
    expect(rows.map((row) => row.userId)).toEqual([alice.id]);
    expect(rows[0].title).toBe('P1 task on lyra assigned to you: Checkout fix v2');

    await db('notifications').del();
    await projectTasks.update({
      user: pm,
      id: task.id,
      input: { assigneeId: null, priority: 'p3' },
    });
    rows = await notes('project_task.changed');
    expect(rows.map((row) => row.userId).sort()).toEqual(
      [alice.id, bob.id, pm2.id, untracked.id].sort(),
    );
    expect(rows[0]).toMatchObject({
      title: 'P3 task on lyra is open to anyone: Checkout fix v2',
      body: 'Paul Manager opened it to anyone on the project and made it P3.',
    });

    const lines = await auditRows('project_task.update', task.id);
    expect(lines).toHaveLength(4);
    expect(lines[0].before).toMatchObject({ title: 'Checkout fix' });
    expect(lines[0].after).toMatchObject({ title: 'Checkout fix v2' });
    expect(lines[3].after).toMatchObject({ assigneeId: null, priority: 'p3' });
  });

  it('does nothing when nothing changes, and stays quiet for done tasks', async () => {
    const task = await add(pm, lyra, { title: 'Quiet one', assigneeId: alice.id });
    await projectTasks.update({ user: pm, id: task.id, input: { title: 'Quiet one' } });
    expect(await auditRows('project_task.update', task.id)).toHaveLength(0);
    await projectTasks.setStatus({ user: pm, id: task.id, status: 'done' });
    await db('notifications').del();
    await projectTasks.update({ user: pm, id: task.id, input: { priority: 'p1' } });
    expect(await notes('project_task.changed')).toHaveLength(0);
  });

  it('marks done and reopens, with audit lines', async () => {
    setNowForTests('2026-09-30T09:00:00Z');
    const task = await add(pm, lyra, { title: 'Ship it' });
    const done = await projectTasks.setStatus({ user: admin, id: task.id, status: 'done' });
    expect(done).toMatchObject({ status: 'done', doneBy: admin.id, doneByName: 'Ada Admin' });
    expect(done.doneAt.toISOString()).toBe('2026-09-30T09:00:00.000Z');
    const again = await projectTasks.setStatus({ user: pm, id: task.id, status: 'done' });
    expect(again.doneBy).toBe(admin.id); // unchanged
    const reopened = await projectTasks.setStatus({ user: pm, id: task.id, status: 'open' });
    expect(reopened).toMatchObject({ status: 'open', doneAt: null, doneBy: null });
    expect(await auditRows('project_task.done', task.id)).toHaveLength(1);
    expect(await auditRows('project_task.reopen', task.id)).toHaveLength(1);
    await expectField(projectTasks.setStatus({ user: pm, id: task.id, status: 'gone' }), 'status');
  });

  it('deletes a task; linked report lines keep their text and lose the link', async () => {
    const task = await add(pm, lyra, { title: 'Delete me', assigneeId: alice.id });
    const { taskIds } = await createReport(alice, '2026-09-29', {
      entries: [{ projectId: lyra.id, minutes: 60, tasks: [{ title: 'Worked on it' }] }],
    });
    await db('reportTasks').whereIn('id', taskIds).update({ projectTaskId: task.id });
    expect(await projectTasks.remove({ user: pm, id: task.id })).toEqual({
      id: task.id,
      deleted: true,
    });
    expect(await projectTasks.findById(task.id)).toBeNull();
    const line = await db('reportTasks').where({ id: taskIds[0] }).first();
    expect(line).toMatchObject({ title: 'Worked on it', projectTaskId: null });
    const [log] = await auditRows('project_task.delete', task.id);
    expect(log.before).toMatchObject({ title: 'Delete me', assigneeId: alice.id });
  });
});

describe('member added', () => {
  it('notifies people newly added to a project, not the person adding them', async () => {
    const { projects } = await import('@/modules/projects');
    const project = await projects.create({
      user: pm,
      input: { name: 'nova', clientName: 'Nova Labs', pmId: pm.id, memberIds: [alice.id, pm.id] },
    });
    let rows = await notes('project.member_added');
    expect(rows.map((row) => row.userId)).toEqual([alice.id]);
    expect(rows[0]).toMatchObject({
      title: 'You were added to nova',
      body: 'Paul Manager added you to the project team.',
      link: '/projects',
    });

    await db('notifications').del();
    await projects.setMembers({ user: pm, id: project.id, userIds: [alice.id, pm.id, bob.id] });
    rows = await notes('project.member_added');
    expect(rows.map((row) => row.userId)).toEqual([bob.id]);

    await db('notifications').del();
    await projects.update({
      user: admin,
      id: project.id,
      input: { name: 'nova-two', memberIds: [bob.id, carol.id] },
    });
    rows = await notes('project.member_added');
    expect(rows.map((row) => row.userId)).toEqual([carol.id]);
    expect(rows[0].title).toBe('You were added to nova-two');
  });

  it('does not tell the requester twice when their project request is approved', async () => {
    const { projects } = await import('@/modules/projects');
    const { request } = await projects.createRequest({
      user: carol,
      input: { name: 'polaris', note: 'New client' },
    });
    await db('notifications').del();
    await projects.approveRequest({
      user: pm,
      id: request.id,
      input: { name: 'polaris', clientName: 'Polaris', pmId: pm.id, memberIds: [bob.id] },
    });
    const added = await notes('project.member_added');
    expect(added.map((row) => row.userId)).toEqual([bob.id]);
    expect(await notes('project_request.approved', { userId: carol.id })).toHaveLength(1);
  });
});
