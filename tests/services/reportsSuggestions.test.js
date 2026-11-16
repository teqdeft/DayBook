// Unfinished-task suggestions (CONTRACT 24, Request 4): which open tasks listCarrySuggestions offers
// for a day (30 days, every open day, newest first and newest wins, carried, closed, a later line
// with the same title and inactive projects left out, pending requests in, carry forward off gives
// none, the limits), and "Done already" / "Not needed" with Undo (closeSuggestion).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { preferences } from '@/modules/preferences';
import { reports } from '@/modules/reports';
import { resetDatabase } from '../helpers/db.js';
import {
  clearTables,
  createPeople,
  createProject,
  createProjectRequest,
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
let colleague;
let internal;
let iwill;
let onHold;

const open = (title, status = 'in_progress') => ({ title, status });

/** A submitted report with one project and these tasks. */
function submitted(day, project, tasks, person = people.person) {
  return insertReport(person, day, { entries: [{ project, minutes: 60, tasks }] });
}

function suggestionsFor(date = TUESDAY, person = user) {
  return reports.listCarrySuggestions({ userId: person.id, date });
}

/** { projectKey: [title, ...] } */
async function titles(date = TUESDAY) {
  const result = await suggestionsFor(date);
  return Object.fromEntries(
    Object.entries(result).map(([key, tasks]) => [key, tasks.map((task) => task.title)]),
  );
}

const key = (project) => `p${project.id}`;

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  user = sessionUser(people.person);
  colleague = sessionUser(people.colleague);
  internal = await createProject(people.pm, { name: 'internal-tool' });
  iwill = await createProject(people.pm, { name: 'iwilltillimwell' });
  onHold = await createProject(people.pm, { name: 'old-site', status: 'on_hold' });
});

beforeEach(async () => {
  await clearTables('report_revisions', 'report_edit_requests', 'slack_outbox', 'notifications');
  await clearTables('report_tasks', 'report_entries', 'daily_reports', 'user_preferences');
  await clearTables('project_requests', 'audit_logs');
  setNowForTests(TUESDAY_MORNING);
});

