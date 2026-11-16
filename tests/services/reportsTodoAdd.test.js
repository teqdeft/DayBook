// Today's to-do, more writes (CONTRACT 24): the pasted list (duplicates, repeated projects,
// statuses, all or nothing, the 20-project and 50-task limits), lines carried from suggestions
// (a typed title copies timer_note and project_task_id, "Add to today" by id, a pasted (Done)
// line, a link that fails the checks, carry forward off), the priority task link, an open report
// tab going stale, and every write refused after submit.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { preferences } from '@/modules/preferences';
import { reports } from '@/modules/reports';
import { createProject } from './dashboardKit.js';
import { insertReport } from './reportsTestKit.js';
import { addTask, caught, setClock, TODAY, YESTERDAY } from './timersKit.js';
import {
  clearTodoTables,
  createTodoWorld,
  linesOf,
  saveHours,
  titles,
  todayRows,
} from './todoKit.js';

let pm;
let emp;
let acme;
let beta;
let paused;

const add = (title, project = beta, rest = {}) =>
  reports.addTodoLine({ user: emp, projectId: project.id, title, ...rest });

beforeAll(async () => {
  ({ pm, emp, acme, beta, paused } = await createTodoWorld());
});

beforeEach(async () => {
  setClock('09:30');
  await clearTodoTables();
});

describe('the pasted list', () => {
  it('adds new lines, skips duplicates, merges repeated projects and keeps statuses', async () => {
    await add('Write the copy');
    const result = await reports.addTodoLines({
      user: emp,
      groups: [
        {
          projectId: beta.id,
          lines: [{ title: 'write the  COPY' }, { title: 'New task' }, { title: 'new task' }],
        },
        {
          projectId: acme.id,
          lines: [
            { title: 'Ship it', status: 'done' },
            { title: 'Waiting on access', status: 'blocked' },
          ],
        },
        { projectId: beta.id, lines: [{ title: 'Third' }] },
      ],
    });
    expect(result).toMatchObject({ added: 4, skipped: 2 });
    expect(titles(result.todo, beta)).toEqual(['Write the copy', 'New task', 'Third']);
    expect(linesOf(result.todo, acme).map((line) => [line.title, line.status])).toEqual([
      ['Ship it', 'done'],
      ['Waiting on access', 'blocked'],
    ]);
    expect(result.todo).toMatchObject({ done: 1, total: 5 });
  });

  it('is all or nothing: an inactive project or a limit adds nothing', async () => {
    let error = await caught(
      reports.addTodoLines({
        user: emp,
        groups: [
          { projectId: beta.id, lines: [{ title: 'Fine' }] },
          { projectId: paused.id, lines: [{ title: 'Not fine' }] },
        ],
      }),
    );
    expect(error).toMatchObject({
      code: 'PROJECT_NOT_ACTIVE',
      fields: { 'groups.1.projectId': 'Only active projects can be picked.' },
    });
    expect((await todayRows(emp)).tasks).toEqual([]);

    const lines = Array.from({ length: 48 }, (_, i) => ({ title: `Line ${i + 1}` }));
    await reports.addTodoLines({ user: emp, groups: [{ projectId: beta.id, lines }] });
    error = await caught(
      reports.addTodoLines({
        user: emp,
        groups: [
          {
            projectId: beta.id,
            lines: [{ title: 'Line 49' }, { title: 'Line 50' }, { title: 'Line 51' }],
          },
        ],
      }),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'A project can have up to 50 tasks.',
      fields: { 'groups.0.lines': 'A project can have up to 50 tasks.' },
    });
    expect((await todayRows(emp)).tasks).toHaveLength(48);
  });

  it('stops at 20 projects in the report', async () => {
    const extra = [];
    for (let i = 0; i < 20; i += 1) extra.push(await createProject(pm, { name: `p-${i}` }));
    await reports.addTodoLines({
      user: emp,
      groups: extra.map((project) => ({ projectId: project.id, lines: [{ title: 'One line' }] })),
    });
    const error = await caught(add('One project too many'));
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'A report can have up to 20 projects.',
      fields: { projectId: 'A report can have up to 20 projects.' },
    });
    // A project already in the report still takes lines.
    expect((await add('Another line', extra[0])).added).toBe(true);
  });
});

