// Today's to-do writes (CONTRACT 24, Request 3), against the real modules: the first line opens an
// empty draft (nothing copied), five first adds at the same moment give one report and one
// project, duplicates are skipped, the refusals of a new project, tick and untick, rename, and
// removing a line or a project (refused with hours, NOT_FOUND for lines that aren't hers today).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { preferences } from '@/modules/preferences';
import { reports } from '@/modules/reports';
import { createProjectRequest } from './dashboardKit.js';
import { insertReport } from './reportsTestKit.js';
import { caught, setClock, TODAY, YESTERDAY } from './timersKit.js';
import {
  clearTodoTables,
  createTodoWorld,
  linesOf,
  saveHours,
  titles,
  todayRows,
} from './todoKit.js';

let emp;
let colleague;
let acme;
let beta;
let paused;

const add = (title, project = beta, rest = {}) =>
  reports.addTodoLine({ user: emp, projectId: project.id, title, ...rest });

beforeAll(async () => {
  ({ emp, colleague, acme, beta, paused } = await createTodoWorld());
});

beforeEach(async () => {
  setClock('09:30');
  await clearTodoTables();
});

describe('the first line of the day', () => {
  it('opens an empty draft (nothing copied), adds the project at 0 minutes, In progress', async () => {
    await insertReport(emp, YESTERDAY, {
      entries: [{ project: acme, minutes: 60, tasks: [{ title: 'Old open', status: 'blocked' }] }],
    });
    await preferences.update({ user: emp, values: { newTaskStatus: 'done' } });

    const before = await reports.getTodo({ user: emp });
    expect(before).toMatchObject({ workDate: TODAY, reportId: null, editable: true, total: 0 });
    expect(before.groups).toEqual([]);
    expect((await todayRows(emp)).reports).toEqual([]);

    const todo = await add('  Write   the copy ');
    const { reports: rows, entries, tasks } = await todayRows(emp);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'draft', totalMinutes: 0 });
    expect(entries).toEqual([expect.objectContaining({ projectId: beta.id, minutes: 0 })]);
    expect(tasks.map((task) => [task.title, task.status, task.carriedFromTaskId])).toEqual([
      ['Write the copy', 'in_progress', null],
    ]);
    expect(todo).toMatchObject({
      reportId: rows[0].id,
      editable: true,
      submitted: false,
      done: 0,
      total: 1,
      post: { state: 'none', at: null, changed: false, postedAt: null },
      slack: { canPost: false },
      added: true,
      lineId: tasks[0].id,
    });
    expect(todo.groups).toEqual([
      {
        entryId: entries[0].id,
        project: { id: beta.id, name: 'Studio Ubique', color: 'violet' },
        minutes: 0,
        lines: [
          {
            id: tasks[0].id,
            title: 'Write the copy',
            status: 'in_progress',
            done: false,
            projectTaskId: null,
            now: false,
            carriedFrom: null,
            canStart: false,
          },
        ],
      },
    ]);
    // Yesterday's open task is suggested, not copied.
    expect(todo.suggestions[`p${acme.id}`].map((task) => task.title)).toEqual(['Old open']);
  });

  it('gives one report and one project for five first adds at the same moment', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => add(`Parallel task ${n}`, acme)));
    expect(results.every((todo) => todo.added)).toBe(true);
    const { reports: rows, entries, tasks } = await todayRows(emp);
    expect(rows).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(tasks.map((task) => task.title).sort()).toEqual(
      [1, 2, 3, 4, 5].map((n) => `Parallel task ${n}`),
    );
    expect(new Set(tasks.map((task) => task.sortOrder)).size).toBe(5);
  });

  it('skips a title the project already has (normalised) without an error', async () => {
    const first = await add('Write the copy');
    const again = await add('write THE  copy');
    expect(again).toMatchObject({ added: false, lineId: first.lineId, total: 1 });
    // Other projects may have the same title.
    expect((await add('Write the copy', acme)).total).toBe(2);
  });

  it('refuses a short title, an inactive project and a handled project request', async () => {
    let error = await caught(add('x'));
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { title: 'Write at least 2 characters.' },
    });
    error = await caught(add('Plan the launch', paused));
    expect(error).toMatchObject({
      code: 'PROJECT_NOT_ACTIVE',
      fields: { projectId: 'Only active projects can be picked.' },
    });
    const { id: requestId } = await createProjectRequest(emp, { status: 'declined' });
    error = await caught(
      reports.addTodoLine({ user: emp, projectRequestId: requestId, title: 'Blog post' }),
    );
    expect(error).toMatchObject({ code: 'PROJECT_NOT_ACTIVE' });
    expect(Object.keys(error.fields)).toEqual(['projectRequestId']);
    // A refused add leaves no empty draft behind.
    expect((await todayRows(emp)).reports).toEqual([]);
  });

  it('adds a line to a pending project request', async () => {
    const { id: requestId } = await createProjectRequest(emp, { name: 'acme-blog' });
    const todo = await reports.addTodoLine({
      user: emp,
      projectRequestId: requestId,
      title: 'Blog post',
    });
    expect(todo.groups[0]).toMatchObject({
      request: { id: requestId, name: 'acme-blog' },
      lines: [{ title: 'Blog post', canStart: false }],
    });
  });
});