describe('listCarrySuggestions', () => {
  it('offers open tasks of the last 30 days before the day, every open day, newest first', async () => {
    await submitted('2026-08-29', internal, [open('Too old')]); // 31 days back
    const oldest = await submitted('2026-08-30', internal, [open('Thirty days back')]);
    const thursday = await submitted('2026-09-24', internal, [
      open('Blocked on access', 'blocked'),
    ]);
    await submitted('2026-09-25', iwill, [open('Shipped', 'done'), open('Payment page')]);
    const monday = await submitted(MONDAY, internal, [open('Working on backend')]);
    // A draft (never submitted) isn't a source, nor is today's report.
    await insertReport(people.person, '2026-09-27', {
      status: 'draft',
      entries: [{ project: internal, minutes: 0, tasks: [open('Draft only')] }],
    });

    const result = await suggestionsFor();

    expect(Object.keys(result)).toEqual([key(internal), key(iwill)]);
    expect(result[key(internal)]).toEqual([
      {
        taskId: monday.taskIds[0],
        title: 'Working on backend',
        status: 'in_progress',
        workDate: MONDAY,
        dayLabel: 'From yesterday',
      },
      {
        taskId: thursday.taskIds[0],
        title: 'Blocked on access',
        status: 'blocked',
        workDate: '2026-09-24',
        dayLabel: 'From Thursday',
      },
      {
        taskId: oldest.taskIds[0],
        title: 'Thirty days back',
        status: 'in_progress',
        workDate: '2026-08-30',
        dayLabel: 'From 30 Aug',
      },
    ]);
    expect(result[key(iwill)].map((task) => task.title)).toEqual(['Payment page']);
    // Another day has its own window.
    expect((await titles('2026-08-31'))[key(internal)]).toEqual(['Thirty days back', 'Too old']);
  });

  it('keeps the newest of equal titles, and a later line of any status hides an older one', async () => {
    await submitted('2026-09-21', internal, [open('Fix login'), open('Write docs')]);
    await submitted('2026-09-22', internal, [open('fix   LOGIN')]);
    // Written again later, done: the task is finished, nothing to suggest.
    await submitted('2026-09-23', internal, [open('Write docs', 'done')]);
    // The same title on another project is another task.
    await submitted('2026-09-24', iwill, [open('Fix login'), open('Deploy'), open('deploy')]);

    expect(await titles()).toEqual({
      [key(iwill)]: ['Fix login', 'Deploy'],
      [key(internal)]: ['fix   LOGIN'],
    });
  });

  it("leaves out tasks carried by any line (today's draft too), closed ones and today's titles", async () => {
    const monday = await submitted(MONDAY, internal, [
      open('Payment page'),
      open('Login screen'),
      open('Code review'),
      open('Still open'),
    ]);
    await db('reportTasks')
      .where({ id: monday.taskIds[2] })
      .update({ carryClosedAt: new Date(), carryClosedReason: 'dropped' });
    await insertReport(people.person, TUESDAY, {
      status: 'draft',
      entries: [
        {
          project: internal,
          minutes: 0,
          tasks: [
            // Carried and reworded: still counts as carried.
            { ...open('Payment page, mobile'), carriedFromTaskId: monday.taskIds[0] },
            // Typed again by hand on the same project: the same task.
            open('login screen'),
          ],
        },
      ],
    });

    expect(await titles()).toEqual({ [key(internal)]: ['Still open'] });
  });

  it('leaves out projects no longer active, keeps a pending request, drops a handled one', async () => {
    const pending = await createProjectRequest(people.person, { name: 'acme-blog' });
    const declined = await createProjectRequest(people.person, {
      name: 'acme-ads',
      status: 'declined',
    });
    await insertReport(people.person, MONDAY, {
      entries: [
        { project: onHold, minutes: 60, tasks: [open('Legacy fixes')] },
        { request: pending, minutes: 60, tasks: [open('First posts')] },
        { request: declined, minutes: 60, tasks: [open('Ad copy')] },
        { project: internal, minutes: 60, tasks: [open('Working on backend')] },
      ],
    });

    expect(await titles()).toEqual({
      [`r${pending.id}`]: ['First posts'],
      [key(internal)]: ['Working on backend'],
    });
  });

  it('gives at most 10 tasks a project and 20 projects', async () => {
    const many = Array.from({ length: 12 }, (_, i) => open(`Task ${i + 1}`));
    const projects = [];
    for (let i = 0; i < 21; i += 1) projects.push(await createProject(people.pm));
    await insertReport(people.person, MONDAY, {
      entries: [
        { project: internal, minutes: 60, tasks: many },
        ...projects.map((project) => ({ project, minutes: 0, tasks: [open('One more')] })),
      ],
    });

    const result = await suggestionsFor();
    expect(Object.keys(result)).toHaveLength(20);
    expect(result[key(internal)].map((task) => task.title)).toEqual(
      many.slice(0, 10).map((task) => task.title),
    );
  });

  it('gives none while carry forward is off, and only the person their own tasks', async () => {
    await submitted(MONDAY, internal, [open('Working on backend')]);
    await submitted(MONDAY, internal, [open('Priya task')], people.colleague);
    expect(await titles()).toEqual({ [key(internal)]: ['Working on backend'] });
    expect(Object.values(await suggestionsFor(TUESDAY, colleague)).flat()).toHaveLength(1);

    await preferences.update({ user, values: { carryOver: false } });
    expect(await suggestionsFor()).toEqual({});
  });
});

