// Dashboards: the Employee detailed view (numbers, calendar, stuck tasks, report history), the
// hours export and the dashboard query schemas.
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { xlsxResponse } from '@/lib/excel';
import { dayjs, localToUtc, setNowForTests } from '@/lib/time';
import { dashboard } from '@/modules/dashboard';
import { presentMinutesOf } from '@/modules/dashboard/history';
import {
  employeeDetailQuerySchema,
  hoursByProjectQuerySchema,
  hoursExportQuerySchema,
} from '@/modules/dashboard/schemas';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import {
  NOW,
  TODAY,
  TZ,
  checkIn,
  createEditRequest,
  createProject,
  createReport,
} from './dashboardKit.js';

const WORKING_DAYS = [1, 2, 3, 4, 5];
let pm;
let person;
let newcomer;
let alpha;
let beta;

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(NOW);
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  person = await createUser({
    name: 'Vera Saini',
    email: 'vera@example.com',
    designation: 'Frontend developer',
    reportsToId: pm.id,
    joinedOn: '2024-03-12',
  });
  newcomer = await createUser({ name: 'Noor', joinedOn: '2026-09-15' });
  alpha = await createProject(pm, { name: 'alpha', color: 'blue' });
  beta = await createProject(pm, { name: 'beta', color: 'orange' });

  await checkIn(person, '2026-09-21', { in: '09:30', out: '18:30' });
  await checkIn(person, '2026-09-24', {
    in: '09:40',
    out: '18:35',
    location: 'wfh',
    lateMinutes: 10,
  });
  await checkIn(person, '2026-09-25', { in: '09:31', out: '18:30', lateMinutes: 1 });
  await checkIn(person, '2026-09-26', { in: '11:00', out: '14:00', isWorkingDay: false });
  await checkIn(person, '2026-09-28', { in: '09:30', out: '18:40' });
  await checkIn(person, '2026-09-29', { in: '09:28', out: '18:31' });
  await checkIn(person, TODAY, { in: '09:32', out: '18:34' });

  const a = alpha.id;
  const old = await createReport(person, '2026-09-21', {
    entries: [
      {
        projectId: a,
        minutes: 480,
        tasks: [{ title: 'Old task', status: 'in_progress', firstReportedOn: '2026-09-14' }],
      },
    ],
  });
  await createReport(person, '2026-09-25', {
    revision: 2,
    reason: 'Added the payment task',
    editedBy: pm,
    entries: [
      { projectId: a, minutes: 480, tasks: [{ title: 'Payment settings page', status: 'done' }] },
    ],
  });
  await createReport(person, '2026-09-28', {
    entries: [
      {
        projectId: beta.id,
        minutes: 240,
        tasks: [{ title: 'Working on backend', status: 'in_progress' }],
      },
      { projectId: a, minutes: 240, tasks: [{ title: 'Review', status: 'done' }] },
    ],
  });
  await createReport(person, '2026-09-29', {
    status: 'draft',
    entries: [
      { projectId: a, minutes: 480, tasks: [{ title: 'Draft task', status: 'in_progress' }] },
    ],
  });
  await createReport(person, TODAY, {
    entries: [
      {
        projectId: a,
        minutes: 480,
        tasks: [
          { title: 'API for leave form', status: 'in_progress', firstReportedOn: '2026-09-23' },
          { title: 'Brand new', status: 'in_progress', firstReportedOn: '2026-09-29' },
          {
            title: 'Old task',
            status: 'done',
            firstReportedOn: '2026-09-14',
            carriedFromTaskId: old.taskIds[0],
          },
        ],
      },
    ],
  });
  await createEditRequest(person, '2026-09-25', {
    reason: 'Hours were 3, not 2',
    createdAt: new Date('2026-09-28T05:00:00Z'),
  });
  await createEditRequest(person, '2026-09-24', {
    reason: 'Add a task',
    status: 'declined',
    handledBy: pm.id,
    handledAt: new Date('2026-09-26T06:00:00Z'),
    declineReason: 'Already locked for payroll',
  });
  await createEditRequest(person, '2026-09-21', { status: 'approved', handledBy: pm.id });
});

