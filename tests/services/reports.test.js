import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import {
  clearTables,
  createPeople,
  createProject,
  createProjectRequest,
  entriesFrom,
  insertReport,
  outboxRows,
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
const MONDAY = '2026-09-28';
const TUESDAY = '2026-09-29';

let people;
let user;
let internal;
let iwill;
let onHold;

/** Parses entries through the PUT schema, as the API does. */
function input(entries) {
  return saveReportSchema.parse({ entries }).entries;
}

function task(title, status = 'in_progress') {
  return { title, status };
}

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  user = sessionUser(people.person);
  internal = await createProject(people.pm, { name: 'internal-tool' });
  iwill = await createProject(people.pm, {
    name: 'iwilltillimwell',
    color: 'orange',
    isUrgent: true,
  });
  onHold = await createProject(people.pm, { name: 'old-site', status: 'on_hold' });
  await setSettings({
    slack_report_channel_id: 'C0DAILY',
    slack_report_channel_name: 'daily-reports',
  });
});

beforeEach(async () => {
  await clearTables('report_revisions', 'report_edit_requests', 'slack_outbox', 'notifications');
  await clearTables('report_tasks', 'report_entries', 'daily_reports', 'attendance');
  setNowForTests(TUESDAY_MORNING);
});

describe('opening a report', () => {
  it("creates today's draft with carry-over from the latest submitted report", async () => {
    await insertReport(people.person, '2026-09-25', {
      entries: [{ project: internal, minutes: 480, tasks: [task('Old work')] }],
    });
    const monday = await insertReport(people.person, MONDAY, {
      entries: [
        {
          project: internal,
          minutes: 360,
          tasks: [task('Working on backend', 'in_progress'), task('Shipped login', 'done')],
        },
        { project: iwill, minutes: 60, tasks: [task('Payment page', 'blocked')] },
        { project: onHold, minutes: 60, tasks: [task('Legacy fixes')] },
      ],
    });
    // The backend task started a week earlier; carry-over must keep that date.
    await db('reportTasks')
      .where({ id: monday.taskIds[0] })
      .update({ firstReportedOn: '2026-09-21' });

    const view = await reports.openForDate({ user });

    expect(view).toMatchObject({ workDate: TUESDAY, status: 'draft', editable: true, revision: 0 });
    expect(view.locksAt.toISOString()).toBe('2026-09-30T06:30:00.000Z');
    expect(view.entries.map((e) => e.projectName)).toEqual(['internal-tool', 'iwilltillimwell']);
    expect(view.entries.every((e) => e.minutes === 0 && e.carried)).toBe(true);
    expect(view.entries[0].tasks).toEqual([
      expect.objectContaining({
        title: 'Working on backend',
        status: 'in_progress',
        firstReportedOn: '2026-09-21',
        carriedFromTaskId: monday.taskIds[0],
      }),
    ]);
    expect(view.entries[1].tasks[0]).toMatchObject({ status: 'blocked', firstReportedOn: MONDAY });
    expect(view.entries[1].isUrgent).toBe(true);
  });

  it('returns the same draft when opened again, and ignores later drafts as a source', async () => {
    const first = await reports.openForDate({ user });
    const again = await reports.openForDate({ user, workDate: TUESDAY });
    expect(again.id).toBe(first.id);
    expect(await db('dailyReports').where({ userId: user.id }).count({ n: '*' }).first()).toEqual({
      n: 1,
    });
    expect(first.entries).toEqual([]);
  });

  it('refuses future days and shows a missing day after its lock as read-only', async () => {
    await expectCode(reports.openForDate({ user, workDate: '2026-09-30' }), 'REPORT_IN_FUTURE');
    const missing = await reports.openForDate({ user, workDate: '2026-09-24' });
    expect(missing).toMatchObject({ id: null, status: 'none', editable: false, locked: true });
    expect(await db('dailyReports').count({ n: '*' }).first()).toEqual({ n: 0 });
  });

  it('creates a forgotten past day while it is still before its lock', async () => {
    const view = await reports.openForDate({ user, workDate: MONDAY });
    expect(view).toMatchObject({ workDate: MONDAY, status: 'draft', editable: true });
  });
});

