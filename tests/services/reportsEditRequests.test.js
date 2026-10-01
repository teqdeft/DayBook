import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { declineEditRequestSchema, saveReportSchema } from '@/modules/reports/schemas';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import {
  clearTables,
  createPeople,
  createProject,
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

const FRIDAY = '2026-09-25';
// Wednesday 30 September 2026, 9:48 AM in Asia/Kolkata: Friday's report locked on Saturday noon.
const WEDNESDAY_MORNING = '2026-09-30T04:18:00Z';

let people;
let user;
let pm;
let otherPm;
let admin;
let internal;

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

function input(entries) {
  return saveReportSchema.parse({ entries }).entries;
}

async function lockedFridayReport() {
  return insertReport(people.person, FRIDAY, {
    entries: [
      { project: internal, minutes: 480, tasks: [{ title: 'Store work', status: 'done' }] },
    ],
  });
}

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  user = sessionUser(people.person);
  pm = sessionUser(people.pm);
  otherPm = sessionUser(people.otherPm);
  admin = sessionUser(people.admin);
  internal = await createProject(people.pm, { name: 'internal-tool' });
});

beforeEach(async () => {
  await clearTables('report_revisions', 'report_edit_requests', 'slack_outbox', 'notifications');
  await clearTables('audit_logs', 'report_tasks', 'report_entries', 'daily_reports');
  setNowForTests(WEDNESDAY_MORNING);
});

describe('asking to edit a report', () => {
  it('only works once the report is locked', async () => {
    setNowForTests('2026-09-29T04:00:00Z');
    await reports.openForDate({ user }); // Tuesday's draft, open until Wednesday noon
    await expectCode(
      reports.requestEdit({ user, workDate: '2026-09-29', reason: 'Wrong hours' }),
      'REPORT_NOT_LOCKED',
    );
    // A missing day before its lock can still be written, so no request is needed.
    await expectCode(
      reports.requestEdit({ user, workDate: '2026-09-28', reason: 'Forgot it' }),
      'REPORT_NOT_LOCKED',
    );
    await expectCode(
      reports.requestEdit({ user, workDate: '2026-09-30', reason: 'Future' }),
      'REPORT_IN_FUTURE',
    );
  });

  it('notifies the PM in the app and by Slack DM, and allows one pending request per day', async () => {
    const report = await lockedFridayReport();
    const request = await reports.requestEdit({
      user,
      workDate: FRIDAY,
      reason: 'Hours for acme-store were 3, not 2.',
    });
    expect(request).toMatchObject({
      reportId: report.id,
      workDate: FRIDAY,
      status: 'pending',
      requester: { id: user.id, name: 'Vishal Saini', initials: 'VS' },
    });
    const notes = await db('notifications').orderBy('id');
    expect(notes.map((n) => [n.userId, n.type, n.title, n.link])).toEqual([
      [
        pm.id,
        'report_edit.requested',
        'Vishal Saini wants to edit the report for Fri, 25 Sep',
        '/requests',
      ],
      [user.id, 'report_edit.sent', 'Edit request sent for Fri, 25 Sep', '/log'],
    ]);
    const dms = await outboxRows();
    expect(dms).toEqual([expect.objectContaining({ kind: 'dm', channel: 'UPM1' })]);
    expect(dms[0].payload.text).toBe(
      'Vishal Saini wants to edit the report for Fri, 25 Sep: "Hours for acme-store were 3, not 2." ' +
        '<http://localhost:3000/requests|Open requests>',
    );
    await expectCode(
      reports.requestEdit({ user, workDate: FRIDAY, reason: 'Again' }),
      'REQUEST_ALREADY_PENDING',
    );
    const view = await reports.openForDate({ user, workDate: FRIDAY });
    expect(view.pendingEditRequest).toMatchObject({ id: request.id, reason: expect.any(String) });
  });

  it('refuses a day before the person joined', async () => {
    await expect(
      reports.requestEdit({
        user: { ...user, joinedOn: '2026-09-28' },
        workDate: FRIDAY,
        reason: 'Wrong hours',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { workDate: expect.any(String) },
    });
    expect(await db('reportEditRequests')).toHaveLength(0);
  });

  it('keeps one pending request when the same request is sent twice at once', async () => {
    await lockedFridayReport();
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => reports.requestEdit({ user, workDate: FRIDAY, reason: 'Wrong hours' })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results.filter((item) => item.status === 'rejected')) {
      expect(result.reason).toMatchObject({ code: 'REQUEST_ALREADY_PENDING' });
    }
    const rows = await db('reportEditRequests').where({ workDate: FRIDAY, status: 'pending' });
    expect(rows).toHaveLength(1);
    // Only the saved request notified anyone.
    expect(await db('notifications').where({ type: 'report_edit.requested' })).toHaveLength(1);
  });

  it('sends requests of people without a PM to every Admin', async () => {
    await db('users').where({ id: user.id }).update({ reportsToId: null });
    try {
      await lockedFridayReport();
      await reports.requestEdit({ user, workDate: FRIDAY, reason: 'Wrong hours' });
      const notes = await db('notifications').where({ type: 'report_edit.requested' });
      expect(notes.map((n) => n.userId)).toEqual([admin.id]);
    } finally {
      await db('users').where({ id: user.id }).update({ reportsToId: pm.id });
    }
  });
});