describe('tick, untick, rename and remove', () => {
  it('ticks to Done and unticks to In progress; Blocked stays Blocked until ticked', async () => {
    const { lineId } = await add('Write the copy');
    let todo = await reports.updateTodoLine({ user: emp, id: lineId, done: true });
    expect(todo).toMatchObject({ done: 1, total: 1 });
    expect(linesOf(todo, beta)[0]).toMatchObject({ status: 'done', done: true });
    todo = await reports.updateTodoLine({ user: emp, id: lineId, done: false });
    expect(linesOf(todo, beta)[0]).toMatchObject({ status: 'in_progress', done: false });

    const { todo: pasted } = await reports.addTodoLines({
      user: emp,
      groups: [{ projectId: beta.id, lines: [{ title: 'Waiting on access', status: 'blocked' }] }],
    });
    const blocked = linesOf(pasted, beta)[1].id;
    todo = await reports.updateTodoLine({ user: emp, id: blocked, done: false });
    expect(linesOf(todo, beta)[1].status).toBe('blocked');
    todo = await reports.updateTodoLine({ user: emp, id: blocked, done: true });
    expect(linesOf(todo, beta)[1].status).toBe('done');
    todo = await reports.updateTodoLine({ user: emp, id: blocked, done: false });
    expect(linesOf(todo, beta)[1].status).toBe('in_progress');
  });

  it('renames a line (spaces collapse, 2 to 500 characters) and keeps its other fields', async () => {
    const { lineId } = await add('Write the copy');
    await db('reportTasks').where({ id: lineId }).update({ timerNote: 'Write the copy' });
    const todo = await reports.updateTodoLine({ user: emp, id: lineId, title: ' Write  copy ' });
    expect(titles(todo, beta)).toEqual(['Write copy']);
    expect(await db('reportTasks').where({ id: lineId }).first()).toMatchObject({
      title: 'Write copy',
      timerNote: 'Write the copy',
    });
    expect(
      await caught(reports.updateTodoLine({ user: emp, id: lineId, title: 'x'.repeat(501) })),
    ).toMatchObject({ fields: { title: 'Keep the task under 500 characters.' } });
    expect(await caught(reports.updateTodoLine({ user: emp, id: lineId }))).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { _: 'Change the title or tick the task.' },
    });
  });

  it('removes a line (the project stays) and a project with its lines', async () => {
    const { lineId } = await add('Write the copy');
    await add('Second line');
    await add('Monitor ads', acme);
    let todo = await reports.removeTodoLine({ user: emp, id: lineId });
    expect(titles(todo, beta)).toEqual(['Second line']);
    const betaEntry = todo.groups.find((group) => group.project.id === beta.id).entryId;
    todo = await reports.removeTodoProject({ user: emp, entryId: betaEntry });
    expect(todo.groups.map((group) => group.project.name)).toEqual(['Pine Tree Lane']);
    const { entries, tasks } = await todayRows(emp);
    expect(entries).toHaveLength(1);
    expect(tasks.map((task) => task.title)).toEqual(['Monitor ads']);
  });

  it('refuses to remove a project with hours, and lines or projects that are not hers today', async () => {
    const todo = await add('Monitor ads', acme);
    await saveHours(emp, { [acme.id]: 90 });
    const entryId = todo.groups[0].entryId;
    const error = await caught(reports.removeTodoProject({ user: emp, entryId }));
    expect(error).toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'This project has hours in your report. Remove it in the report.',
    });
    expect((await todayRows(emp)).tasks).toHaveLength(1);

    const theirs = await reports.addTodoLine({
      user: colleague,
      projectId: acme.id,
      title: 'Their line',
    });
    const old = await insertReport(emp, YESTERDAY, {
      entries: [{ project: acme, minutes: 60, tasks: [{ title: 'Old', status: 'done' }] }],
    });
    for (const id of [theirs.lineId, old.taskIds[0], 999999]) {
      expect(await caught(reports.updateTodoLine({ user: emp, id, done: true }))).toMatchObject({
        code: 'NOT_FOUND',
        message: "We couldn't find that task in today's to-do. Reload the page to see the latest.",
      });
      expect(await caught(reports.removeTodoLine({ user: emp, id }))).toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    expect(
      await caught(reports.removeTodoProject({ user: emp, entryId: theirs.groups[0].entryId })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect(await db('reportTasks').where({ id: theirs.lineId }).first()).toBeTruthy();
  });
});