describe('lines carried from past reports', () => {
  async function openTask(overrides = {}) {
    const taskId = await addTask(acme, pm, { title: 'Login timeout' });
    const old = await insertReport(emp, YESTERDAY, {
      entries: [
        {
          project: acme,
          minutes: 60,
          tasks: [{ title: 'Fix the login bug', status: 'blocked', firstReportedOn: '2026-09-25' }],
        },
      ],
    });
    await db('reportTasks')
      .where({ id: old.taskIds[0] })
      .update({ projectTaskId: taskId, timerNote: 'Login bug note', ...overrides });
    return { sourceId: old.taskIds[0], taskId };
  }

  it('makes a typed title equal to a suggestion a carried line, copying timer_note and project_task_id', async () => {
    const { sourceId, taskId } = await openTask();
    expect((await reports.getTodo({ user: emp })).suggestions[`p${acme.id}`]).toHaveLength(1);
    const todo = await add('fix the LOGIN bug', acme);
    expect(linesOf(todo, acme)).toEqual([
      expect.objectContaining({
        title: 'fix the LOGIN bug',
        status: 'blocked',
        projectTaskId: taskId,
        carriedFrom: { workDate: YESTERDAY, dayLabel: 'From yesterday' },
      }),
    ]);
    expect(await db('reportTasks').where({ id: todo.lineId }).first()).toMatchObject({
      carriedFromTaskId: sourceId,
      firstReportedOn: '2026-09-25',
      projectTaskId: taskId,
      timerNote: 'Login bug note',
    });
    expect(todo.suggestions).toEqual({});
  });

  it('carries "Add to today" by id, and a pasted (Done) line equal to a suggestion', async () => {
    const { sourceId } = await openTask();
    const second = await insertReport(emp, '2026-09-28', {
      entries: [
        { project: beta, minutes: 30, tasks: [{ title: 'Draft blog', status: 'in_progress' }] },
      ],
    });
    let todo = await add('Fix the login bug', acme, { carriedFromTaskId: sourceId });
    expect(linesOf(todo, acme)[0]).toMatchObject({
      status: 'blocked',
      carriedFrom: { workDate: YESTERDAY },
    });

    const result = await reports.addTodoLines({
      user: emp,
      groups: [{ projectId: beta.id, lines: [{ title: 'Draft blog', status: 'done' }] }],
    });
    todo = result.todo;
    expect(linesOf(todo, beta)[0]).toMatchObject({
      status: 'done',
      carriedFrom: { workDate: '2026-09-28', dayLabel: 'From Monday' },
    });
    expect(
      (
        await db('reportTasks')
          .where({ id: linesOf(todo, beta)[0].id })
          .first()
      ).carriedFromTaskId,
    ).toBe(second.taskIds[0]);
  });

  it('drops a link that fails the checks and saves the line as new', async () => {
    const { sourceId } = await openTask({
      carryClosedAt: new Date(),
      carryClosedReason: 'dropped',
    });
    const todo = await add('Fix the login bug', acme, { carriedFromTaskId: sourceId });
    expect(linesOf(todo, acme)[0]).toMatchObject({ status: 'in_progress', carriedFrom: null });
    expect(
      (await db('reportTasks').where({ id: todo.lineId }).first()).carriedFromTaskId,
    ).toBeNull();
  });

  it("doesn't carry a typed title with carry forward off", async () => {
    await openTask();
    await preferences.update({ user: emp, values: { carryOver: false } });
    const todo = await add('Fix the login bug', acme);
    expect(linesOf(todo, acme)[0]).toMatchObject({ status: 'in_progress', carriedFrom: null });
    expect(todo.suggestions).toEqual({});
  });
});

describe('priority tasks and the report', () => {
  it('links a priority task once ("Add to to-do"), and refuses a done one', async () => {
    const taskId = await addTask(acme, pm, { title: 'Header spacing' });
    const first = await add('Header spacing', acme, { projectTaskId: taskId });
    expect(linesOf(first, acme)[0]).toMatchObject({ projectTaskId: taskId });
    const again = await add('Header spacing fix', acme, { projectTaskId: taskId });
    expect(again).toMatchObject({ added: false, total: 1 });
    const done = await addTask(acme, pm, { title: 'Old task', status: 'done' });
    expect(await caught(add('Old task', acme, { projectTaskId: done }))).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { projectTaskId: 'That priority task is already done. Pick an open one.' },
    });
  });

  it('makes an open report tab stale, like a save elsewhere', async () => {
    await add('Monitor ads', acme);
    const view = await reports.openForDate({ user: emp, workDate: TODAY });
    await add('Second line', acme);
    expect(await caught(saveHours(emp, { [acme.id]: 60 }, view.version))).toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refuses every write after submit; the to-do shows submitted without suggestions', async () => {
    await insertReport(emp, YESTERDAY, {
      entries: [{ project: beta, minutes: 60, tasks: [{ title: 'Open', status: 'in_progress' }] }],
    });
    const { lineId, groups } = await add('Monitor ads', acme);
    const saved = await saveHours(emp, { [acme.id]: 120 });
    await reports.submitReport({ user: emp, reportId: saved.id });
    const writes = [
      () => add('After submit', acme),
      () =>
        reports.addTodoLines({
          user: emp,
          groups: [{ projectId: acme.id, lines: [{ title: 'Late' }] }],
        }),
      () => reports.updateTodoLine({ user: emp, id: lineId, done: true }),
      () => reports.removeTodoLine({ user: emp, id: lineId }),
      () => reports.removeTodoProject({ user: emp, entryId: groups[0].entryId }),
    ];
    for (const write of writes) {
      expect(await caught(write())).toMatchObject({
        code: 'REPORT_LOCKED',
        status: 409,
        message: 'Your report is in. Change tasks in the report.',
      });
    }
    const todo = await reports.getTodo({ user: emp });
    expect(todo).toMatchObject({ submitted: true, editable: true, total: 1, suggestions: {} });
  });
});