describe('approving and declining', () => {
  it('lets only the PM the person reports to (or an Admin) handle it', async () => {
    await lockedFridayReport();
    const request = await reports.requestEdit({ user, workDate: FRIDAY, reason: 'Wrong hours' });
    expect(await reports.listPendingEditRequestsFor(pm)).toHaveLength(1);
    expect(await reports.listPendingEditRequestsFor(otherPm)).toEqual([]);
    expect(await reports.listPendingEditRequestsFor(admin)).toHaveLength(1);
    expect(await reports.listPendingEditRequestsFor(user)).toEqual([]);
    expect(await reports.countPendingEditRequestsFor(pm)).toBe(1);
    expect(await reports.countPendingEditRequestsFor(otherPm)).toBe(0);

    await expectCode(
      reports.approveEditRequest({ user: otherPm, requestId: request.id }),
      'FORBIDDEN',
    );
    await expectCode(
      reports.declineEditRequest({ user: otherPm, requestId: request.id, reason: 'No' }),
      'FORBIDDEN',
    );
    const approved = await reports.approveEditRequest({ user: admin, requestId: request.id });
    expect(approved).toMatchObject({ status: 'approved', handledBy: { id: admin.id } });
    await expectCode(
      reports.approveEditRequest({ user: pm, requestId: request.id }),
      'REQUEST_ALREADY_HANDLED',
    );
  });

  it('never lets someone handle their own request, not even an Admin who tracks time', async () => {
    const trackedAdmin = sessionUser(
      await createUser({ name: 'Meera Admin', role: 'admin', tracksAttendance: true }),
    );
    await insertReport(trackedAdmin, FRIDAY, {
      entries: [{ project: internal, minutes: 60, tasks: [{ title: 'Budget', status: 'done' }] }],
    });
    const request = await reports.requestEdit({
      user: trackedAdmin,
      workDate: FRIDAY,
      reason: 'Missed a task',
    });
    expect(await reports.listPendingEditRequestsFor(trackedAdmin)).toEqual([]);
    expect((await reports.listPendingEditRequestsFor(admin)).map((r) => r.id)).toEqual([
      request.id,
    ]);
    await expectCode(
      reports.approveEditRequest({ user: trackedAdmin, requestId: request.id }),
      'FORBIDDEN',
    );
    const approved = await reports.approveEditRequest({ user: admin, requestId: request.id });
    expect(approved.status).toBe('approved');
  });

  it('opens the report for 24 hours; the next submit clears it and locks it again', async () => {
    const report = await lockedFridayReport();
    await expectCode(
      reports.saveReport({ user, reportId: report.id, entries: [] }),
      'REPORT_LOCKED',
    );
    const request = await reports.requestEdit({ user, workDate: FRIDAY, reason: 'Wrong hours' });
    await reports.approveEditRequest({ user: pm, requestId: request.id, ip: '10.0.0.1' });

    const row = await db('dailyReports').where({ id: report.id }).first();
    expect(row.unlockedUntil.toISOString()).toBe('2026-10-01T04:18:00.000Z');
    const note = await db('notifications')
      .where({ userId: user.id, type: 'report_edit.approved' })
      .first();
    expect(note).toMatchObject({
      title: 'Your edit request for Fri, 25 Sep was approved',
      body: 'You can change the report until 9:48 AM on Thu, 1 Oct.',
      link: `/report?date=${FRIDAY}`,
    });
    expect(
      await db('auditLogs').where({ action: 'report_edit.approve' }).count({ n: '*' }).first(),
    ).toEqual({
      n: 1,
    });

    const view = await reports.openForDate({ user, workDate: FRIDAY });
    expect(view).toMatchObject({ editable: true, pendingEditRequest: null });
    const entries = entriesFrom(view);
    entries[0].hours = 9;
    setNowForTests('2026-09-30T06:00:00Z');
    const submitted = await reports.submitReport({
      user,
      reportId: report.id,
      entries: input(entries),
    });
    expect(submitted).toMatchObject({
      revision: 2,
      totalMinutes: 540,
      unlockedUntil: null,
      editable: false,
    });
    const revision = await db('reportRevisions')
      .where({ reportId: report.id, revision: 2 })
      .first();
    expect(revision.reason).toBe('Wrong hours');
    await expectCode(
      reports.saveReport({ user, reportId: report.id, entries: input(entries) }),
      'REPORT_LOCKED',
    );
  });

  it('closes again after 24 hours without a submit', async () => {
    const report = await lockedFridayReport();
    const request = await reports.requestEdit({ user, workDate: FRIDAY, reason: 'Wrong hours' });
    await reports.approveEditRequest({ user: pm, requestId: request.id });
    setNowForTests('2026-10-01T04:18:00Z');
    await expectCode(
      reports.saveReport({ user, reportId: report.id, entries: [] }),
      'REPORT_LOCKED',
    );
  });

  it('adds a forgotten day only through an approved request', async () => {
    const missing = await reports.openForDate({ user, workDate: FRIDAY });
    expect(missing).toMatchObject({ id: null, editable: false });
    const request = await reports.requestEdit({
      user,
      workDate: FRIDAY,
      reason: 'I forgot Friday',
    });
    expect(request.reportId).toBeNull();
    await reports.approveEditRequest({ user: pm, requestId: request.id });

    const created = await reports.openForDate({ user, workDate: FRIDAY });
    expect(created).toMatchObject({ workDate: FRIDAY, status: 'draft', editable: true });
    expect(created.id).toEqual(expect.any(Number));
    const handled = await db('reportEditRequests').where({ id: request.id }).first();
    expect(handled.reportId).toBe(created.id);
    const submitted = await reports.submitReport({
      user,
      reportId: created.id,
      entries: input([
        { projectId: internal.id, hours: 8, tasks: [{ title: 'Backend', status: 'done' }] },
      ]),
    });
    expect(submitted).toMatchObject({ status: 'submitted', revision: 1, editable: false });
  });

  it('declines with a reason and tells the person', async () => {
    await lockedFridayReport();
    const request = await reports.requestEdit({ user, workDate: FRIDAY, reason: 'Wrong hours' });
    expect(declineEditRequestSchema.safeParse({ reason: ' ' }).success).toBe(false);
    const declined = await reports.declineEditRequest({
      user: pm,
      requestId: request.id,
      reason: "Those hours are already in the next day's report.",
    });
    expect(declined).toMatchObject({
      status: 'declined',
      declineReason: "Those hours are already in the next day's report.",
    });
    const note = await db('notifications')
      .where({ userId: user.id, type: 'report_edit.declined' })
      .first();
    expect(note).toMatchObject({
      title: 'Your edit request for Fri, 25 Sep was declined',
      link: '/log',
    });
    const handled = await reports.listHandledEditRequestsFor(pm, { limit: 10 });
    expect(handled).toEqual([expect.objectContaining({ id: request.id, status: 'declined' })]);
    // Declined: the report stays locked, and the person may ask again.
    await reports.requestEdit({ user, workDate: FRIDAY, reason: 'Second try' });
  });

  it('sends no Slack DM when request messages are off, but still notifies', async () => {
    await setSettings({ slack_requests_notify: false });
    try {
      await lockedFridayReport();
      const request = await reports.requestEdit({ user, workDate: FRIDAY, reason: 'Wrong hours' });
      await reports.approveEditRequest({ user: pm, requestId: request.id });
      expect(await outboxRows()).toEqual([]);
      expect(await db('notifications').count({ n: '*' }).first()).toEqual({ n: 3 });
    } finally {
      await setSettings({ slack_requests_notify: true });
    }
  });
});