describe('autosave', () => {
  it('saves entries, keeps totals in sync and keeps carried task ids', async () => {
    const source = await insertReport(people.person, MONDAY, {
      entries: [{ project: internal, minutes: 300, tasks: [task('Working on backend')] }],
    });
    const draft = await reports.openForDate({ user });
    const entries = entriesFrom(draft);
    entries[0].hours = '6';
    entries[0].tasks.push({ title: '  API docs ', status: 'done' });
    entries.push({ projectId: iwill.id, hours: 2, tasks: [task('Content changes', 'done')] });

    const saved = await reports.saveReport({ user, reportId: draft.id, entries: input(entries) });

    expect(saved.totalMinutes).toBe(480);
    expect(saved.entries.map((e) => e.minutes)).toEqual([360, 120]);
    const [carried, added] = saved.entries[0].tasks;
    expect(carried).toMatchObject({
      id: draft.entries[0].tasks[0].id,
      carriedFromTaskId: source.taskIds[0],
    });
    expect(added).toMatchObject({
      title: 'API docs',
      firstReportedOn: TUESDAY,
      carriedFromTaskId: null,
    });

    // Removing a project and a task deletes them; the total follows.
    const next = entriesFrom(saved).slice(0, 1);
    next[0].tasks = next[0].tasks.slice(0, 1);
    next[0].hours = 7.75;
    const again = await reports.saveReport({ user, reportId: draft.id, entries: input(next) });
    expect(again.totalMinutes).toBe(465);
    expect(
      await db('reportEntries').where({ reportId: draft.id }).count({ n: '*' }).first(),
    ).toEqual({ n: 1 });
    expect(await db('reportTasks').count({ n: '*' }).first()).toEqual({ n: 2 }); // Monday's + today's
  });

  it('allows empty task rows and zero hours while drafting', async () => {
    const draft = await reports.openForDate({ user });
    const saved = await reports.saveReport({
      user,
      reportId: draft.id,
      entries: input([{ projectId: internal.id, hours: '', tasks: [task('')] }]),
    });
    expect(saved.entries[0]).toMatchObject({
      minutes: 0,
      tasks: [expect.objectContaining({ title: '' })],
    });
  });

  it('checks the shape: hours in 0.25 steps, 0 or more', () => {
    const bad = (hours) =>
      saveReportSchema.safeParse({ entries: [{ projectId: 1, hours, tasks: [] }] }).error
        ?.issues[0];
    expect(bad(1.3)).toMatchObject({ path: ['entries', 0, 'hours'] });
    expect(bad(-1)).toMatchObject({ path: ['entries', 0, 'hours'] });
    expect(bad('abc')).toMatchObject({ path: ['entries', 0, 'hours'] });
    expect(bad(1.75)).toBeUndefined();
    const noProject = saveReportSchema.safeParse({ entries: [{ hours: 1, tasks: [] }] });
    expect(noProject.error.issues[0].path).toEqual(['entries', 0, 'project']);
  });

  it('only lets people pick active projects and their own pending requests', async () => {
    const draft = await reports.openForDate({ user });
    await expect(
      reports.saveReport({
        user,
        reportId: draft.id,
        entries: input([{ projectId: onHold.id, hours: 1, tasks: [] }]),
      }),
    ).rejects.toMatchObject({
      code: 'PROJECT_NOT_ACTIVE',
      fields: { 'entries.0.project': expect.any(String) },
    });

    const mine = await createProjectRequest(people.person, { name: 'acme-blog' });
    const theirs = await createProjectRequest(people.colleague, { name: 'acme-app' });
    await expectCode(
      reports.saveReport({
        user,
        reportId: draft.id,
        entries: input([{ projectRequestId: theirs.id, hours: 1, tasks: [] }]),
      }),
      'PROJECT_NOT_ACTIVE',
    );
    const saved = await reports.saveReport({
      user,
      reportId: draft.id,
      entries: input([{ projectRequestId: mine.id, hours: 1, tasks: [task('Outline')] }]),
    });
    expect(saved.entries[0]).toMatchObject({ projectName: 'acme-blog', waitingForApproval: true });
  });

  it("refuses someone else's report", async () => {
    const draft = await reports.openForDate({ user });
    await expectCode(
      reports.saveReport({ user: sessionUser(people.colleague), reportId: draft.id, entries: [] }),
      'FORBIDDEN',
    );
  });
});

