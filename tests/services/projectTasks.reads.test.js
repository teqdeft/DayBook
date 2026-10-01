// Priority task reads (CONTRACT 13): who may read a project's tasks, the order (P1, P2, P3, then
// oldest), Today's list, My projects counts, the report picker and the latest linked report line.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject, createReport } from './dashboardKit.js';

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
let lyra; // active: alice, bob
let vega; // active, pm2: carol, alice
let paused; // on hold: alice
let tasks;

async function addAt(at, project, input, user = pm) {
  setNowForTests(at);
  return projectTasks.create({ user, projectId: project.id, input });
}

const titles = (rows) => rows.map((row) => row.title);

beforeAll(async () => {
  await resetDatabase();
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Paul Manager', role: 'pm', tracksAttendance: false });
  pm2 = await createUser({ name: 'Pia Manager', role: 'pm', tracksAttendance: false });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  alice = await createUser({ name: 'Alice Dev' });
  bob = await createUser({ name: 'Bob Dev' });
  carol = await createUser({ name: 'Carol Dev' });
  lyra = await createProject(pm, { name: 'lyra', color: 'orange', isUrgent: true });
  vega = await createProject(pm2, { name: 'vega', color: 'teal' });
  paused = await createProject(pm, { name: 'paused' });
  await addMembers(lyra, [alice, bob]);
  await addMembers(vega, [carol, alice]);
  await addMembers(paused, [alice]);

  tasks = {
    p3Old: await addAt('2026-09-20T05:00:00Z', lyra, { title: 'P3 oldest', priority: 'p3' }),
    p1New: await addAt('2026-09-25T05:00:00Z', lyra, {
      title: 'P1 newer',
      priority: 'p1',
      assigneeId: alice.id,
    }),
    p2Bob: await addAt('2026-09-22T05:00:00Z', lyra, {
      title: 'P2 for Bob',
      priority: 'p2',
      assigneeId: bob.id,
    }),
    p1Old: await addAt('2026-09-21T05:00:00Z', lyra, { title: 'P1 older', priority: 'p1' }),
    p2Done: await addAt('2026-09-19T05:00:00Z', lyra, { title: 'P2 done', priority: 'p2' }),
    vegaP2: await addAt(
      '2026-09-23T05:00:00Z',
      vega,
      { title: 'Vega for Alice', priority: 'p2', assigneeId: alice.id },
      pm2,
    ),
    vegaCarol: await addAt(
      '2026-09-23T06:00:00Z',
      vega,
      { title: 'Vega for Carol', priority: 'p1', assigneeId: carol.id },
      pm2,
    ),
    pausedP1: await addAt('2026-09-24T05:00:00Z', paused, { title: 'Paused P1', priority: 'p1' }),
  };
  setNowForTests('2026-09-30T05:00:00Z');
  await projectTasks.setStatus({ user: pm, id: tasks.p2Done.id, status: 'done' });
  await db('projects').where({ id: paused.id }).update({ status: 'on_hold' });
});

