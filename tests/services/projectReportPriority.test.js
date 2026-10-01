// Project report: the priority of task lines linked to a priority task (CONTRACT sections 12 and
// 13): the Tasks list and the Excel Tasks sheet show it, from the latest version of a chain.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { dashboard } from '@/modules/dashboard';
import { createUser, resetDatabase } from '../helpers/db.js';
import { NOW, addMembers, createProject, createReport } from './dashboardKit.js';

let pm;
let anu;
let ben;
let orion;
let other;
let login;
let homepage;
let report;

async function priorityTask(project, overrides = {}) {
  const [id] = await db('projectTasks').insert({
    projectId: project.id,
    title: 'Fix login timeout',
    priority: 'p1',
    status: 'open',
    createdBy: pm.id,
    ...overrides,
  });
  return db('projectTasks').where({ id }).first();
}

const link = (taskId, projectTask) =>
  db('reportTasks').where({ id: taskId }).update({ projectTaskId: projectTask.id });

const byTitle = (title) => report.tasks.find((task) => task.title === title);

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(NOW); // Wednesday 30 September 2026
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  anu = await createUser({ name: 'Anu' });
  ben = await createUser({ name: 'Ben' });
  orion = await createProject(pm, { name: 'orion' });
  other = await createProject(pm, { name: 'other' });
  await addMembers(orion, [anu, ben]);
  login = await priorityTask(orion, { priority: 'p1' });
  homepage = await priorityTask(orion, { title: 'Homepage copy', priority: 'p3' });
  const elsewhere = await priorityTask(other, { title: 'Elsewhere', priority: 'p2' });

  // Anu: a linked line carried over to the next day (both days keep the link).
  const monday = await createReport(anu, '2026-09-28', {
    entries: [
      {
        projectId: orion.id,
        minutes: 240,
        tasks: [
          { title: 'Fix login timeout', status: 'in_progress' },
          { title: 'Unlinked work', status: 'done' },
        ],
      },
    ],
  });
  const tuesday = await createReport(anu, '2026-09-29', {
    entries: [
      {
        projectId: orion.id,
        minutes: 180,
        tasks: [
          {
            title: 'Fix login timeout',
            status: 'done',
            firstReportedOn: '2026-09-28',
            carriedFromTaskId: monday.taskIds[0],
          },
        ],
      },
    ],
  });
  await link(monday.taskIds[0], login);
  await link(tuesday.taskIds[0], login);

  // Ben: linked on Monday, unlinked when carried to Tuesday (the latest version decides).
  const benMonday = await createReport(ben, '2026-09-28', {
    entries: [{ projectId: orion.id, minutes: 120, tasks: [{ title: 'Copy', status: 'blocked' }] }],
  });
  await createReport(ben, '2026-09-29', {
    entries: [
      {
        projectId: orion.id,
        minutes: 60,
        tasks: [
          {
            title: 'Copy rewrite',
            status: 'in_progress',
            firstReportedOn: '2026-09-28',
            carriedFromTaskId: benMonday.taskIds[0],
          },
          { title: 'Homepage copy', status: 'in_progress' },
        ],
      },
      { projectId: other.id, minutes: 60, tasks: [{ title: 'Elsewhere', status: 'done' }] },
    ],
  });
  await link(benMonday.taskIds[0], homepage);
  const benTasks = await db('reportTasks').where({ title: 'Homepage copy' }).pluck('id');
  await link(benTasks[0], homepage);
  const elsewhereTask = await db('reportTasks').where({ title: 'Elsewhere' }).pluck('id');
  await link(elsewhereTask[0], elsewhere);

  // A draft's link never shows.
  const draft = await createReport(anu, '2026-09-30', {
    status: 'draft',
    entries: [{ projectId: orion.id, minutes: 60, tasks: [{ title: 'Draft', status: 'done' }] }],
  });
  await link(draft.taskIds[0], login);

  report = await dashboard.getProjectReport({ projectId: orion.id });
});

describe('project report priority', () => {
  it("shows the linked priority task's priority on its task row", () => {
    expect(byTitle('Fix login timeout')).toMatchObject({
      projectTaskId: login.id,
      priority: 'p1',
      projectTaskTitle: 'Fix login timeout',
      daysReported: 2,
      carried: true,
    });
    expect(byTitle('Homepage copy')).toMatchObject({ projectTaskId: homepage.id, priority: 'p3' });
  });

  it('leaves unlinked rows without a priority, and the latest version of a chain decides', () => {
    expect(byTitle('Unlinked work')).toMatchObject({ projectTaskId: null, priority: null });
    expect(byTitle('Copy rewrite')).toMatchObject({ priority: null, daysReported: 2 });
    expect(report.tasks.map((task) => task.title)).not.toContain('Draft');
    expect(report.tasks.map((task) => task.title)).not.toContain('Elsewhere');
  });

  it('follows the range: a link outside it is not read', async () => {
    const tuesdayOnly = await dashboard.getProjectReport({
      projectId: orion.id,
      from: '2026-09-29',
      to: '2026-09-29',
    });
    const fix = tuesdayOnly.tasks.find((task) => task.title === 'Fix login timeout');
    expect(fix).toMatchObject({ priority: 'p1', daysReported: 1 });
  });

  it('drops the priority when the priority task is deleted', async () => {
    const [id] = await db('projectTasks').insert({
      projectId: orion.id,
      title: 'Temporary',
      priority: 'p2',
      status: 'open',
      createdBy: pm.id,
    });
    const temp = await createReport(ben, '2026-09-25', {
      entries: [{ projectId: orion.id, minutes: 30, tasks: [{ title: 'Temp', status: 'done' }] }],
    });
    await db('reportTasks').where({ id: temp.taskIds[0] }).update({ projectTaskId: id });
    let fresh = await dashboard.getProjectReport({ projectId: orion.id });
    expect(fresh.tasks.find((task) => task.title === 'Temp').priority).toBe('p2');
    await db('projectTasks').where({ id }).delete();
    fresh = await dashboard.getProjectReport({ projectId: orion.id });
    expect(fresh.tasks.find((task) => task.title === 'Temp')).toMatchObject({
      projectTaskId: null,
      priority: null,
    });
  });

  it('puts the priority in the Excel Tasks sheet', async () => {
    const spec = await dashboard.buildProjectReportExport({ projectId: orion.id });
    const tasks = spec.sheets.find((sheet) => sheet.name === 'Tasks');
    expect(tasks.columns.map((column) => column.header).slice(0, 3)).toEqual([
      'Task',
      'Priority',
      'Person',
    ]);
    expect(tasks.rows.find((row) => row.task === 'Fix login timeout').priority).toBe('P1');
    expect(tasks.rows.find((row) => row.task === 'Homepage copy').priority).toBe('P3');
    expect(tasks.rows.find((row) => row.task === 'Unlinked work').priority).toBe('');
  });
});
