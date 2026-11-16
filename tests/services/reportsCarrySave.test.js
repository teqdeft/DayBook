// carriedFromTaskId on a report save (CONTRACT 24, "Report save"): a new line added from a
// suggestion links back to the open task and copies its first day, priority task link and timer
// note, but only for the person's own open line of an earlier submitted report on the same project
// that isn't closed or carried already (one claim per source per save, lines this save deletes
// don't count). Otherwise the field is dropped and the line saves as new. An existing line's link
// never changes.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { resetDatabase } from '../helpers/db.js';
import {
  clearTables,
  createPeople,
  createProject,
  createProjectRequest,
  entriesFrom,
  insertReport,
  sessionUser,
} from './reportsTestKit.js';

vi.mock('@/modules/users', async () => ({
  users: (await import('./reportsTestKit.js')).fakeUsers,
}));
vi.mock('@/modules/projects', async () => ({
  projects: (await import('./reportsTestKit.js')).fakeProjects,
}));
vi.mock('@/modules/attendance', async () => ({
  attendance: (await import('./reportsTestKit.js')).fakeAttendance,
}));

// Tuesday 29 September 2026, 9:30 AM in Asia/Kolkata.
const TUESDAY_MORNING = '2026-09-29T04:00:00Z';
const TUESDAY = '2026-09-29';
const MONDAY = '2026-09-28';

let people;
let user;
let internal;
let iwill;

function input(entries) {
  return saveReportSchema.parse({ entries }).entries;
}

const line = (title, carriedFromTaskId, status = 'in_progress') => ({
  title,
  status,
  carriedFromTaskId,
});

/** Saves today's draft with one card on `project` holding these lines. */
async function saveLines(lines, { project = internal, request } = {}) {
  const draft = await reports.openForDate({ user });
  const card = request ? { projectRequestId: request.id } : { projectId: project.id };
  return reports.saveReport({
    user,
    reportId: draft.id,
    entries: input([{ ...card, hours: 1, tasks: lines }]),
  });
}

/** [title, carriedFromTaskId, firstReportedOn] of the first card's lines. */
const links = (view) =>
  view.entries[0].tasks.map((task) => [task.title, task.carriedFromTaskId, task.firstReportedOn]);

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  user = sessionUser(people.person);
  internal = await createProject(people.pm, { name: 'internal-tool' });
  iwill = await createProject(people.pm, { name: 'iwilltillimwell' });
});

beforeEach(async () => {
  await clearTables('report_revisions', 'report_edit_requests', 'slack_outbox', 'notifications');
  await clearTables('report_tasks', 'report_entries', 'daily_reports', 'project_requests');
  await clearTables('project_tasks');
  setNowForTests(TUESDAY_MORNING);
});