describe('submit', () => {
  async function draftWith(entries) {
    const draft = await reports.openForDate({ user });
    return { draft, entries: input(entries) };
  }

  it.each([
    ['no project', [], { entries: 'Add at least one project before you submit.' }],
    [
      'hours not above 0',
      [{ projectId: 1, hours: 0, tasks: [task('Something')] }],
      { 'entries.0.hours': 'Hours must be above 0.' },
    ],
    [
      'a project without tasks',
      [{ projectId: 1, hours: 1, tasks: [task('   ')] }],
      { 'entries.0.tasks': 'Add at least one task.' },
    ],
    [
      'a task under 2 characters',
      [{ projectId: 1, hours: 1, tasks: [task('ok'), task('x')] }],
      { 'entries.0.tasks.1.title': 'Write at least 2 characters.' },
    ],
    [
      'the same project twice',
      [
        { projectId: 1, hours: 1, tasks: [task('One')] },
        { projectId: 1, hours: 1, tasks: [task('Two')] },
      ],
      { 'entries.1.project': 'This project is already in the report.' },
    ],
    [
      'more than 16 hours',
      [
        { projectId: 1, hours: 10, tasks: [task('One')] },
        { projectId: 2, hours: 6.25, tasks: [task('Two')] },
      ],
      { total: 'A day can have at most 16 hours.' },
    ],
  ])('refuses %s', async (_, raw, fields) => {
    const ids = { 1: internal.id, 2: iwill.id };
    const entries = raw.map((entry) => ({ ...entry, projectId: ids[entry.projectId] }));
    const { draft, entries: parsed } = await draftWith(entries);
    await expect(
      reports.submitReport({ user, reportId: draft.id, entries: parsed }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields,
    });
    const row = await db('dailyReports').where({ id: draft.id }).first();
    expect(row).toMatchObject({ status: 'draft', revision: 0 });
    // The refused submit still saved the draft, so nothing typed is lost.
    expect(
      await db('reportEntries').where({ reportId: draft.id }).count({ n: '*' }).first(),
    ).toEqual({
      n: entries.length,
    });
  });

  it('refuses a 500+ character task in the schema', () => {
    const result = saveReportSchema.safeParse({
      entries: [{ projectId: 1, hours: 1, tasks: [{ title: 'x'.repeat(501), status: 'done' }] }],
    });
    expect(result.error.issues[0].path).toEqual(['entries', 0, 'tasks', 0, 'title']);
  });

  it('submits: revision, snapshot, Slack post, then an update of the same message', async () => {
    const { draft, entries } = await draftWith([
      { projectId: iwill.id, hours: 2, tasks: [task('Content changes', 'done'), task('')] },
      { projectId: internal.id, hours: 6, tasks: [task('Working on backend')] },
    ]);
    setNowForTests('2026-09-29T13:00:00Z');
    const submitted = await reports.submitReport({ user, reportId: draft.id, entries });

    expect(submitted).toMatchObject({ status: 'submitted', revision: 1, totalMinutes: 480 });
    expect(submitted.firstSubmittedAt.toISOString()).toBe('2026-09-29T13:00:00.000Z');
    expect(submitted.entries[0].tasks).toHaveLength(1); // the empty row is dropped
    const [revision] = await db('reportRevisions').where({ reportId: draft.id });
    expect(revision).toMatchObject({ revision: 1, editedBy: user.id, reason: null });
    expect(parseJson(revision.snapshot)).toEqual({
      totalMinutes: 480,
      entries: [
        {
          projectId: iwill.id,
          projectRequestId: null,
          projectName: 'iwilltillimwell',
          minutes: 120,
          tasks: [{ title: 'Content changes', status: 'done', projectTaskId: null }],
        },
        {
          projectId: internal.id,
          projectRequestId: null,
          projectName: 'internal-tool',
          minutes: 360,
          tasks: [{ title: 'Working on backend', status: 'in_progress', projectTaskId: null }],
        },
      ],
    });
    let outbox = await outboxRows();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      kind: 'report_post',
      channel: 'C0DAILY',
      relatedId: draft.id,
    });
    expect(outbox[0].payload.text).toContain('Project: iwilltillimwell\nHours: 2\nTasks');
    expect(outbox[0].payload.username).toBe('Vishal Saini');

    // The outbox posted it; a resubmit updates that message.
    await reports.saveSlackMessage({ reportId: draft.id, channelId: 'C0DAILY', ts: '1790.0001' });
    setNowForTests('2026-09-29T13:40:00Z');
    const changed = entriesFrom(submitted);
    changed[1].hours = 6.5;
    const resubmitted = await reports.submitReport({
      user,
      reportId: draft.id,
      entries: input(changed),
    });
    expect(resubmitted).toMatchObject({ revision: 2, totalMinutes: 510 });
    expect(resubmitted.firstSubmittedAt.toISOString()).toBe('2026-09-29T13:00:00.000Z');
    expect(resubmitted.submittedAt.toISOString()).toBe('2026-09-29T13:40:00.000Z');
    outbox = await outboxRows();
    expect(outbox[1]).toMatchObject({ kind: 'report_update', channel: 'C0DAILY' });
    expect(outbox[1].payload.ts).toBe('1790.0001');
    expect(
      await db('reportRevisions').where({ reportId: draft.id }).count({ n: '*' }).first(),
    ).toEqual({
      n: 2,
    });
  });

  it('treats a save after the first submit as a new revision', async () => {
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 8, tasks: [task('Working on backend')] },
    ]);
    const submitted = await reports.submitReport({ user, reportId: draft.id, entries });
    const changed = entriesFrom(submitted);
    changed[0].hours = 7;
    const saved = await reports.saveReport({ user, reportId: draft.id, entries: input(changed) });
    expect(saved).toMatchObject({ status: 'submitted', revision: 2, totalMinutes: 420 });
  });

  it('posts nothing to Slack when report posting is off', async () => {
    await setSettings({ slack_post_reports: false });
    try {
      const { draft, entries } = await draftWith([
        { projectId: internal.id, hours: 8, tasks: [task('Working on backend')] },
      ]);
      await reports.submitReport({ user, reportId: draft.id, entries });
      expect(await outboxRows()).toEqual([]);
    } finally {
      await setSettings({ slack_post_reports: true });
    }
  });
});

