// Priority tasks with a phase and due date (CONTRACT 22): create, update, the list, the project's PM
// as an assignee, and progressByProject's counts and week windows.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { lastFullWeeks } from '@/modules/projectPlan/weeks';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';

vi.mock('@/modules/reports', () => ({
  reports: {
    hasEntriesForProjectRequest: vi.fn(async () => false),
    moveProjectRequestEntries: vi.fn(async () => 0),
  },
}));

const T0 = '2026-10-30T06:00:00Z'; // Friday 30 October 2026, 11:30 AM in Kolkata
const TODAY = '2026-10-30';
const TZ = 'Asia/Kolkata';

let admin;
let pm;
let pmOnTeam;
let formerPm;
let alice;
let bob;
let lyra; // pm, not a member: alice, bob
let vega; // pmOnTeam, also a member: alice
let projectCount = 0;

const add = (project, input, user = pm) =>
  projectTasks.create({ user, projectId: project.id, input, ip: '10.0.0.1' });

async function expectField(promise, field) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(Object.keys(error.fields ?? {})).toContain(field);
}

const newProject = () => {
  projectCount += 1;
  return createProject(pm, { name: `tasks-plan-${projectCount}` });
};

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(T0);
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Paul Manager', role: 'pm', tracksAttendance: false });
  pmOnTeam = await createUser({ name: 'Pia Manager', role: 'pm', tracksAttendance: false });
  formerPm = await createUser({ name: 'Fay Former', role: 'pm', tracksAttendance: false });
  alice = await createUser({ name: 'Alice Dev' });
  bob = await createUser({ name: 'Bob Dev' });
  lyra = await createProject(pm, { name: 'lyra' });
  vega = await createProject(pmOnTeam, { name: 'vega' });
  await addMembers(lyra, [alice, bob]);
  await addMembers(vega, [alice, pmOnTeam]);
});

beforeEach(async () => {
  setNowForTests(T0);
  await db('notifications').del();
});

describe('phase and due date on create', () => {
  it('stores and returns them', async () => {
    const task = await add(lyra, {
      title: 'Write the test plan',
      phase: 'testing',
      dueDate: '2026-11-20',
    });
    expect(task).toMatchObject({ phase: 'testing', dueDate: '2026-11-20' });
    const row = await db('projectTasks').where({ id: task.id }).first();
    expect(row).toMatchObject({ phase: 'testing', dueDate: '2026-11-20' });
  });

  it('defaults both to null', async () => {
    const task = await add(lyra, { title: 'No plan on this one' });
    expect(task).toMatchObject({ phase: null, dueDate: null });
  });

  it('takes null and an empty value for both', async () => {
    const nulls = await add(lyra, { title: 'Nulls', phase: null, dueDate: null });
    expect(nulls).toMatchObject({ phase: null, dueDate: null });
    const empty = await add(lyra, { title: 'Empty', phase: '', dueDate: '' });
    expect(empty).toMatchObject({ phase: null, dueDate: null });
  });

  it('refuses a bad phase or due date', async () => {
    await expectField(add(lyra, { title: 'Bad', phase: 'nonsense' }), 'phase');
    await expectField(add(lyra, { title: 'Bad', phase: 3 }), 'phase');
    await expectField(add(lyra, { title: 'Bad', dueDate: '2026-02-30' }), 'dueDate');
    await expectField(add(lyra, { title: 'Bad', dueDate: '20-11-2026' }), 'dueDate');
    await expectField(add(lyra, { title: 'Bad', dueDate: 20261120 }), 'dueDate');
    await expectField(add(lyra, { title: 'Bad', dueDate: '0202-11-20' }), 'dueDate');
  });

  it('keeps them in the audit row', async () => {
    const task = await add(lyra, { title: 'Audited', phase: 'design', dueDate: '2026-11-20' });
    const row = await db('auditLogs')
      .where({ action: 'project_task.create', entityId: task.id })
      .first();
    expect(parseJson(row.after)).toMatchObject({ phase: 'design', dueDate: '2026-11-20' });
  });
});