describe('listForProject', () => {
  it('orders P1, P2, P3, then oldest first', async () => {
    const rows = await projectTasks.listForProject({ viewer: pm, projectId: lyra.id });
    expect(titles(rows)).toEqual(['P1 older', 'P1 newer', 'P2 done', 'P2 for Bob', 'P3 oldest']);
    const open = await projectTasks.listForProject({
      viewer: pm,
      projectId: lyra.id,
      status: 'open',
    });
    expect(titles(open)).toEqual(['P1 older', 'P1 newer', 'P2 for Bob', 'P3 oldest']);
    const done = await projectTasks.listForProject({
      viewer: pm,
      projectId: lyra.id,
      status: 'done',
    });
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ title: 'P2 done', doneBy: pm.id, latestReport: null });
  });

  it('pages with a total', async () => {
    const page = await projectTasks.pageForProject({
      viewer: pm,
      projectId: lyra.id,
      limit: 2,
      offset: 1,
    });
    expect(page.total).toBe(5);
    expect(titles(page.rows)).toEqual(['P1 newer', 'P2 done']);
  });

  it('is readable by members, PMs and Admin, not by others', async () => {
    for (const viewer of [alice, bob, pm, pm2, admin]) {
      const rows = await projectTasks.listForProject({ viewer, projectId: lyra.id });
      expect(rows).toHaveLength(5);
    }
    for (const viewer of [carol, hr]) {
      await expect(
        projectTasks.listForProject({ viewer, projectId: lyra.id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(
      projectTasks.listForProject({ viewer: pm, projectId: 999999 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('latestReport', () => {
  it('is the newest submitted report line linked to the task', async () => {
    const link = async (user, date, status, options = {}) => {
      const { taskIds } = await createReport(user, date, {
        status: options.draft ? 'draft' : 'submitted',
        entries: [{ projectId: lyra.id, minutes: 60, tasks: [{ title: 'Line', status }] }],
      });
      await db('reportTasks').whereIn('id', taskIds).update({ projectTaskId: tasks.p1Old.id });
    };
    await link(alice, '2026-09-28', 'in_progress');
    await link(bob, '2026-09-29', 'blocked');
    await link(alice, '2026-09-30', 'done', { draft: true }); // drafts don't count
    const rows = await projectTasks.listForProject({ viewer: pm, projectId: lyra.id });
    const row = rows.find((item) => item.id === tasks.p1Old.id);
    expect(row.latestReport).toEqual({
      status: 'blocked',
      userId: bob.id,
      userName: 'Bob Dev',
      workDate: '2026-09-29',
    });
    expect(rows.find((item) => item.id === tasks.p1New.id).latestReport).toBeNull();
  });

  it("shows employees on the project only their own line, PMs and Admin everyone's", async () => {
    const latestOf = async (viewer) =>
      (await projectTasks.listForProject({ viewer, projectId: lyra.id })).find(
        (item) => item.id === tasks.p1Old.id,
      ).latestReport;
    // Bob reported last (blocked, 29 Sep): Bob and the managers see it, Alice doesn't.
    for (const viewer of [bob, pm, pm2, admin]) {
      expect(await latestOf(viewer)).toMatchObject({ userId: bob.id, status: 'blocked' });
    }
    expect(await latestOf(alice)).toBeNull();
  });

  it('reads only the last reported day of a long carry-over chain', async () => {
    const { taskIds } = await createReport(bob, '2026-09-10', {
      entries: [{ projectId: lyra.id, minutes: 60, tasks: [{ title: 'Old', status: 'done' }] }],
    });
    await db('reportTasks').whereIn('id', taskIds).update({ projectTaskId: tasks.p2Bob.id });
    for (const [date, status] of [
      ['2026-09-21', 'in_progress'],
      ['2026-09-22', 'blocked'],
    ]) {
      const report = await createReport(bob, date, {
        entries: [
          {
            projectId: lyra.id,
            minutes: 60,
            tasks: [
              { title: 'Earlier line', status: 'done' },
              { title: 'Later line', status },
            ],
          },
        ],
      });
      await db('reportTasks')
        .whereIn('id', report.taskIds)
        .update({ projectTaskId: tasks.p2Bob.id });
    }
    const rows = await projectTasks.listForProject({ viewer: pm, projectId: lyra.id });
    // Two lines on the 22nd: the later line of the report wins.
    expect(rows.find((item) => item.id === tasks.p2Bob.id).latestReport).toEqual({
      status: 'blocked',
      userId: bob.id,
      userName: 'Bob Dev',
      workDate: '2026-09-22',
    });
  });
});

describe('listOpenForUser', () => {
  it("lists open tasks on the person's active projects for them or for anyone, P1 first", async () => {
    const rows = await projectTasks.listOpenForUser(alice.id);
    expect(titles(rows)).toEqual(['P1 older', 'P1 newer', 'Vega for Alice', 'P3 oldest']);
    expect(rows[0].project).toEqual({ id: lyra.id, name: 'lyra', color: 'orange', isUrgent: true });
    expect(rows[2].project).toMatchObject({ id: vega.id, name: 'vega', isUrgent: false });
    // Bob reported on it last: Alice's list doesn't carry someone else's report line.
    expect(rows[0].latestReport).toBeNull();
    expect((await projectTasks.listOpenForUser(bob.id))[0].latestReport).toMatchObject({
      status: 'blocked',
      userName: 'Bob Dev',
    });
    expect(titles(await projectTasks.listOpenForUser(bob.id))).toEqual([
      'P1 older',
      'P2 for Bob',
      'P3 oldest',
    ]);
    expect(titles(await projectTasks.listOpenForUser(carol.id))).toEqual(['Vega for Carol']);
    expect(await projectTasks.listOpenForUser(pm.id)).toEqual([]);
    expect(await projectTasks.listOpenForUser(null)).toEqual([]);
  });
});

describe('countOpenByProjectForUser', () => {
  it('counts the same tasks per project, with the P1s', async () => {
    expect(await projectTasks.countOpenByProjectForUser(alice.id)).toEqual({
      [lyra.id]: { total: 3, p1: 2 },
      [vega.id]: { total: 1, p1: 0 },
    });
    expect(await projectTasks.countOpenByProjectForUser(bob.id)).toEqual({
      [lyra.id]: { total: 3, p1: 1 },
    });
    expect(await projectTasks.countOpenByProjectForUser(hr.id)).toEqual({});
  });
});

describe('findOpenForPicker and findById', () => {
  it('offers open tasks of an active project for the person or for anyone', async () => {
    const forAlice = await projectTasks.findOpenForPicker({ userId: alice.id, projectId: lyra.id });
    expect(titles(forAlice)).toEqual(['P1 older', 'P1 newer', 'P3 oldest']);
    const forCarol = await projectTasks.findOpenForPicker({ userId: carol.id, projectId: lyra.id });
    expect(titles(forCarol)).toEqual(['P1 older', 'P3 oldest']);
    expect(
      await projectTasks.findOpenForPicker({ userId: alice.id, projectId: paused.id }),
    ).toEqual([]);
  });

  it('offers the tasks of several projects in one call', async () => {
    const byProject = await projectTasks.findOpenForPickerByProject({
      userId: alice.id,
      projectIds: [lyra.id, vega.id, paused.id, lyra.id, 'x'],
    });
    expect(Object.keys(byProject).map(Number).sort()).toEqual([lyra.id, vega.id].sort());
    expect(titles(byProject[lyra.id])).toEqual(['P1 older', 'P1 newer', 'P3 oldest']);
    expect(titles(byProject[vega.id])).toEqual(['Vega for Alice']);
    expect(
      await projectTasks.findOpenForPickerByProject({ userId: alice.id, projectIds: [] }),
    ).toEqual({});
  });

  it('finds several tasks at once for link checks', async () => {
    const found = await projectTasks.findByIds([tasks.p2Done.id, tasks.vegaP2.id, 999999, 'x']);
    expect([...found.keys()].sort((a, b) => a - b)).toEqual(
      [tasks.p2Done.id, tasks.vegaP2.id].sort((a, b) => a - b),
    );
    expect(found.get(tasks.p2Done.id)).toEqual({
      id: tasks.p2Done.id,
      projectId: lyra.id,
      title: 'P2 done',
      priority: 'p2',
      status: 'done',
      assigneeId: null,
    });
    expect((await projectTasks.findByIds([])).size).toBe(0);
  });

  it('finds one task by id', async () => {
    expect(await projectTasks.findById(tasks.p2Bob.id)).toMatchObject({
      id: tasks.p2Bob.id,
      projectId: lyra.id,
      priority: 'p2',
      status: 'open',
      assignee: { id: bob.id, name: 'Bob Dev', initials: 'BD' },
    });
    expect(await projectTasks.findById(999999)).toBeNull();
    expect(await projectTasks.findById('x')).toBeNull();
  });

  it('lists tracked active members as assignee options', async () => {
    const options = await projectTasks.listAssigneeOptions({ viewer: pm, projectId: lyra.id });
    expect(options.map((option) => option.name)).toEqual(['Alice Dev', 'Bob Dev']);
  });
});