describe('lock', () => {
  it('locks at 12:00 the next day in company time', async () => {
    const draft = await reports.openForDate({ user });
    const entries = input([{ projectId: internal.id, hours: 8, tasks: [task('Backend')] }]);
    setNowForTests('2026-09-30T06:29:59Z'); // 11:59:59 IST on Wednesday
    await reports.saveReport({ user, reportId: draft.id, entries });
    setNowForTests('2026-09-30T06:30:00Z'); // 12:00 IST
    await expectCode(reports.saveReport({ user, reportId: draft.id, entries }), 'REPORT_LOCKED');
    await expectCode(reports.submitReport({ user, reportId: draft.id, entries }), 'REPORT_LOCKED');
    const view = await reports.openForDate({ user, workDate: TUESDAY });
    expect(view).toMatchObject({ editable: false, locked: true });
  });

  it('follows the report_lock setting', async () => {
    await setSettings({ report_lock: 'same_day_23:59' });
    try {
      const draft = await reports.openForDate({ user });
      expect(draft.locksAt.toISOString()).toBe('2026-09-29T18:29:00.000Z');
    } finally {
      await setSettings({ report_lock: 'next_day_12:00' });
    }
  });
});

describe('stuck tasks', () => {
  it('flags in-progress tasks first reported 5 or more working days ago', async () => {
    await insertReport(people.person, MONDAY, {
      entries: [
        {
          project: internal,
          minutes: 480,
          tasks: [
            { title: 'Old backend work', status: 'in_progress', firstReportedOn: '2026-09-21' },
            { title: 'Recent work', status: 'in_progress', firstReportedOn: '2026-09-24' },
            { title: 'Blocked for ages', status: 'blocked', firstReportedOn: '2026-09-01' },
          ],
        },
      ],
    });
    const stuck = await reports.listStuckTasks(user.id);
    expect(stuck).toEqual([
      expect.objectContaining({
        title: 'Old backend work',
        workingDays: 6,
        projectName: 'internal-tool',
      }),
    ]);
    await setSettings({ stuck_task_days: 7 });
    expect(await reports.listStuckTasks(user.id)).toEqual([]);
    await setSettings({ stuck_task_days: 5 });
  });
});