describe('phase and due date on update', () => {
  it('changes only what is sent', async () => {
    const task = await add(lyra, { title: 'Editable', phase: 'design', dueDate: '2026-11-20' });
    const moved = await projectTasks.update({
      user: pm,
      id: task.id,
      input: { phase: 'development' },
    });
    expect(moved).toMatchObject({ phase: 'development', dueDate: '2026-11-20', title: 'Editable' });
    const dated = await projectTasks.update({
      user: pm,
      id: task.id,
      input: { dueDate: '2026-12-01' },
    });
    expect(dated).toMatchObject({ phase: 'development', dueDate: '2026-12-01' });
    const titled = await projectTasks.update({
      user: pm,
      id: task.id,
      input: { title: 'Renamed' },
    });
    expect(titled).toMatchObject({ phase: 'development', dueDate: '2026-12-01' });
  });

  it('clears them with null', async () => {
    const task = await add(lyra, { title: 'Clearable', phase: 'design', dueDate: '2026-11-20' });
    const cleared = await projectTasks.update({
      user: pm,
      id: task.id,
      input: { phase: null, dueDate: null },
    });
    expect(cleared).toMatchObject({ phase: null, dueDate: null });
  });

  it('leaves details alone', async () => {
    const task = await add(lyra, { title: 'With details', details: 'Keep me' });
    const moved = await projectTasks.update({ user: pm, id: task.id, input: { phase: 'design' } });
    expect(moved.details).toBe('Keep me');
  });

  it('refuses a bad phase or due date', async () => {
    const task = await add(lyra, { title: 'Guarded' });
    await expectField(
      projectTasks.update({ user: pm, id: task.id, input: { phase: 'nonsense' } }),
      'phase',
    );
    await expectField(
      projectTasks.update({ user: pm, id: task.id, input: { dueDate: 'soon' } }),
      'dueDate',
    );
  });

  it('writes one audit row with both sides, and none when nothing changes', async () => {
    const task = await add(lyra, { title: 'Watched', phase: 'design', dueDate: '2026-11-20' });
    const update = (input) => projectTasks.update({ user: pm, id: task.id, input });
    await update({ phase: 'design', dueDate: '2026-11-20' });
    await update({ phase: 'testing' });
    const rows = await db('auditLogs')
      .where({ action: 'project_task.update', entityId: task.id })
      .orderBy('id');
    expect(rows).toHaveLength(1);
    expect(parseJson(rows[0].before)).toMatchObject({ phase: 'design' });
    expect(parseJson(rows[0].after)).toMatchObject({ phase: 'testing', dueDate: '2026-11-20' });
  });

  it("doesn't notify anyone about a new phase or due date", async () => {
    const task = await add(lyra, { title: 'Quiet', assigneeId: alice.id });
    await db('notifications').del();
    await projectTasks.update({
      user: pm,
      id: task.id,
      input: { phase: 'design', dueDate: '2026-11-20' },
    });
    expect(await db('notifications')).toEqual([]);
  });

  it('keeps them when marking done and reopening', async () => {
    const task = await add(lyra, { title: 'Ticked', phase: 'design', dueDate: '2026-11-20' });
    const done = await projectTasks.setStatus({ user: pm, id: task.id, status: 'done' });
    expect(done).toMatchObject({ status: 'done', phase: 'design', dueDate: '2026-11-20' });
    const open = await projectTasks.setStatus({ user: pm, id: task.id, status: 'open' });
    expect(open).toMatchObject({ status: 'open', phase: 'design', dueDate: '2026-11-20' });
  });
});

describe('listForProject', () => {
  it('returns the phase and due date', async () => {
    const project = await newProject();
    await add(project, { title: 'Planned', phase: 'launch', dueDate: '2027-01-15' });
    await add(project, { title: 'Bare' });
    const rows = await projectTasks.listForProject({ viewer: pm, projectId: project.id });
    expect(rows.map((row) => [row.title, row.phase, row.dueDate])).toEqual([
      ['Planned', 'launch', '2027-01-15'],
      ['Bare', null, null],
    ]);
  });

  it('keeps status, limit and the total working', async () => {
    const project = await newProject();
    const first = await add(project, { title: 'First', phase: 'design' });
    await add(project, { title: 'Second', phase: 'design' });
    await projectTasks.setStatus({ user: pm, id: first.id, status: 'done' });
    const open = await projectTasks.listForProject({
      viewer: pm,
      projectId: project.id,
      status: 'open',
    });
    expect(open.map((row) => row.title)).toEqual(['Second']);
    const page = await projectTasks.pageForProject({
      viewer: pm,
      projectId: project.id,
      limit: 1,
    });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].phase).toBe('design');
  });
});