describe('carriedFromTaskId on a report save', () => {
  it('keeps the link to an own open line and copies its first day, link and timer note', async () => {
    const monday = await insertReport(people.person, MONDAY, {
      entries: [
        {
          project: internal,
          minutes: 60,
          tasks: [{ title: 'Fix login', status: 'blocked', firstReportedOn: '2026-09-21' }],
        },
      ],
    });
    const [priority] = await db('projectTasks').insert({
      projectId: internal.id,
      title: 'Login timeout',
      priority: 'p1',
      status: 'open',
      createdBy: people.pm.id,
    });
    await db('reportTasks')
      .where({ id: monday.taskIds[0] })
      .update({ projectTaskId: priority, timerNote: 'Fix login' });

    const saved = await saveLines([line('Fix the login page', monday.taskIds[0], 'blocked')]);

    expect(saved.entries[0]).toMatchObject({ carried: true });
    expect(saved.entries[0].tasks[0]).toMatchObject({
      title: 'Fix the login page',
      status: 'blocked',
      carriedFromTaskId: monday.taskIds[0],
      firstReportedOn: '2026-09-21',
      projectTaskId: priority,
      priority: 'p1',
      timerNote: 'Fix login',
    });
  });

  it("drops it for someone else's, done, closed, a draft's, another project's or carried lines", async () => {
    const mine = await insertReport(people.person, MONDAY, {
      entries: [
        {
          project: internal,
          minutes: 60,
          tasks: [
            { title: 'Shipped', status: 'done' },
            { title: 'Closed', status: 'in_progress' },
            { title: 'Carried already', status: 'in_progress' },
          ],
        },
        { project: iwill, minutes: 60, tasks: [{ title: 'Other project', status: 'blocked' }] },
      ],
    });
    await db('reportTasks')
      .where({ id: mine.taskIds[1] })
      .update({ carryClosedAt: new Date(), carryClosedReason: 'done' });
    const theirs = await insertReport(people.colleague, MONDAY, {
      entries: [
        { project: internal, minutes: 60, tasks: [{ title: 'Theirs', status: 'blocked' }] },
      ],
    });
    // A draft an approved edit request keeps open: its carried line counts (a draft that locked
    // unsubmitted would not, see reportsCarryLapsed.test.js).
    const oldDraft = await insertReport(people.person, '2026-09-25', {
      status: 'draft',
      unlockedUntil: new Date('2026-09-30T04:00:00Z'),
      entries: [
        {
          project: internal,
          minutes: 0,
          tasks: [
            { title: 'Draft line', status: 'in_progress' },
            { title: 'Carried already', status: 'in_progress', carriedFromTaskId: mine.taskIds[2] },
          ],
        },
      ],
    });

    const saved = await saveLines([
      line('Theirs', theirs.taskIds[0]),
      line('Shipped', mine.taskIds[0]),
      line('Closed', mine.taskIds[1]),
      line('Carried already', mine.taskIds[2]),
      line('Other project', mine.taskIds[3]),
      line('Draft line', oldDraft.taskIds[0]),
      line('No such line', 999999),
    ]);

    expect(links(saved)).toEqual([
      ['Theirs', null, TUESDAY],
      ['Shipped', null, TUESDAY],
      ['Closed', null, TUESDAY],
      ['Carried already', null, TUESDAY],
      ['Other project', null, TUESDAY],
      ['Draft line', null, TUESDAY],
      ['No such line', null, TUESDAY],
    ]);
    expect(saved.entries[0].carried).toBe(false);
  });

  it('lets one line claim a source per save, and never a line of a later day', async () => {
    const monday = await insertReport(people.person, MONDAY, {
      entries: [{ project: internal, minutes: 60, tasks: [{ title: 'Twice', status: 'blocked' }] }],
    });
    const saved = await saveLines([
      line('Twice', monday.taskIds[0]),
      line('Twice', monday.taskIds[0]),
    ]);
    expect(links(saved)).toEqual([
      ['Twice', monday.taskIds[0], MONDAY],
      ['Twice', null, TUESDAY],
    ]);
    // Monday's report (yesterday, still open until noon) can't carry from today's line.
    const opened = await reports.openForDate({ user, workDate: MONDAY });
    const back = await reports.saveReport({
      user,
      reportId: opened.id,
      entries: input([
        ...entriesFrom(opened),
        { projectId: iwill.id, hours: 1, tasks: [line('Back', saved.entries[0].tasks[1].id)] },
      ]),
    });
    expect(back.entries[1].tasks[0]).toMatchObject({ carriedFromTaskId: null });
  });

  it('keeps the link when a carried line is removed and added again in one save', async () => {
    const monday = await insertReport(people.person, MONDAY, {
      entries: [
        { project: internal, minutes: 60, tasks: [{ title: 'Re-add', status: 'blocked' }] },
      ],
    });
    const first = await saveLines([line('Re-add', monday.taskIds[0])]);
    const oldLine = first.entries[0].tasks[0];

    // The page dropped the line and added it again from the suggestion: no id, same source.
    const again = await reports.saveReport({
      user,
      reportId: first.id,
      entries: input([
        {
          id: first.entries[0].id,
          projectId: internal.id,
          hours: 1,
          tasks: [line('Re-added', monday.taskIds[0], 'blocked')],
        },
      ]),
    });

    expect(again.entries[0].tasks).toEqual([
      expect.objectContaining({
        title: 'Re-added',
        carriedFromTaskId: monday.taskIds[0],
        firstReportedOn: MONDAY,
      }),
    ]);
    expect(again.entries[0].tasks[0].id).not.toBe(oldLine.id);
    expect(await db('reportTasks').where({ id: oldLine.id }).first()).toBeUndefined();
  });

  it("never changes an existing line's link", async () => {
    const monday = await insertReport(people.person, MONDAY, {
      entries: [
        {
          project: internal,
          minutes: 60,
          tasks: [
            { title: 'First', status: 'blocked' },
            { title: 'Second', status: 'blocked' },
          ],
        },
      ],
    });
    const first = await saveLines([line('First', monday.taskIds[0]), line('Typed', undefined)]);
    const [carried, typed] = first.entries[0].tasks;
    const again = await reports.saveReport({
      user,
      reportId: first.id,
      entries: input([
        {
          id: first.entries[0].id,
          projectId: internal.id,
          hours: 1,
          tasks: [
            { id: carried.id, ...line('First', monday.taskIds[1]) },
            { id: typed.id, ...line('Typed', monday.taskIds[1]) },
          ],
        },
      ]),
    });
    expect(links(again)).toEqual([
      ['First', monday.taskIds[0], MONDAY],
      ['Typed', null, TUESDAY],
    ]);
  });

  it('carries onto the same project request, not from a request to a project', async () => {
    const request = await createProjectRequest(people.person, { name: 'acme-blog' });
    const monday = await insertReport(people.person, MONDAY, {
      entries: [
        {
          request,
          minutes: 60,
          tasks: [
            { title: 'First posts', status: 'in_progress' },
            { title: 'Second posts', status: 'in_progress' },
          ],
        },
      ],
    });
    const draft = await reports.openForDate({ user });
    const saved = await reports.saveReport({
      user,
      reportId: draft.id,
      entries: input([
        { projectRequestId: request.id, hours: 1, tasks: [line('First posts', monday.taskIds[0])] },
        { projectId: internal.id, hours: 1, tasks: [line('Second posts', monday.taskIds[1])] },
      ]),
    });
    expect(saved.entries.map((entry) => entry.tasks[0].carriedFromTaskId)).toEqual([
      monday.taskIds[0],
      null,
    ]);
  });

  it('takes a positive whole number, and nothing for empty values', () => {
    const parse = (carriedFromTaskId) =>
      saveReportSchema.safeParse({
        entries: [{ projectId: 1, hours: 1, tasks: [line('Task', carriedFromTaskId)] }],
      });
    expect(parse(12).data.entries[0].tasks[0].carriedFromTaskId).toBe(12);
    for (const empty of [undefined, null, '']) {
      expect(parse(empty).data.entries[0].tasks[0].carriedFromTaskId).toBeUndefined();
    }
    for (const bad of [0, -3, 1.5, '12', 'abc']) {
      expect(parse(bad).error.issues[0]).toMatchObject({
        path: ['entries', 0, 'tasks', 0, 'carriedFromTaskId'],
        message: 'That task to carry is not valid.',
      });
    }
  });
});