describe('profile and numbers', () => {
  it('describes the person', async () => {
    const { person: profile } = await dashboard.getEmployeeDetail({ userId: person.id });
    expect(profile).toMatchObject({
      name: 'Vera Saini',
      subtitle: 'Frontend developer, reports to Pat Manager',
      joined: 'Joined 12 March 2024',
      shift: 'Shift 9:30 AM to 6:30 PM',
      initials: 'VS',
    });
  });

  it('counts the month: logged hours, average check-in on working days, late, WFH, reports', async () => {
    const { stats, period } = await dashboard.getEmployeeDetail({
      userId: person.id,
      range: 'month',
    });
    expect(period).toMatchObject({
      key: 'month',
      from: '2026-09-01',
      to: '2026-09-30',
      end: TODAY,
    });
    // (570 + 580 + 571 + 570 + 568 + 572) / 6 = 571.8 -> 9:32; Saturday's 11:00 is not a working day.
    expect(stats).toMatchObject({
      loggedMinutes: 1920,
      logged: '32h',
      loggedLabel: 'Logged in September',
      averageCheckIn: '9:32',
      lateDays: 2,
      wfhDays: 1,
      reportsSubmitted: 4,
      reportsExpected: 7,
    });
  });

  it('counts this week and a custom range', async () => {
    const week = await dashboard.getEmployeeDetail({ userId: person.id, range: 'week' });
    expect(week.period).toMatchObject({ from: '2026-09-28', to: '2026-10-04', end: TODAY });
    expect(week.stats).toMatchObject({
      loggedMinutes: 960,
      loggedLabel: 'Logged this week',
      averageCheckIn: '9:30',
      lateDays: 0,
      reportsSubmitted: 2,
      reportsExpected: 3,
    });
    const custom = await dashboard.getEmployeeDetail({
      userId: person.id,
      range: 'custom',
      from: '2026-09-24',
      to: '2026-09-26',
    });
    // (580 + 571) / 2 = 575.5 -> 9:36
    expect(custom.stats).toMatchObject({ averageCheckIn: '9:36', lateDays: 2, wfhDays: 1 });
    expect(custom.stats.loggedLabel).toBe('Logged 24\u00a0Sep to 26\u00a0Sep');
    expect(custom.exportHref).toBe(
      `/api/exports/hours?from=2026-09-24&to=2026-09-26&userId=${person.id}`,
    );
  });

  it('shows hours by project for the range', async () => {
    const { hours } = await dashboard.getEmployeeDetail({ userId: person.id });
    expect(hours.subtitle).toBe('September, 32h in total');
    expect(hours.bars.map((bar) => [bar.label, bar.display])).toEqual([
      ['alpha', '28h'],
      ['beta', '4h'],
    ]);
  });

  it("answers NOT_FOUND for someone who doesn't exist", async () => {
    await expect(dashboard.getEmployeeDetail({ userId: 999999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('attendance calendar', () => {
  it('tints each working day from its attendance row', async () => {
    const { calendar } = await dashboard.getEmployeeDetail({ userId: person.id });
    expect(calendar.title).toBe('Attendance, September');
    expect(calendar.weekdays).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    const tone = Object.fromEntries(calendar.weeks.flat().map((cell) => [cell.date, cell]));
    expect(calendar.weeks[0][0]).toEqual({ tone: 'empty' }); // Mon 31 Aug
    expect(tone['2026-09-01'].tone).toBe('missing');
    expect(tone['2026-09-21'].tone).toBe('office');
    expect(tone['2026-09-24'].tone).toBe('late'); // late wins over WFH
    expect(tone['2026-09-30']).toMatchObject({ tone: 'office', isToday: true });
    expect(tone['2026-10-01'].tone).toBe('future');
  });

  it('leaves days before someone joined neutral', async () => {
    const { calendar } = await dashboard.getEmployeeDetail({ userId: newcomer.id });
    const tone = Object.fromEntries(calendar.weeks.flat().map((cell) => [cell.date, cell.tone]));
    expect(tone['2026-09-14']).toBe('weekend');
    expect(tone['2026-09-15']).toBe('missing');
  });

  it("shows today among next month's days, not only the days after it", async () => {
    setNowForTests('2026-10-01T06:00:00Z');
    try {
      const { calendar } = await dashboard.getEmployeeDetail({
        userId: person.id,
        range: 'custom',
        from: '2026-09-01',
        to: '2026-09-30',
      });
      expect(calendar.title).toBe('Attendance, September');
      expect(calendar.weeks.at(-1).slice(3)).toEqual([
        { date: '2026-10-01', day: 1, tone: 'future', isToday: true },
        { date: '2026-10-02', day: 2, tone: 'future', isToday: false },
      ]);
    } finally {
      setNowForTests(NOW);
    }
  });
});

describe("someone who doesn't check in", () => {
  const tones = (calendar) => new Set(calendar.weeks.flat().map((cell) => cell.tone));

  it('gives a project manager a note instead of attendance numbers, calendar and missing days', async () => {
    const detail = await dashboard.getEmployeeDetail({ userId: pm.id });
    expect(detail.attendanceNote).toEqual({
      title: "Doesn't check in",
      body: "Project managers don't check in or write daily reports.",
    });
    expect(detail.person).toMatchObject({ tracksAttendance: false, shift: null });
    expect(detail.calendar.empty).toEqual({
      title: 'No attendance to show',
      body: "Project managers don't check in or write daily reports.",
    });
    expect(tones(detail.calendar).has('missing')).toBe(false);
    expect(detail.history).toEqual([]);
    expect(detail.historyEmptyText).toBe('No check-ins or reports in this range.');
    expect(detail.stats).toMatchObject({ reportsSubmitted: 0, reportsExpected: 0 });
  });

  it('still shows the hours and report days of someone with tracking off', async () => {
    const chief = await createUser({ name: 'Chief', role: 'admin', tracksAttendance: false });
    await createReport(chief, '2026-09-28', { entries: [{ projectId: beta.id, minutes: 90 }] });
    const detail = await dashboard.getEmployeeDetail({ userId: chief.id });
    expect(detail.attendanceNote.body).toBe("Their attendance isn't tracked.");
    expect(detail.hours.bars.map((bar) => [bar.label, bar.display])).toEqual([['beta', '1.5h']]);
    expect(detail.history.map((row) => [row.date, row.report, row.in])).toEqual([
      ['2026-09-28', 'submitted', '—'],
    ]);
    expect(tones(detail.calendar).has('missing')).toBe(false);
    expect(detail.calendar.empty).not.toBeNull();
  });

  it('keeps check-ins from before tracking was turned off on the calendar', async () => {
    const former = await createUser({ name: 'Former', tracksAttendance: false });
    await checkIn(former, '2026-09-21', { in: '09:30', out: '18:30' });
    const detail = await dashboard.getEmployeeDetail({ userId: former.id });
    expect(detail.calendar.empty).toBeNull();
    const tone = Object.fromEntries(
      detail.calendar.weeks.flat().map((cell) => [cell.date, cell.tone]),
    );
    expect(tone['2026-09-21']).toBe('office');
    expect(tone['2026-09-22']).toBe('weekend');
    expect(tones(detail.calendar).has('missing')).toBe(false);
  });

  it('has no note for someone who checks in', async () => {
    const detail = await dashboard.getEmployeeDetail({ userId: person.id });
    expect(detail.attendanceNote).toBeNull();
    expect(detail.calendar.empty).toBeNull();
    expect(detail.historyEmptyText).toBe('No working days in this range yet.');
  });
});

describe('tasks to watch (section 7.5)', () => {
  it('flags in-progress tasks after the stuck threshold of working days', () => {
    expect(dashboard.isStuckTask('2026-09-23', TODAY, WORKING_DAYS, 5)).toBe(true);
    expect(dashboard.isStuckTask('2026-09-24', TODAY, WORKING_DAYS, 5)).toBe(false);
    expect(dashboard.daysInProgress('2026-09-23', TODAY, WORKING_DAYS)).toBe(6);
  });

  it('lists the latest version of submitted in-progress tasks, stuck ones flagged', async () => {
    const { tasks } = await dashboard.getEmployeeDetail({ userId: person.id });
    expect(tasks.subtitle).toBe('In progress for 5 days or more are flagged');
    expect(tasks.items.map((t) => [t.title, t.label, t.stuck, t.project.name])).toEqual([
      ['API for leave form', 'In progress 6 days', true, 'alpha'],
      ['Working on backend', 'In progress 3 days', false, 'beta'],
    ]);
    expect(tasks.stuckCount).toBe(1);
  });

  it('uses the stuck_task_days setting', async () => {
    await setSettings({ stuck_task_days: 2 });
    try {
      const { tasks } = await dashboard.getEmployeeDetail({ userId: person.id });
      expect(tasks.subtitle).toBe('In progress for 2 days or more are flagged');
      expect(tasks.items.map((t) => t.stuck)).toEqual([true, true]);
    } finally {
      await setSettings({ stuck_task_days: 5 });
    }
  });
});

describe('report history', () => {
  it('has one row per working day (and days with a check-in), newest first', async () => {
    const { history } = await dashboard.getEmployeeDetail({ userId: person.id });
    expect(history[0].date).toBe(TODAY);
    expect(history.some((row) => row.date === '2026-09-26')).toBe(true); // Saturday check-in
    expect(history.some((row) => row.date === '2026-09-27')).toBe(false); // plain Sunday
    const byDate = Object.fromEntries(history.map((row) => [row.date, row]));
    expect(byDate[TODAY]).toMatchObject({
      where: 'office',
      in: '9:32',
      out: '6:34',
      present: '9h 2m',
      logged: '8h',
      report: 'submitted',
    });
    expect(byDate['2026-09-29']).toMatchObject({
      report: 'missing',
      reportStatus: 'draft',
      logged: '0h',
    });
    expect(byDate['2026-09-24']).toMatchObject({ where: 'wfh', report: 'missing' });
    expect(byDate['2026-09-23']).toMatchObject({
      where: null,
      present: '—',
      report: 'not_checked_in',
    });
  });

  it("opens a day's tasks and its edit history", async () => {
    const { history } = await dashboard.getEmployeeDetail({ userId: person.id });
    const day = history.find((row) => row.date === '2026-09-25');
    expect(day.report).toBe('edited');
    expect(day.entries[0].tasks.map((t) => t.title)).toEqual(['Payment settings page']);
    expect(day.revisions.map((r) => [r.label, r.by, r.reason])).toEqual([
      ['Submitted', 'Vera Saini', null],
      ['Edited', 'Pat Manager', 'Added the payment task'],
    ]);
    expect(day.revisions[1].when).toBe('Fri, 25 Sep, 6:40 PM');
  });

  it('lists edit requests still waiting or declined in the edit history', async () => {
    const { history } = await dashboard.getEmployeeDetail({ userId: person.id });
    const byDate = Object.fromEntries(history.map((row) => [row.date, row]));
    expect(byDate['2026-09-25'].requests).toMatchObject([
      {
        status: 'pending',
        label: 'Edit requested',
        by: 'Vera Saini',
        when: 'Mon, 28 Sep, 10:30 AM',
        reason: 'Hours were 3, not 2',
        declineReason: null,
      },
    ]);
    expect(byDate['2026-09-24'].requests).toMatchObject([
      {
        label: 'Edit declined',
        by: 'Pat Manager',
        when: 'Sat, 26 Sep, 11:30 AM',
        declineReason: 'Already locked for payroll',
      },
    ]);
    expect(byDate['2026-09-21'].requests).toEqual([]);
  });

  it('skips days before someone joined', async () => {
    const { history } = await dashboard.getEmployeeDetail({ userId: newcomer.id });
    expect(history).toHaveLength(12); // working days 15 to 30 September
    expect(history.every((row) => row.report === 'not_checked_in')).toBe(true);
  });

  it('counts present time to check-out, or to now while still checked in today', () => {
    const at = (clock) => localToUtc(TODAY, clock, TZ).toDate();
    const ctx = { today: TODAY, now: dayjs.utc(NOW) };
    expect(
      presentMinutesOf({ workDate: TODAY, checkInAt: at('09:32'), checkOutAt: at('18:34') }, ctx),
    ).toBe(542);
    expect(
      presentMinutesOf({ workDate: TODAY, checkInAt: at('10:08'), checkOutAt: null }, ctx),
    ).toBe(524);
    expect(
      presentMinutesOf({ workDate: '2026-09-29', checkInAt: at('10:08'), checkOutAt: null }, ctx),
    ).toBeNull();
  });
});

describe('hours export', () => {
  it('returns an xlsx with every entry and a summary of submitted hours', async () => {
    const workbook = await dashboard.buildHoursExport({
      from: '2026-09-24',
      to: TODAY,
      userId: person.id,
    });
    expect(workbook.filename).toBe('daybook-hours-vera-saini-2026-09-24-to-2026-09-30.xlsx');
    const [hours, summary] = workbook.sheets;
    expect(hours.columns.map((c) => c.header)).toEqual([
      'Date',
      'Person',
      'Department',
      'Project',
      'Hours',
      'Tasks',
      'Report status',
    ]);
    expect(hours.rows.map((r) => [r.workDate, r.project, r.hours, r.status])).toEqual([
      ['2026-09-24', '', 0, 'Missing'],
      ['2026-09-25', 'alpha', 8, 'Edited'],
      ['2026-09-26', '', 0, 'Missing'],
      ['2026-09-28', 'beta', 4, 'Submitted'],
      ['2026-09-28', 'alpha', 4, 'Submitted'],
      ['2026-09-29', 'alpha', 8, 'Draft'],
      ['2026-09-30', 'alpha', 8, 'Submitted'],
    ]);
    expect(hours.rows.at(-1).tasks).toBe(
      'API for leave form (In progress); Brand new (In progress); Old task (Done)',
    );
    expect(summary.rows.map((r) => [r.project, r.hours])).toEqual([
      ['alpha', 20],
      ['beta', 4],
    ]);

    const response = await xlsxResponse(workbook);
    expect(response.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['Hours', 'Summary']);
    expect(book.getWorksheet('Hours').rowCount).toBe(8);
  });

  it('defaults to this week for everyone, and rejects an unknown person', async () => {
    const workbook = await dashboard.buildHoursExport();
    expect(workbook.filename).toBe('daybook-hours-2026-09-28-to-2026-09-30.xlsx');
    await expect(dashboard.buildHoursExport({ userId: 999999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('query schemas', () => {
  it('checks the export range', () => {
    expect(hoursExportQuerySchema.safeParse({ from: '2026-09-01' }).success).toBe(false);
    const backwards = hoursExportQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' });
    expect(backwards.error.issues[0].message).toBe(
      'The start date must be on or before the end date.',
    );
    const long = hoursExportQuerySchema.safeParse({ from: '2025-01-01', to: '2026-09-30' });
    expect(long.error.issues[0].message).toBe('Pick a range of 366 days or fewer.');
    expect(hoursExportQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(
      false,
    );
    expect(hoursExportQuerySchema.parse({ userId: '7' })).toEqual({ userId: 7 });
  });

  it('caps list limits at 100 and needs dates for a custom range', () => {
    expect(
      hoursByProjectQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-30', limit: '101' })
        .success,
    ).toBe(false);
    expect(employeeDetailQuerySchema.safeParse({ range: 'custom' }).success).toBe(false);
    expect(employeeDetailQuerySchema.parse({})).toEqual({ range: 'month' });
  });
});