describe('the readers that run before the migration', () => {
  it("don't select the new columns", async () => {
    const project = await newProject();
    await addMembers(project, [alice]);
    const task = await add(project, { title: 'Hidden', phase: 'design', dueDate: '2026-11-20' });

    const sql = [];
    const record = (query) => sql.push(query.sql);
    db.on('query', record);
    const reads = [
      projectTasks.listOpenForUser(alice.id),
      projectTasks.countOpenByProjectForUser(alice.id),
      projectTasks.findOpenForPicker({ userId: alice.id, projectId: project.id }),
      projectTasks.findOpenForPickerByProject({ userId: alice.id, projectIds: [project.id] }),
      projectTasks.findByIds([task.id]),
      projectTasks.findById(task.id),
    ];
    const [today] = await Promise.all(reads);
    db.removeListener('query', record);

    expect(sql.length).toBeGreaterThan(0);
    for (const text of sql) expect(text).not.toMatch(/`phase`|`due_date`/);
    expect(today.find((row) => row.id === task.id)).not.toHaveProperty('phase');
  });
});

describe("the project's PM as an assignee", () => {
  it('can be picked on create without being a member', async () => {
    const task = await add(lyra, { title: 'For the PM', assigneeId: pm.id }, admin);
    expect(task.assigneeId).toBe(pm.id);
    expect(task.assignee).toMatchObject({ id: pm.id, name: 'Paul Manager', isMember: true });
  });

  it('can be picked on update', async () => {
    const task = await add(lyra, { title: 'Handed to the PM' });
    const updated = await projectTasks.update({
      user: pm,
      id: task.id,
      input: { assigneeId: pm.id },
    });
    expect(updated.assignee).toMatchObject({ id: pm.id, isMember: true });
  });

  it('reads as on the project in the list', async () => {
    const project = await newProject();
    await add(project, { title: 'Mine', assigneeId: pm.id });
    const [row] = await projectTasks.listForProject({ viewer: pm, projectId: project.id });
    expect(row.assignee.isMember).toBe(true);
  });

  it('hears about it when someone else assigns it, with a link to the Phases tab', async () => {
    const task = await add(lyra, { title: 'Told', assigneeId: pm.id }, admin);
    const added = await db('notifications').where({ type: 'project_task.added' });
    expect(added.map((row) => [row.userId, row.link])).toEqual([
      [pm.id, `/projects/${lyra.id}?tab=phases`],
    ]);
    await db('notifications').del();
    await projectTasks.update({ user: admin, id: task.id, input: { priority: 'p1' } });
    const changed = await db('notifications').where({ type: 'project_task.changed' });
    expect(changed.map((row) => row.userId)).toEqual([pm.id]);
  });

  it("doesn't notify the PM who assigns it to themselves", async () => {
    await add(lyra, { title: 'My own', assigneeId: pm.id });
    expect(await db('notifications')).toEqual([]);
  });

  it("doesn't bring the PM into tasks for anyone", async () => {
    await add(lyra, { title: 'For anyone' }, admin);
    const rows = await db('notifications').where({ type: 'project_task.added' });
    expect(rows.map((row) => row.userId).sort((a, b) => a - b)).toEqual([alice.id, bob.id]);
  });

  it('is not picked twice when also a member', async () => {
    const task = await add(vega, { title: 'Member PM', assigneeId: pmOnTeam.id }, admin);
    expect(task.assignee.isMember).toBe(true);
    const rows = await db('notifications').where({ type: 'project_task.added' });
    expect(rows.map((row) => row.userId)).toEqual([pmOnTeam.id]);
    const options = await projectTasks.listAssigneeOptions({
      viewer: pmOnTeam,
      projectId: vega.id,
    });
    expect(options.map((option) => option.name)).toEqual(['Alice Dev', 'Pia Manager']);
  });

  it('is offered once, by name, with the tracked members', async () => {
    const options = await projectTasks.listAssigneeOptions({ viewer: pm, projectId: lyra.id });
    expect(options).toEqual([
      expect.objectContaining({ id: alice.id, name: 'Alice Dev' }),
      expect.objectContaining({ id: bob.id, name: 'Bob Dev' }),
      expect.objectContaining({ id: pm.id, name: 'Paul Manager', role: 'pm' }),
    ]);
  });

  it('is refused and not offered once deactivated', async () => {
    const gonePm = await createUser({ name: 'Gia Gone', role: 'pm', tracksAttendance: false });
    const project = await createProject(gonePm, { name: 'gone-pm-project' });
    await db('users').where({ id: gonePm.id }).update({ status: 'deactivated' });
    await expectField(add(project, { title: 'No', assigneeId: gonePm.id }, admin), 'assigneeId');
    const options = await projectTasks.listAssigneeOptions({
      viewer: admin,
      projectId: project.id,
    });
    expect(options).toEqual([]);
  });

  it('still refuses someone who is neither a member nor the PM', async () => {
    await expectField(add(lyra, { title: 'No', assigneeId: formerPm.id }), 'assigneeId');
    await expectField(add(lyra, { title: 'No', assigneeId: pmOnTeam.id }), 'assigneeId');
  });

  it('marks a PM who handed the project over as not on it, and keeps the task', async () => {
    const project = await createProject(formerPm, { name: 'handed-over' });
    const task = await add(project, { title: 'Old PM task', assigneeId: formerPm.id }, admin);
    await db('projects').where({ id: project.id }).update({ pmId: pm.id });
    const rows = await projectTasks.listForProject({ viewer: pm, projectId: project.id });
    expect(rows.find((row) => row.id === task.id).assignee).toMatchObject({
      id: formerPm.id,
      isMember: false,
    });
  });
});

