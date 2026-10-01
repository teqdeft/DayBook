// My log (build guide section 8): the month read model (reports.getMonthLog), its Excel sheet and
// the page's row shaping (logView.js).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { resetDatabase, setSettings } from '../helpers/db.js';
import {
  dayRows,
  editRequestItems,
  kpiCards,
  momentText,
  sentText,
} from '../../src/app/(app)/log/logView.js';
import {
  clearTables,
  createPeople,
  createProject,
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

// Wednesday 30 September 2026, 4:30 PM in Asia/Kolkata.
const WEDNESDAY_AFTERNOON = '2026-09-30T11:00:00Z';
const TZ = 'Asia/Kolkata';

let people;
let user;
let internal;
let store;

function checkIn(person, day, clock, extra = {}) {
  return db('attendance').insert({
    userId: person.id,
    workDate: day,
    checkInAt: new Date(`${day}T${clock}:00Z`),
    checkOutAt: new Date(`${day}T13:04:00Z`),
    location: 'office',
    officeVerified: true,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: 'checked_out',
    source: 'self',
    ...extra,
  });
}

beforeAll(async () => {
  await resetDatabase();
  await setSettings({ slack_post_reports: false });
  people = await createPeople();
  user = { ...sessionUser(people.person), joinedOn: '2026-09-21', tracksAttendance: true };
  internal = await createProject(people.pm, { name: 'internal-tool', color: 'blue' });
  store = await createProject(people.pm, { name: 'acme-store', color: 'green' });
});

beforeEach(async () => {
  await clearTables('report_revisions', 'report_edit_requests', 'notifications', 'attendance');
  await clearTables('report_tasks', 'report_entries', 'daily_reports');
  setNowForTests(WEDNESDAY_AFTERNOON);
});

describe('the month', () => {
  it('shows a later month as this month and an earlier one without a next link past today', async () => {
    const later = await reports.getMonthLog({ user, month: '2026-11' });
    expect(later.month).toBe('2026-09');
    expect(later.nextMonth).toBeNull();
    const earlier = await reports.getMonthLog({ user, month: '2026-08' });
    expect(earlier.month).toBe('2026-08');
    expect(earlier.nextMonth).toBe('2026-09');
    expect(earlier.days).toEqual([]); // joined on 21 September
    expect(earlier.kpis.workingDays).toBe(0);
  });

  it('gives each day its lock time, also days without a report', async () => {
    const log = await reports.getMonthLog({ user, month: '2026-09' });
    const byDate = Object.fromEntries(log.days.map((day) => [day.date, day]));
    expect(new Date(byDate['2026-09-30'].locksAt).toISOString()).toBe('2026-10-01T06:30:00.000Z');
    expect(new Date(byDate['2026-09-29'].locksAt).toISOString()).toBe('2026-09-30T06:30:00.000Z');
    expect(byDate['2026-09-29'].canRequestEdit).toBe(true);
    expect(byDate['2026-09-30'].canRequestEdit).toBe(false);
  });

  it('marks a draft that passed its lock as missing and a checked-in day without a report too', async () => {
    await checkIn(people.person, '2026-09-28', '04:00');
    await checkIn(people.person, '2026-09-29', '04:00');
    await insertReport(people.person, '2026-09-28', {
      status: 'draft',
      entries: [{ project: internal, minutes: 120, tasks: [{ title: 'Half', status: 'done' }] }],
    });
    const log = await reports.getMonthLog({ user, month: '2026-09' });
    const status = Object.fromEntries(log.days.map((day) => [day.date, day.status]));
    expect(status['2026-09-28']).toBe('missing');
    expect(status['2026-09-29']).toBe('missing');
    expect(status['2026-09-30']).toBe('not_checked_in');
    expect(log.kpis.reportsSubmitted).toBe(0);
    expect(log.kpis.reportsExpected).toBe(2);
  });

  it('never says "not checked in" to someone who does not track attendance', async () => {
    const untracked = { ...user, tracksAttendance: false };
    await insertReport(people.person, '2026-09-29', {
      entries: [{ project: internal, minutes: 60, tasks: [{ title: 'Review', status: 'done' }] }],
    });
    const log = await reports.getMonthLog({ user: untracked, month: '2026-09' });
    const status = Object.fromEntries(log.days.map((day) => [day.date, day.status]));
    expect(status['2026-09-30']).toBe('not_started');
    expect(status['2026-09-29']).toBe('locked');
    expect(status['2026-09-28']).toBe('missing');
    expect(log.attendance.notCheckedIn).toBe(0);
  });

  it('builds the Excel workbook with a days sheet and a tasks sheet', async () => {
    await checkIn(people.person, '2026-09-29', '04:02', { lateMinutes: 2, location: 'wfh' });
    await insertReport(people.person, '2026-09-29', {
      entries: [
        {
          project: internal,
          minutes: 360,
          tasks: [
            { title: 'Backend', status: 'in_progress' },
            { title: 'Review', status: 'done' },
          ],
        },
        { project: store, minutes: 150, tasks: [{ title: 'Checkout', status: 'blocked' }] },
      ],
    });
    const book = reports.monthLogWorkbook(await reports.getMonthLog({ user, month: '2026-09' }));
    expect(book.filename).toBe('daybook-my-log-2026-09.xlsx');
    const [days, tasks] = book.sheets;
    const tuesday = days.rows.find((row) => row.date === '2026-09-29');
    expect(tuesday).toMatchObject({
      day: 'Tue, 29 Sep',
      where: 'WFH',
      checkIn: '09:32',
      checkOut: '18:34',
      lateMinutes: 2,
      logged: 8.5,
      projects: 'internal-tool, acme-store',
      report: 'Locked',
    });
    expect(tasks.rows.map((row) => [row.project, row.hours, row.task, row.status])).toEqual([
      ['internal-tool', 6, 'Backend', 'In progress'],
      ['internal-tool', '', 'Review', 'Done'],
      ['acme-store', 2.5, 'Checkout', 'Blocked'],
    ]);
  });
});

describe('the page rows', () => {
  it('writes lock and sent times relative to today', () => {
    const today = '2026-09-30';
    expect(momentText(new Date('2026-10-01T06:30:00Z'), TZ, today)).toBe('12:00 tomorrow');
    expect(momentText(new Date('2026-09-30T06:30:00Z'), TZ, today)).toBe('12:00 today');
    expect(momentText(new Date('2026-09-26T06:30:00Z'), TZ, today)).toBe('12:00 on Sat, 26 Sep');
    expect(sentText(new Date('2026-09-30T04:18:00Z'), TZ, today)).toBe('today at 9:48');
    expect(sentText(new Date('2026-09-29T09:00:00Z'), TZ, today)).toBe('yesterday at 2:30');
  });

  it('shapes rows, numbers and requests as the artboard shows them', async () => {
    await checkIn(people.person, '2026-09-30', '04:02');
    await checkIn(people.person, '2026-09-29', '03:58', { location: 'wfh' });
    await insertReport(people.person, '2026-09-30', {
      entries: [
        { project: store, minutes: 120, tasks: [{ title: 'Content changes', status: 'done' }] },
        { project: internal, minutes: 360, tasks: [{ title: 'Backend', status: 'in_progress' }] },
      ],
    });
    await insertReport(people.person, '2026-09-29', {
      entries: [{ project: internal, minutes: 510, tasks: [{ title: 'Backend', status: 'done' }] }],
    });
    await reports.requestEdit({
      user: sessionUser(people.person),
      workDate: '2026-09-29',
      reason: 'Hours were 9',
    });
    const log = await reports.getMonthLog({ user, month: '2026-09' });
    const [today, tuesday, monday] = dayRows(log);
    expect(today).toMatchObject({
      dateLabel: 'Wed, 30 Sep',
      isToday: true,
      times: '9:32 to 6:34',
      present: '9h 2m',
      logged: '8h',
      status: 'submitted',
      label: 'Submitted',
      note: 'You can edit this report until 12:00 tomorrow.',
      action: { kind: 'link', href: '/report', label: 'Edit report' },
    });
    expect(today.projects.map((project) => project.name)).toEqual(['acme-store', 'internal-tool']);
    expect(today.tasks.map((task) => [task.project?.name, task.title, task.hours])).toEqual([
      ['acme-store', 'Content changes', '2h'],
      ['internal-tool', 'Backend', '6h'],
    ]);
    expect(tuesday).toMatchObject({
      wfh: true,
      logged: '8.5h',
      status: 'edit_requested',
      label: 'Edit requested',
      action: null,
    });
    expect(tuesday.note).toContain('You asked to edit this report today at 4:30.');
    expect(monday).toMatchObject({
      times: null,
      present: null,
      logged: null,
      status: 'not_checked_in',
      action: { kind: 'request', label: 'Request an edit' },
    });
    const cards = kpiCards(log);
    expect(cards.map((card) => [card.label, card.value, card.sub])).toEqual([
      ['Hours logged', '17h', 'this month'], // 16.5h in whole hours, like the other cards
      ['Days present', '2', 'of 8 working days'],
      ['Late days', '0', 'on time every day'],
      ['Reports submitted', '2', 'of 2 so far'],
    ]);
    expect(editRequestItems(log)).toEqual([
      expect.objectContaining({
        title: 'Report for Tue, 29 Sep',
        reason: 'Hours were 9',
        status: 'pending',
        when: 'Sent today at 4:30',
      }),
    ]);
  });
});