describe('closeSuggestion (Done already, Not needed)', () => {
  /** What closing must never touch: reports, revisions, Slack rows and Monday's version. */
  async function untouched(reportId) {
    return {
      reports: await db('dailyReports').orderBy('id'),
      entries: await db('reportEntries').orderBy('id'),
      revisions: await db('reportRevisions').count({ n: '*' }).first(),
      outbox: await db('slackOutbox').count({ n: '*' }).first(),
      version: (await reports.getReport({ user, reportId })).version,
    };
  }

  it("Done already closes the old line, leaves today's report alone, and Undo opens it", async () => {
    const monday = await submitted(MONDAY, internal, [open('Working on backend'), open('Docs')]);
    const before = await untouched(monday.id);

    const closed = await reports.closeSuggestion({
      user,
      taskId: monday.taskIds[0],
      reason: 'done',
      ip: '10.0.0.5',
    });

    expect(closed).toEqual({ taskId: monday.taskIds[0], closed: true, reason: 'done' });
    expect(await db('reportTasks').where({ id: monday.taskIds[0] }).first()).toMatchObject({
      status: 'in_progress',
      carryClosedReason: 'done',
      carryClosedAt: expect.any(Date),
    });
    // No draft for today, no revision, no Slack update, the same version.
    expect(await untouched(monday.id)).toEqual(before);
    expect(await titles()).toEqual({ [key(internal)]: ['Docs'] });
    expect(await db('auditLogs').where({ action: 'report.carry_close' }).first()).toMatchObject({
      actorId: user.id,
      entityType: 'report_task',
      entityId: monday.taskIds[0],
      ip: '10.0.0.5',
    });

    const undone = { user, taskId: monday.taskIds[0], reason: 'done', undo: true };
    expect(await reports.closeSuggestion(undone)).toEqual({
      taskId: monday.taskIds[0],
      closed: false,
      reason: null,
    });
    expect(await db('reportTasks').where({ id: monday.taskIds[0] }).first()).toMatchObject({
      carryClosedAt: null,
      carryClosedReason: null,
    });
    expect(await titles()).toEqual({ [key(internal)]: ['Working on backend', 'Docs'] });
    // A second Undo changes nothing.
    await expect(reports.closeSuggestion(undone)).resolves.toMatchObject({ closed: false });
    expect(await db('auditLogs').where({ action: 'report.carry_reopen' })).toHaveLength(1);
    expect(await untouched(monday.id)).toEqual(before);
  });

  it('Not needed closes it with the reason dropped', async () => {
    const monday = await submitted(MONDAY, internal, [open('Old idea', 'blocked')]);
    await reports.closeSuggestion({ user, taskId: monday.taskIds[0], reason: 'dropped' });
    expect(await db('reportTasks').where({ id: monday.taskIds[0] }).first()).toMatchObject({
      status: 'blocked',
      carryClosedReason: 'dropped',
    });
    expect(await suggestionsFor()).toEqual({});
  });

  it("answers NOT_FOUND, never FORBIDDEN, for a line that isn't the person's own open line", async () => {
    const mine = await submitted(MONDAY, internal, [open('Shipped', 'done'), open('Carried')]);
    const theirs = await submitted(MONDAY, internal, [open('Priya task')], people.colleague);
    const draft = await insertReport(people.person, TUESDAY, {
      status: 'draft',
      entries: [
        {
          project: internal,
          minutes: 0,
          tasks: [open('Today'), { ...open('Carried'), carriedFromTaskId: mine.taskIds[1] }],
        },
      ],
    });
    const closedOnce = await submitted('2026-09-25', internal, [open('Closed before')]);
    await reports.closeSuggestion({ user, taskId: closedOnce.taskIds[0], reason: 'done' });

    for (const taskId of [
      theirs.taskIds[0], // someone else's
      mine.taskIds[0], // done
      mine.taskIds[1], // carried into today's draft
      draft.taskIds[0], // a draft line
      closedOnce.taskIds[0], // already closed
      999999, // no such line
    ]) {
      await expect(
        reports.closeSuggestion({ user, taskId, reason: 'dropped' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    }
    // Undo of someone else's line too.
    await expect(
      reports.closeSuggestion({ user, taskId: theirs.taskIds[0], reason: 'done', undo: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db('reportTasks').whereNotNull('carryClosedAt')).toHaveLength(1);
  });
});