describe('progressByProject', () => {
  const weeks = lastFullWeeks(TODAY, TZ);

  /** A task marked done at a moment (a UTC timestamp). */
  async function doneAt(project, moment, title = `Done at ${moment}`) {
    const task = await add(project, { title });
    setNowForTests(moment);
    await projectTasks.setStatus({ user: pm, id: task.id, status: 'done' });
    setNowForTests(T0);
    return task;
  }

  it('counts all, done and done per week, for every project asked for', async () => {
    const busy = await newProject();
    const quiet = await newProject();
    const empty = await newProject();
    await add(busy, { title: 'Open one' });
    await add(busy, { title: 'Open two' });
    await doneAt(busy, '2026-10-20T06:00:00Z'); // newest full week
    await doneAt(busy, '2026-10-21T06:00:00Z');
    await doneAt(busy, '2026-10-13T06:00:00Z'); // the week before
    await doneAt(busy, '2026-10-06T06:00:00Z'); // the oldest of the three
    await doneAt(busy, '2026-09-29T06:00:00Z'); // too old to count
    await doneAt(busy, '2026-10-29T06:00:00Z'); // this week: never counts
    await add(quiet, { title: 'Only open' });

    const progress = await projectTasks.progressByProject([busy.id, quiet.id, empty.id], { weeks });
    expect(progress).toEqual({
      [busy.id]: { total: 8, done: 6, doneByWeek: [2, 1, 1] },
      [quiet.id]: { total: 1, done: 0, doneByWeek: [0, 0, 0] },
      [empty.id]: { total: 0, done: 0, doneByWeek: [0, 0, 0] },
    });
  });

  it('runs one query for many projects', async () => {
    const one = await newProject();
    const two = await newProject();
    const sql = [];
    const record = (query) => sql.push(query.sql);
    db.on('query', record);
    await projectTasks.progressByProject([one.id, two.id], { weeks });
    db.removeListener('query', record);
    expect(sql).toHaveLength(1);
  });

  it('splits the weeks at midnight in company time, not UTC', async () => {
    const project = await newProject();
    // Monday 26 October, 00:00 in Kolkata is 18:30 UTC on Sunday 25 October.
    await doneAt(project, '2026-10-25T18:29:59Z'); // Sunday 23:59:59: the newest full week
    await doneAt(project, '2026-10-25T18:30:00Z'); // Monday 00:00:00: this week
    // Monday 19 October, 00:00 in Kolkata.
    await doneAt(project, '2026-10-18T18:30:00Z'); // the newest full week
    await doneAt(project, '2026-10-18T18:29:59Z'); // the week before
    // Monday 5 October, 00:00 in Kolkata: where the three weeks begin.
    await doneAt(project, '2026-10-04T18:30:00Z'); // the oldest week
    await doneAt(project, '2026-10-04T18:29:59Z'); // too old
    const progress = await projectTasks.progressByProject([project.id], { weeks });
    expect(progress[project.id]).toEqual({ total: 6, done: 6, doneByWeek: [2, 1, 1] });
  });

  it('takes a reopened task out', async () => {
    const project = await newProject();
    const task = await doneAt(project, '2026-10-20T06:00:00Z');
    await doneAt(project, '2026-10-21T06:00:00Z');
    const counts = async () =>
      (await projectTasks.progressByProject([project.id], { weeks }))[project.id];
    expect(await counts()).toEqual({ total: 2, done: 2, doneByWeek: [2, 0, 0] });
    await projectTasks.setStatus({ user: pm, id: task.id, status: 'open' });
    expect(await counts()).toEqual({ total: 2, done: 1, doneByWeek: [1, 0, 0] });
  });

  it('counts a reopened task on the day it is done again', async () => {
    const project = await newProject();
    const task = await doneAt(project, '2026-10-20T06:00:00Z');
    await projectTasks.setStatus({ user: pm, id: task.id, status: 'open' });
    setNowForTests('2026-10-13T06:00:00Z');
    await projectTasks.setStatus({ user: pm, id: task.id, status: 'done' });
    setNowForTests(T0);
    const progress = await projectTasks.progressByProject([project.id], { weeks });
    expect(progress[project.id].doneByWeek).toEqual([0, 1, 0]);
  });

  it('forgets a deleted task', async () => {
    const project = await newProject();
    const task = await doneAt(project, '2026-10-20T06:00:00Z');
    await projectTasks.remove({ user: pm, id: task.id });
    const progress = await projectTasks.progressByProject([project.id], { weeks });
    expect(progress[project.id]).toEqual({ total: 0, done: 0, doneByWeek: [0, 0, 0] });
  });

  it('answers nothing for no ids, and ignores ids that are not ids', async () => {
    expect(await projectTasks.progressByProject([], { weeks })).toEqual({});
    expect(await projectTasks.progressByProject(['x', null], { weeks })).toEqual({});
    expect(await projectTasks.progressByProject(undefined, { weeks })).toEqual({});
  });

  it('feeds the forecast the design shows', async () => {
    const { forecastProject } = await import('@/modules/projectPlan/forecast');
    const project = await newProject();
    await db('projects')
      .where({ id: project.id })
      .update({ createdAt: new Date('2026-01-05') });
    for (const week of ['2026-10-20', '2026-10-13', '2026-10-06']) {
      for (let count = 0; count < 4; count += 1) {
        await doneAt(project, `${week}T06:00:00Z`, `${week} ${count}`);
      }
    }
    for (let count = 0; count < 4; count += 1) await doneAt(project, '2026-09-20T06:00:00Z');
    for (let count = 0; count < 34; count += 1) await add(project, { title: `Left ${count}` });
    const { total, done, doneByWeek } = (
      await projectTasks.progressByProject([project.id], { weeks })
    )[project.id];
    expect({ total, done, doneByWeek }).toEqual({ total: 50, done: 16, doneByWeek: [4, 4, 4] });
    expect(
      forecastProject({
        status: 'active',
        total,
        done,
        doneByWeek,
        deadline: '2026-12-15',
        today: TODAY,
        createdOn: '2026-01-05',
      }),
    ).toMatchObject({ kind: 'off', pct: 32, finishOn: '2026-12-29', daysLate: 14, needed: 5 });
  });
});
