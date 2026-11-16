// Planned projects (0 minutes, CONTRACT 24) read by Ask AI and by a priority task's latest
// report: Priya plans Studio Ubique on her to-do with a priority task, logs hours on Pine Tree
// Lane only and submits. Ask AI counts no person, day or task line of hers on Studio Ubique, and
// the priority task keeps the colleague's real report as its latest one.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import * as aiAskRepo from '@/modules/aiAsk/repo';
import { projectTasks } from '@/modules/projectTasks';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { createProject } from './dashboardKit.js';
import { insertReport } from './reportsTestKit.js';
import { addTask, setClock, TODAY, YESTERDAY } from './timersKit.js';
import { createTodoWorld } from './todoKit.js';

let pm;
let emp;
let colleague;
let acme;
let beta;
let priorityTask;

const scope = (rest = {}) => ({
  from: TODAY,
  to: TODAY,
  projectIds: null,
  userIds: null,
  withRequests: true,
  ...rest,
});

beforeAll(async () => {
  ({ pm, emp, colleague, acme, beta } = await createTodoWorld());
  setClock('18:30');
  priorityTask = await addTask(beta, pm, { title: 'Fix the checkout bug' });
  // Yesterday Priya worked on Studio Ubique, and the colleague reported the task Blocked.
  await insertReport(emp, YESTERDAY, {
    entries: [{ project: beta, minutes: 60, tasks: [{ title: 'Beta yesterday', status: 'done' }] }],
  });
  const { taskIds } = await insertReport(colleague, YESTERDAY, {
    entries: [
      {
        project: beta,
        minutes: 180,
        tasks: [{ title: 'Fix the checkout bug', status: 'blocked' }],
      },
    ],
  });
  await db('reportTasks').where({ id: taskIds[0] }).update({ projectTaskId: priorityTask });
  // Today Priya plans both projects and logs 2 hours on Pine Tree Lane only.
  await reports.addTodoLine({ user: emp, projectId: acme.id, title: 'Worked on acme' });
  await reports.addTodoLine({
    user: emp,
    projectId: beta.id,
    title: 'Fix the checkout bug',
    projectTaskId: priorityTask,
  });
  const view = await reports.openForDate({ user: emp, workDate: TODAY });
  const entries = view.entries.map((entry) => ({
    id: entry.id,
    projectId: entry.projectId,
    minutes: entry.projectId === acme.id ? 120 : 0,
    tasks: entry.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      projectTaskId: task.projectTaskId ?? undefined,
    })),
  }));
  await reports.submitReport({
    user: emp,
    reportId: view.id,
    entries: saveReportSchema.parse({ entries }).entries,
    baseVersion: view.version,
  });
  // The colleague worked an hour on Studio Ubique today.
  await insertReport(colleague, TODAY, {
    entries: [{ project: beta, minutes: 60, tasks: [{ title: 'Colleague beta', status: 'done' }] }],
  });
});

describe('Ask AI', () => {
  it('counts only the people and days that logged hours', async () => {
    const stored = await db('reportEntries as e')
      .join('dailyReports as r', 'r.id', 'e.reportId')
      .where({ 'r.userId': emp.id, 'r.workDate': TODAY, 'e.projectId': beta.id })
      .first('e.minutes', 'r.status');
    expect(stored).toEqual({ minutes: 0, status: 'submitted' });

    const byProject = await aiAskRepo.hoursByProject(scope());
    expect(byProject.find((row) => row.projectId === beta.id)).toMatchObject({
      minutes: 60,
      people: 1,
      days: 1,
    });
    const byPerson = await aiAskRepo.hoursByPerson(scope({ from: YESTERDAY, userIds: [emp.id] }));
    expect(byPerson.find((row) => row.projectId === beta.id)).toMatchObject({
      minutes: 60,
      days: 1,
    });
  });

  it('gives no task line of the planned project, and no person who only planned it', async () => {
    const lines = await aiAskRepo.listReportTasks(scope({ userIds: [emp.id] }));
    expect(lines.map((line) => line.title)).toEqual(['Worked on acme']);

    // Gamma has no members; the colleague only planned it once.
    const gamma = await createProject(pm, { name: 'Gamma' });
    await insertReport(colleague, '2026-09-28', {
      entries: [
        { project: acme, minutes: 30, tasks: [{ title: 'Real work', status: 'done' }] },
        { project: gamma, minutes: 0, tasks: [{ title: 'Planned', status: 'in_progress' }] },
      ],
    });
    expect(await aiAskRepo.listProjectPeopleIds([gamma.id])).toEqual([]);
  });
});

describe('a priority task linked from a planned project', () => {
  it("keeps the colleague's real report as the latest one", async () => {
    const [task] = await projectTasks.listForProject({ viewer: pm, projectId: beta.id });
    expect(task.latestReport).toMatchObject({
      status: 'blocked',
      userId: colleague.id,
      workDate: YESTERDAY,
    });
  });
});