describe('report reminders', () => {
  it('reminds only people checked in without a submitted report', async () => {
    const waiting = people.person;
    const done = people.colleague;
    const absent = await createUser({ name: 'Away Person' });
    for (const person of [waiting, done]) {
      await db('attendance').insert({
        userId: person.id,
        workDate: TUESDAY,
        checkInAt: new Date('2026-09-29T04:00:00Z'),
        location: 'office',
        officeVerified: true,
        lateMinutes: 0,
        isWorkingDay: true,
        checkoutStatus: 'open',
        source: 'self',
      });
    }
    await insertReport(done, TUESDAY, {
      entries: [{ project: internal, minutes: 480, tasks: [task('Done')] }],
    });
    await insertReport(waiting, TUESDAY, { status: 'draft' });

    expect(await reports.sendReportReminders(TUESDAY)).toEqual({ reminded: 1 });
    const notes = await db('notifications').where({ type: 'report.reminder' });
    expect(notes).toEqual([
      expect.objectContaining({
        userId: waiting.id,
        title: "Your report for Tue, 29 Sep isn't in yet.",
        link: '/report',
      }),
    ]);
    const dms = await outboxRows();
    expect(dms).toEqual([expect.objectContaining({ kind: 'dm', channel: 'UVISHAL' })]);
    expect(dms[0].payload.text).toBe(
      "Your report for Tue, 29 Sep isn't in yet. <http://localhost:3000/report|Write your report>",
    );
    expect(
      await db('notifications').where({ userId: absent.id }).count({ n: '*' }).first(),
    ).toEqual({ n: 0 });
  });

  it('never reminds a PM or an untracked person, even with an attendance row', async () => {
    // An old check-in from before PMs stopped checking in, and a CEO who checked in once.
    const pm = await createUser({ name: 'Pam Manager', role: 'pm', tracksAttendance: false });
    const ceo = await createUser({ name: 'Cora Ceo', role: 'admin', tracksAttendance: false });
    for (const person of [pm, ceo, people.person]) {
      await db('attendance').insert({
        userId: person.id,
        workDate: TUESDAY,
        checkInAt: new Date('2026-09-29T04:00:00Z'),
        location: 'office',
        officeVerified: true,
        lateMinutes: 0,
        isWorkingDay: true,
        checkoutStatus: 'open',
        source: 'self',
      });
    }

    expect(await reports.sendReportReminders(TUESDAY)).toEqual({ reminded: 1 });
    const notes = await db('notifications').where({ type: 'report.reminder' });
    expect(notes.map((note) => note.userId)).toEqual([people.person.id]);
  });

  it('still notifies in the app but sends no DM when slack_remind is off', async () => {
    await db('attendance').insert({
      userId: people.person.id,
      workDate: TUESDAY,
      checkInAt: new Date('2026-09-29T04:00:00Z'),
      location: 'wfh',
      officeVerified: true,
      lateMinutes: 0,
      isWorkingDay: true,
      checkoutStatus: 'open',
      source: 'self',
    });
    await setSettings({ slack_remind: false });
    try {
      expect(await reports.sendReportReminders(TUESDAY)).toEqual({ reminded: 1 });
      expect(await outboxRows()).toEqual([]);
    } finally {
      await setSettings({ slack_remind: true });
    }
  });
});

