// A task carried into a draft that locked without being submitted (a missed day, CONTRACT 24):
// that draft never became a report, so its line neither carries the task on nor hides it. The
// task is suggested again, can be closed with Done already, and can be carried again with its
// first reported day. A draft still open (today's, or one an approved edit request reopened)
// still counts. And a line closed from the suggestions is no stuck task.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { reports } from '@/modules/reports';
import { insertReport } from './reportsTestKit.js';
import { setClock, TODAY, YESTERDAY } from './timersKit.js';
import { clearTodoTables, createTodoWorld, linesOf } from './todoKit.js';

const THURSDAY = '2026-09-24';
const FRIDAY = '2026-09-25';

let emp;
let acme;

beforeAll(async () => {
  ({ emp, acme } = await createTodoWorld());
});

beforeEach(async () => {
  setClock('09:30');
  await clearTodoTables();
});

const suggested = async () =>
  (await reports.listCarrySuggestions({ userId: emp.id, date: TODAY }))[`p${acme.id}`] ?? [];

/** Thursday's open line, carried on Friday into a draft nobody submitted. */
async function missedFriday() {
  const { taskIds } = await insertReport(emp, THURSDAY, {
    entries: [
      {
        project: acme,
        minutes: 60,
        tasks: [{ title: 'Fix the redirects', status: 'in_progress' }],
      },
    ],
  });
  const source = taskIds[0];
  setClock('16:00', FRIDAY);
  expect((await suggested()).map((task) => task.taskId)).toEqual([source]);
  await reports.addTodoLine({
    user: emp,
    projectId: acme.id,
    title: 'Fix the redirects',
    carriedFromTaskId: source,
  });
  const friday = await db('dailyReports').where({ userId: emp.id, workDate: FRIDAY }).first();
  expect(friday.status).toBe('draft');
  return { source, friday };
}

describe('a draft that locked unsubmitted', () => {
  it('hides the task while the draft is open, and suggests it again once it locked', async () => {
    const { source } = await missedFriday();
    expect(await suggested()).toEqual([]);

    setClock('09:30', TODAY);
    expect(await suggested()).toEqual([
      expect.objectContaining({ taskId: source, workDate: THURSDAY, dayLabel: 'From Thursday' }),
    ]);
  });

  it('lets the person close the task, and Undo it', async () => {
    const { source } = await missedFriday();
    setClock('09:30', TODAY);
    expect(await reports.closeSuggestion({ user: emp, taskId: source, reason: 'done' })).toEqual({
      taskId: source,
      closed: true,
      reason: 'done',
    });
    expect(await suggested()).toEqual([]);
    await reports.closeSuggestion({ user: emp, taskId: source, reason: 'done', undo: true });
    expect(await suggested()).toHaveLength(1);
  });

  it('carries the task again into today, with its first reported day', async () => {
    const { source } = await missedFriday();
    setClock('09:30', TODAY);
    const todo = await reports.addTodoLine({
      user: emp,
      projectId: acme.id,
      title: 'Fix the redirects',
      carriedFromTaskId: source,
    });
    expect(await db('reportTasks').where({ id: todo.lineId }).first()).toMatchObject({
      carriedFromTaskId: source,
      firstReportedOn: THURSDAY,
    });
    expect(linesOf(todo, acme)[0].carriedFrom).toEqual({
      workDate: THURSDAY,
      dayLabel: 'From Thursday',
    });
    expect(todo.suggestions).toEqual({});
  });

  it('counts again once an approved edit request reopens that draft', async () => {
    const { source, friday } = await missedFriday();
    setClock('09:30', TODAY);
    await db('dailyReports')
      .where({ id: friday.id })
      .update({ unlockedUntil: new Date('2026-10-01T04:00:00Z') });
    expect(await suggested()).toEqual([]);
    const error = await reports
      .closeSuggestion({ user: emp, taskId: source, reason: 'dropped' })
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('stuck tasks', () => {
  it('leaves out a line closed from the suggestions', async () => {
    const { taskIds } = await insertReport(emp, YESTERDAY, {
      entries: [
        {
          project: acme,
          minutes: 60,
          tasks: [
            { title: 'Old work', status: 'in_progress', firstReportedOn: '2026-09-21' },
            { title: 'Older work', status: 'in_progress', firstReportedOn: '2026-09-14' },
          ],
        },
      ],
    });
    const titles = async () =>
      (await reports.listStuckTasks(emp.id, { today: TODAY })).map((task) => task.title);
    expect(await titles()).toEqual(['Older work', 'Old work']);
    await reports.closeSuggestion({ user: emp, taskId: taskIds[0], reason: 'dropped' });
    expect(await titles()).toEqual(['Older work']);
  });
});