describe('My log', () => {
  it('shows each day with its report status and the month numbers', async () => {
    await setSettings({ slack_post_reports: false });
    await clearTables('attendance');
    const checkIn = (day, clock, extra = {}) =>
      db('attendance').insert({
        userId: user.id,
        workDate: day,
        checkInAt: new Date(`${day}T${clock}:00Z`),
        checkOutAt: new Date(`${day}T13:00:00Z`),
        location: 'office',
        officeVerified: true,
        lateMinutes: 0,
        isWorkingDay: true,
        checkoutStatus: 'checked_out',
        source: 'self',
        ...extra,
      });
    await checkIn('2026-09-28', '04:00');
    await checkIn('2026-09-29', '04:12', { lateMinutes: 12, location: 'wfh' });
    await checkIn('2026-09-30', '04:02', { checkOutAt: null, checkoutStatus: 'open' });
    await insertReport(people.person, '2026-09-28', {
      entries: [{ project: internal, minutes: 480, tasks: [{ title: 'A', status: 'done' }] }],
    });
    await insertReport(people.person, '2026-09-29', {
      entries: [{ project: internal, minutes: 450, tasks: [{ title: 'B', status: 'done' }] }],
    });
    await reports.requestEdit({ user, workDate: '2026-09-28', reason: 'Wrong hours' });

    const log = await reports.getMonthLog({
      user: { ...user, joinedOn: '2026-09-24' },
      month: '2026-09',
    });
    expect(log.days.map((d) => [d.date, d.status])).toEqual([
      ['2026-09-30', 'not_started'],
      ['2026-09-29', 'submitted'],
      ['2026-09-28', 'edit_requested'],
      ['2026-09-25', 'not_checked_in'],
      ['2026-09-24', 'not_checked_in'],
    ]);
    expect(log.kpis).toMatchObject({
      loggedMinutes: 930,
      daysPresent: 3,
      workingDays: 5,
      lateDays: 1,
      lateAverageMinutes: 12,
      reportsSubmitted: 2,
      reportsExpected: 2,
    });
    expect(log.attendance).toEqual({ office: 2, wfh: 1, late: 1, notCheckedIn: 2 });
    expect(log.hoursByProject).toEqual([
      { projectId: internal.id, name: 'internal-tool', color: 'blue', minutes: 930 },
    ]);
    expect(log.editRequests).toHaveLength(1);
    expect(log.requestableDays).toEqual(['2026-09-25', '2026-09-24']);
    expect(log.days[1].editableUntil.toISOString()).toBe('2026-09-30T06:30:00.000Z');
    expect(log.nextMonth).toBeNull();
    expect(log.lockText).toBe('Reports lock at 12:00 the next day');
    await setSettings({ slack_post_reports: true });
  });
});