describe('reads other modules use', () => {
  it('reports day status, submitted minutes and hours by project', async () => {
    await insertReport(people.person, MONDAY, {
      entries: [
        { project: internal, minutes: 360, tasks: [task('A')] },
        { project: iwill, minutes: 120, tasks: [task('B')] },
      ],
    });
    const draft = await insertReport(people.person, TUESDAY, {
      status: 'draft',
      entries: [{ project: internal, minutes: 60, tasks: [task('C')] }],
    });
    expect(await reports.getDayStatus(user.id, TUESDAY)).toEqual({
      reportId: draft.id,
      status: 'draft',
      totalMinutes: 60,
    });
    expect(await reports.getDayStatus(user.id, '2026-09-01')).toEqual({
      reportId: null,
      status: 'none',
      totalMinutes: 0,
    });
    expect(await reports.getSubmittedMinutesByDay(user.id, '2026-09-28', '2026-09-30')).toEqual({
      [MONDAY]: 480,
    });
    expect(await reports.getMinutesByProject({ from: MONDAY, to: TUESDAY })).toEqual({
      [internal.id]: 360,
      [iwill.id]: 120,
    });
    expect(await reports.getLastReportDateByProject(user.id)).toEqual({
      [internal.id]: MONDAY,
      [iwill.id]: MONDAY,
    });
  });

  it('lists recent tasks with carry-over chains collapsed', async () => {
    const monday = await insertReport(people.person, MONDAY, {
      entries: [
        { project: internal, minutes: 480, tasks: [task('Backend'), task('Docs', 'done')] },
      ],
    });
    await insertReport(people.person, TUESDAY, {
      status: 'draft',
      entries: [
        {
          project: internal,
          minutes: 60,
          tasks: [
            {
              title: 'Backend',
              status: 'done',
              firstReportedOn: MONDAY,
              carriedFromTaskId: monday.taskIds[0],
            },
          ],
        },
      ],
    });
    const tasks = await reports.listRecentTasks(user.id, MONDAY, TUESDAY);
    expect(tasks.map((t) => [t.title, t.status, t.workDate])).toEqual([
      ['Backend', 'done', TUESDAY],
      ['Docs', 'done', MONDAY],
    ]);
    expect(tasks[0]).toMatchObject({
      projectName: 'internal-tool',
      projectColor: 'blue',
      firstReportedOn: MONDAY,
    });
  });

  it('moves entries from a project request to its project, merging into an existing entry', async () => {
    const request = await createProjectRequest(people.person, { name: 'acme-blog' });
    const merged = await insertReport(people.person, MONDAY, {
      entries: [
        { project: internal, minutes: 60, tasks: [task('Existing')] },
        { request, minutes: 120, tasks: [task('Blog outline')] },
      ],
    });
    const moved = await insertReport(people.person, TUESDAY, {
      entries: [{ request, minutes: 90, tasks: [task('Blog draft')] }],
    });
    expect(await reports.hasEntriesForProjectRequest(request.id)).toBe(true);
    const count = await db.transaction((trx) =>
      reports.moveProjectRequestEntries(
        { projectRequestId: request.id, projectId: internal.id },
        trx,
      ),
    );
    expect(count).toBe(2);
    expect(await reports.hasEntriesForProjectRequest(request.id)).toBe(false);
    const mergedEntries = await db('reportEntries').where({ reportId: merged.id });
    expect(mergedEntries).toEqual([
      expect.objectContaining({ projectId: internal.id, minutes: 180 }),
    ]);
    const tasks = await db('reportTasks')
      .where({ entryId: mergedEntries[0].id })
      .orderBy('sortOrder');
    expect(tasks.map((t) => t.title)).toEqual(['Existing', 'Blog outline']);
    expect(await db('reportEntries').where({ reportId: moved.id }).first()).toMatchObject({
      projectId: internal.id,
      projectRequestId: null,
      minutes: 90,
    });
  });

  it('lists reports and revisions for the owner and team viewers only', async () => {
    const { draft } = { draft: await reports.openForDate({ user }) };
    const entries = input([{ projectId: internal.id, hours: 8, tasks: [task('Backend')] }]);
    await reports.submitReport({ user, reportId: draft.id, entries });
    const page = await reports.listReports({ user, limit: 10, offset: 0 });
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({ id: draft.id, status: 'submitted', totalMinutes: 480 });
    const pm = sessionUser(people.pm);
    expect((await reports.listRevisions({ user: pm, reportId: draft.id }))[0]).toMatchObject({
      revision: 1,
      editedBy: { id: user.id, name: 'Vishal Saini' },
    });
    await expectCode(
      reports.getReport({ user: sessionUser(people.colleague), reportId: draft.id }),
      'FORBIDDEN',
    );
    await expectCode(
      reports.listReports({
        user: sessionUser(people.colleague),
        userId: user.id,
        limit: 10,
        offset: 0,
      }),
      'FORBIDDEN',
    );
  });
});
