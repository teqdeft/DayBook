// Dashboards: the section 7.10 numbers on one seeded day (Team dashboard, Company overview),
// hours by project, urgent projects and the sidebar badges.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { localToUtc, setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { dashboard } from '@/modules/dashboard';
import { hoursBars } from '@/modules/dashboard/shared';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import {
  NOW,
  TODAY,
  TZ,
  addMembers,
  checkIn,
  createCorrection,
  createEditRequest,
  createProject,
  createProjectRequest,
  createReport,
} from './dashboardKit.js';

const people = {};
const projects = {};

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(NOW);

  const staff = (name, extra = {}) => createUser({ name, tracksAttendance: true, ...extra });
  people.pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  people.pm2 = await createUser({ name: 'Paula Lead', role: 'pm', tracksAttendance: false });
  people.admin = await createUser({
    name: 'Chief',
    role: 'admin',
    tracksAttendance: false,
    department: 'Leadership',
  });
  people.hr = await createUser({
    name: 'Hana',
    role: 'hr',
    tracksAttendance: false,
    department: 'HR',
  });
  people.e1 = await staff('Ava', { reportsToId: people.pm.id });
  people.e2 = await staff('Ben', { reportsToId: people.pm.id });
  people.e3 = await staff('Cara', { reportsToId: people.pm2.id, department: 'SEO' });
  people.e4 = await staff('Dev', { reportsToId: people.pm.id, department: 'SEO' });
  people.e5 = await staff('Eli', { department: 'Sales' });
  people.e6 = await staff('Finn', { department: 'Sales', joinedOn: '2026-09-29' });
  people.untracked = await createUser({
    name: 'Uma',
    tracksAttendance: false,
    department: 'Delivery',
  });
  people.gone = await staff('Zed', { status: 'deactivated' });

  projects.a = await createProject(people.pm, {
    name: 'alpha',
    color: 'blue',
    isUrgent: true,
    urgentNote: 'Homepage live today',
    urgentMarkedAt: new Date('2026-09-30T05:35:00Z'), // 11:05 in Kolkata
    urgentMarkedBy: people.pm.id,
  });
  projects.b = await createProject(people.pm2, { name: 'beta', color: 'green' });
  projects.done = await createProject(people.pm, {
    name: 'gamma',
    status: 'completed',
    isUrgent: true,
    urgentNote: 'Old note',
  });
  projects.hold = await createProject(people.pm, { name: 'delta', status: 'on_hold' });
  await addMembers(projects.a, [people.e1, people.e2, people.gone]);
  projects.request = await createProjectRequest(people.e5, { name: 'New site' });
  await createProjectRequest(people.e5, { name: 'Old idea', status: 'declined' });

  // Today: three in the office (one late 38, one late 29), two at home (one late 11), one absent.
  const { e1, e2, e3, e4, e5, e6 } = people;
  await checkIn(e1, TODAY, { in: '09:28', out: '18:34' });
  await checkIn(e2, TODAY, { in: '10:08', lateMinutes: 38 });
  await checkIn(e3, TODAY, { in: '09:41', out: '18:45', location: 'wfh', lateMinutes: 11 });
  await checkIn(e4, TODAY, { in: '09:20', location: 'wfh' });
  await checkIn(e5, TODAY, { in: '09:59', lateMinutes: 29, officeVerified: false });
  await checkIn(people.untracked, TODAY, { in: '09:30' });
  await checkIn(people.gone, TODAY, { in: '09:30' });
  // Earlier this week.
  await checkIn(e1, '2026-09-28', { in: '09:30', out: '18:30' });
  await checkIn(e2, '2026-09-28', { in: '09:30', out: '18:30' });
  await checkIn(e3, '2026-09-28', { in: '09:30', out: '18:30', location: 'wfh' });
  await checkIn(e1, '2026-09-29', { in: '09:30', out: '18:30' });
  await checkIn(e2, '2026-09-29', { in: '09:30', location: 'wfh', checkoutStatus: 'missing' });
  await checkIn(people.gone, '2026-09-28', { in: '09:30', checkoutStatus: 'missing' });

  const a = projects.a.id;
  const b = projects.b.id;
  await createReport(e1, TODAY, { entries: [{ projectId: a, minutes: 480 }] });
  await createReport(e3, TODAY, { entries: [{ projectId: b, minutes: 450 }] });
  await createReport(e4, TODAY, { status: 'draft', entries: [{ projectId: a, minutes: 600 }] });
  await createReport(e5, TODAY, {
    entries: [
      { projectId: a, minutes: 300 },
      { projectRequestId: projects.request.id, minutes: 60 },
    ],
  });
  await createReport(e6, TODAY, { entries: [{ projectId: b, minutes: 120 }] }); // not checked in
  await createReport(e1, '2026-09-28', { entries: [{ projectId: b, minutes: 240 }] });
  await createReport(e2, '2026-09-29', {
    status: 'draft',
    entries: [{ projectId: a, minutes: 600 }],
  });
  await createReport(e1, '2026-09-25', { entries: [{ projectId: a, minutes: 100 }] }); // last week

  await createEditRequest(e1, '2026-09-25');
  await createEditRequest(e3, '2026-09-25');
  await createEditRequest(e5, '2026-09-24');
  await createEditRequest(e2, '2026-09-24', { status: 'approved' });
  await createCorrection(e2, '2026-09-29');
  await createCorrection(e4, '2026-09-28');
  await createCorrection(e1, '2026-09-28', { status: 'approved' });
});

describe('getTeamToday (section 7.10)', () => {
  it('counts only active people who track attendance', async () => {
    const { summary } = await dashboard.getTeamToday();
    expect(summary.tracked).toBe(6);
    expect(summary.checkedIn).toBe(5);
    expect(summary.notCheckedIn).toBe(1);
  });

  it('counts WFH among the people who checked in', async () => {
    const { summary, attendance } = await dashboard.getTeamToday();
    expect(summary.wfh).toBe(2);
    expect(summary.office).toBe(3);
    expect(attendance.segments.map((s) => s.value)).toEqual([3, 2, 1]);
    expect(attendance.total).toBe(6);
  });

  it('counts late rows and averages over the late rows only', async () => {
    const { summary } = await dashboard.getTeamToday();
    expect(summary.late).toEqual({ count: 3, averageMinutes: 26 });
  });

  it('counts submitted reports among the people who checked in (drafts are not submitted)', async () => {
    const { summary } = await dashboard.getTeamToday();
    expect(summary.reports).toEqual({ submitted: 3, of: 5, missing: 2 });
  });

  it('builds the four number cards as the canvas words them', async () => {
    const { kpis, subtitle } = await dashboard.getTeamToday();
    expect(subtitle).toBe('Wednesday, 30 September, 6:52 PM');
    expect(kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Checked in', '5', 'of 6 people'],
      ['Working from home', '2', 'of 5 checked in'],
      ['Late today', '3', 'average 26 minutes'],
      ['Reports submitted', '3', 'of 5, due 6:30'],
    ]);
    expect(kpis[0].percent).toBeCloseTo(83.3, 1);
  });

  it('groups the team board into office, WFH and not checked in', async () => {
    const { groups, counts } = await dashboard.getTeamToday();
    const names = (key) => groups.find((g) => g.key === key).rows.map((row) => row.name);
    expect(names('office')).toEqual(['Ava', 'Ben', 'Eli']);
    expect(names('wfh')).toEqual(['Cara', 'Dev']);
    expect(names('not_checked_in')).toEqual(['Finn']);
    expect(counts).toEqual({ everyone: 6, missing: 2, late: 3 });
  });

  it('fills each board row: check-in, late tag, logged time, report and projects', async () => {
    const { groups } = await dashboard.getTeamToday();
    const rows = Object.fromEntries(groups.flatMap((g) => g.rows).map((row) => [row.name, row]));
    expect(rows.Ava).toMatchObject({
      checkIn: '9:28',
      late: null,
      logged: '8h',
      report: 'submitted',
      projects: [{ name: 'alpha', color: 'blue' }],
      href: `/team/${people.e1.id}`,
    });
    expect(rows.Ben).toMatchObject({
      checkIn: '10:08',
      late: 'Late 38m',
      logged: '0h',
      report: 'missing',
    });
    expect(rows.Cara).toMatchObject({ logged: '7h 30m', report: 'submitted' });
    expect(rows.Dev).toMatchObject({ report: 'missing', projects: [] });
    expect(rows.Eli.projects).toEqual([
      { name: 'alpha', color: 'blue' },
      { name: 'New site', color: null },
    ]);
    // Finn forgot to check in but submitted: the row says so; the KPI counts checked-in people only.
    expect(rows.Finn).toMatchObject({ checkIn: null, logged: '2h', report: 'submitted' });
  });

  it('shows Not checked in and a dash for someone absent without a report', async () => {
    await db('dailyReports')
      .where({ userId: people.e6.id, workDate: TODAY })
      .update({ status: 'draft' });
    try {
      const { groups } = await dashboard.getTeamToday();
      const finn = groups.flatMap((g) => g.rows).find((row) => row.name === 'Finn');
      expect(finn).toMatchObject({
        checkIn: null,
        logged: '—',
        report: 'not_checked_in',
        projects: [],
      });
    } finally {
      await db('dailyReports')
        .where({ userId: people.e6.id, workDate: TODAY })
        .update({ status: 'submitted' });
    }
  });

  it('filters the board to missing reports or late people', async () => {
    const names = (data) => data.groups.flatMap((g) => g.rows).map((row) => row.name);
    expect(names(await dashboard.getTeamToday({ filter: 'missing' }))).toEqual(['Ben', 'Dev']);
    expect(names(await dashboard.getTeamToday({ filter: 'late' }))).toEqual(['Ben', 'Eli', 'Cara']);
    expect((await dashboard.getTeamToday({ filter: 'nonsense' })).filter).toBe('everyone');
  });

  it('shows who is on a break and the project a running timer is on (CONTRACT 15)', async () => {
    const { e1, e2, e4, e5 } = people;
    const rowOf = async (user) =>
      (await db('attendance').where({ userId: user.id, workDate: TODAY }).first()).id;
    const local = (clock, date = TODAY) => localToUtc(date, clock, TZ).toDate();
    const timer = (user, project, from, extra = {}) => ({
      userId: user.id,
      workDate: TODAY,
      projectId: project.id,
      startedAt: local(from),
      source: 'timer',
      ...extra,
    });
    await db('attendanceBreaks').insert([
      { userId: e2.id, attendanceId: await rowOf(e2), workDate: TODAY, startedAt: local('18:40') },
      {
        userId: e1.id,
        attendanceId: await rowOf(e1),
        workDate: TODAY,
        startedAt: local('12:00'),
        endedAt: local('12:30'),
        endReason: 'self',
      },
    ]);
    await db('timeEntries').insert([
      timer(e4, projects.a, '14:00', { note: 'Homepage fixes' }),
      timer(e5, projects.b, '15:00'),
      timer(e1, projects.a, '10:00', { endedAt: local('12:00'), stopReason: 'break' }),
      // Still running from yesterday: not what anyone is on today.
      timer(e2, projects.b, '17:00', {
        workDate: '2026-09-29',
        startedAt: local('17:00', '2026-09-29'),
      }),
    ]);
    try {
      const { groups } = await dashboard.getTeamToday();
      const rows = Object.fromEntries(groups.flatMap((g) => g.rows).map((row) => [row.name, row]));
      const live = ({ onBreak, breakSince, workingOn }) => ({ onBreak, breakSince, workingOn });
      expect(live(rows.Ben)).toEqual({
        onBreak: true,
        breakSince: '2026-09-30T13:10:00.000Z',
        workingOn: null,
      });
      expect(live(rows.Dev)).toEqual({
        onBreak: false,
        breakSince: null,
        workingOn: { name: 'alpha', color: 'blue', note: 'Homepage fixes' },
      });
      expect(rows.Eli.workingOn).toEqual({ name: 'beta', color: 'green', note: null });
      expect(live(rows.Ava)).toEqual({ onBreak: false, breakSince: null, workingOn: null });
      expect(live(rows.Finn)).toEqual({ onBreak: false, breakSince: null, workingOn: null });
    } finally {
      const ids = [e1.id, e2.id, e4.id, e5.id];
      await db('attendanceBreaks').whereIn('userId', ids).delete();
      await db('timeEntries').whereIn('userId', ids).delete();
    }
  });

  it('shows breaks but no running timers while timers are off, without reading them', async () => {
    const { e2, e4 } = people;
    const local = (clock) => localToUtc(TODAY, clock, TZ).toDate();
    const row = await db('attendance').where({ userId: e2.id, workDate: TODAY }).first();
    await db('attendanceBreaks').insert({
      userId: e2.id,
      attendanceId: row.id,
      workDate: TODAY,
      startedAt: local('18:40'),
    });
    // Left running from before Admin turned timers off.
    await db('timeEntries').insert({
      userId: e4.id,
      workDate: TODAY,
      projectId: projects.a.id,
      startedAt: local('14:00'),
      source: 'timer',
    });
    await setSettings({ timers_mode: 'off' });
    const queries = [];
    const listen = (query) => queries.push(query.sql);
    db.on('query', listen);
    try {
      const { groups } = await dashboard.getTeamToday();
      const rows = Object.fromEntries(groups.flatMap((g) => g.rows).map((r) => [r.name, r]));
      expect(rows.Ben).toMatchObject({
        onBreak: true,
        breakSince: '2026-09-30T13:10:00.000Z',
        workingOn: null,
      });
      expect(Object.values(rows).map((r) => r.workingOn)).toEqual(
        Object.values(rows).map(() => null),
      );
      expect(queries.some((sql) => sql.includes('`time_entries`'))).toBe(false);
    } finally {
      db.removeListener('query', listen);
      await setSettings({ timers_mode: 'optional' });
      await db('attendanceBreaks').where({ userId: e2.id }).delete();
      await db('timeEntries').where({ userId: e4.id }).delete();
    }
  });

  it('leaves out people who have not joined yet, like the Attendance screen', async () => {
    const future = await createUser({
      name: 'Gia',
      tracksAttendance: true,
      joinedOn: '2026-10-05',
    });
    try {
      const team = await dashboard.getTeamToday();
      expect(team.summary).toMatchObject({ tracked: 6, notCheckedIn: 1 });
      expect(team.kpis[0].sub).toBe('of 6 people');
      expect(team.attendance.total).toBe(6);
      expect(team.counts.everyone).toBe(6);
      const names = team.groups.flatMap((g) => g.rows).map((row) => row.name);
      expect(names).not.toContain('Gia');
      const day = await attendance.getDaySummary(TODAY);
      expect([day.tracked, day.present, day.notCheckedIn]).toEqual([
        team.summary.tracked,
        team.summary.checkedIn,
        team.summary.notCheckedIn,
      ]);

      const overview = await dashboard.getOverview();
      expect(overview.kpis[0].sub).toBe('of 6 people');
      const today = overview.attendanceWeek.days.find((d) => d.date === TODAY);
      expect(today.segments.find((s) => s.label === 'Not checked in').value).toBe(
        overview.summary.notCheckedIn,
      );
      expect(overview.attendanceWeek.max).toBe(6);
    } finally {
      await db('users').where({ id: future.id }).del();
    }
  });

  it('counts someone who checked in before their joining date', async () => {
    const early = await createUser({ name: 'Hal', tracksAttendance: true, joinedOn: '2026-10-05' });
    await checkIn(early, TODAY, { in: '09:30' });
    try {
      const { summary } = await dashboard.getTeamToday();
      expect(summary).toMatchObject({ tracked: 7, checkedIn: 6, notCheckedIn: 1 });
      expect((await attendance.getDaySummary(TODAY)).tracked).toBe(7);
      const { attendanceWeek } = await dashboard.getOverview();
      const today = attendanceWeek.days.find((d) => d.date === TODAY);
      expect(today.segments.map((s) => s.value)).toEqual([4, 2, 1]);
    } finally {
      await db('attendance').where({ userId: early.id }).del();
      await db('users').where({ id: early.id }).del();
    }
  });

  it('never lists project managers or anyone else who is not tracked', async () => {
    const team = await dashboard.getTeamToday();
    const names = team.groups.flatMap((g) => g.rows).map((row) => row.name);
    for (const name of ['Pat Manager', 'Paula Lead', 'Chief', 'Hana', 'Uma', 'Zed']) {
      expect(names).not.toContain(name);
    }
  });

  it('lists active urgent projects with when they were marked and active members', async () => {
    const { urgent } = await dashboard.getTeamToday();
    expect(urgent).toHaveLength(1);
    expect(urgent[0]).toMatchObject({
      name: 'alpha',
      note: 'Homepage live today',
      memberCount: 2,
      meta: 'Marked 11:05, 2 people on it',
    });
  });
});

describe('hours by project (section 7.10)', () => {
  it('sums submitted report entries in the week, largest first', async () => {
    const card = await dashboard.getHoursCard({ range: 'week' });
    expect(card).toMatchObject({ range: 'week', from: '2026-09-28', to: TODAY });
    expect(card.subtitle).toBe('This week, whole team');
    expect(card.bars.map((bar) => [bar.label, bar.value, bar.display])).toEqual([
      ['beta', 810, '13.5h'],
      ['alpha', 780, '13h'],
      ['New site (requested)', 60, '1h'],
    ]);
    expect(card.totalMinutes).toBe(1650);
  });

  it('covers the month from the 1st to today', async () => {
    const card = await dashboard.getHoursCard({ range: 'month', scope: 'company' });
    expect(card).toMatchObject({ from: '2026-09-01', subtitle: 'This month, whole company' });
    expect(card.bars.map((bar) => [bar.label, bar.value])).toEqual([
      ['alpha', 880],
      ['beta', 810],
      ['New site (requested)', 60],
    ]);
  });

  it('shows quarter hours exactly and folds more than eight projects into one row', () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      projectId: index + 1,
      requestId: null,
      name: `p${index + 1}`,
      color: 'blue',
      minutes: 315 - index * 15,
    }));
    const bars = hoursBars(rows);
    expect(bars[0]).toMatchObject({ label: 'p1', display: '5.25h' });
    expect(bars).toHaveLength(8);
    expect(bars[7]).toMatchObject({ label: '2 more projects', value: 405, display: '6.75h' });
  });

  it('answers one person and pages the rows', async () => {
    const range = { from: '2026-09-21', to: TODAY, userId: people.e1.id };
    const all = await dashboard.getHoursByProject(range);
    expect(all.rows.map((row) => [row.name, row.minutes, row.hours])).toEqual([
      ['alpha', 580, 9.67],
      ['beta', 240, 4],
    ]);
    const page = await dashboard.getHoursByProject({ ...range, limit: 1, offset: 1 });
    expect(page.rows.map((row) => row.name)).toEqual(['beta']);
    expect(page.total).toBe(2);
  });
});

describe('getOverview', () => {
  it('builds the five number cards', async () => {
    const { kpis } = await dashboard.getOverview();
    expect(kpis.map((k) => [k.label, k.value, k.sub ?? k.footer])).toEqual([
      ['In today', '5', 'of 6 people'],
      ['Reports submitted', '3', 'of 5, due 6:30'],
      ['Hours this week', '28h', 'Monday to today'],
      ['Active projects', '2', '1 marked urgent'],
      ['Pending requests', '6', 'edits, projects, fixes'],
    ]);
  });

  it('lists what needs attention, each with its screen', async () => {
    const { needsAttention } = await dashboard.getOverview();
    expect(needsAttention.map((item) => [item.status, item.text, item.href])).toEqual([
      ['missing', '2 reports not submitted yet', '/team?filter=missing'],
      ['pending', '3 report edit requests', '/requests'],
      ['pending', '1 new project request', '/requests'],
      ['pending', '2 attendance correction requests', '/attendance'],
      ['missing', '1 missing check-out from yesterday', '/attendance'],
    ]);
  });

  it('stacks attendance per working day; days to come stay empty', async () => {
    const { attendanceWeek } = await dashboard.getOverview();
    const values = attendanceWeek.days.map((day) => day.segments.map((s) => s.value));
    // Monday: Finn had not joined yet, so 5 people were expected.
    expect(values).toEqual([[2, 1, 2], [1, 1, 4], [3, 2, 1], [], []]);
    expect(attendanceWeek.days.map((day) => day.label)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
    ]);
    expect(attendanceWeek.days.map((day) => day.highlight)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(attendanceWeek.max).toBe(6);
  });

  it('counts active people per department, largest first, with fixed colours', async () => {
    const { departments } = await dashboard.getOverview();
    expect(departments.map((d) => [d.label, d.value, d.color])).toEqual([
      ['Development', 4, 'blue'],
      ['SEO', 2, 'violet'],
      ['Sales', 2, 'green'],
      ['Delivery', 1, 'teal'],
      ['HR', 1, 'pink'],
      ['Leadership', 1, 'navy'],
    ]);
  });

  it('shows urgent projects with who marked them, and the month range on request', async () => {
    const overview = await dashboard.getOverview({ range: 'month' });
    expect(overview.urgent.map((u) => u.meta)).toEqual(['Marked 11:05 by Pat Manager']);
    expect(overview.hours).toMatchObject({ range: 'month', from: '2026-09-01' });
    expect(overview.hours.bars[0]).toMatchObject({ label: 'alpha', value: 880 });
  });
});

describe('getNavBadges', () => {
  const badges = (user) => dashboard.getNavBadges(user);

  it('gives a PM the edit requests of their people plus pending project requests', async () => {
    expect(await badges(people.pm)).toEqual({ requests: 2, corrections: 0 });
    expect(await badges(people.pm2)).toEqual({ requests: 2, corrections: 0 });
  });

  it('gives HR the pending attendance corrections only', async () => {
    expect(await badges(people.hr)).toEqual({ requests: 0, corrections: 2 });
  });

  it('gives an Admin every pending edit and project request, and the corrections', async () => {
    expect(await badges(people.admin)).toEqual({ requests: 4, corrections: 2 });
  });

  it("never counts a person's own edit request (nobody approves their own)", async () => {
    const other = await createUser({ name: 'Meera', role: 'admin', tracksAttendance: true });
    const id = await createEditRequest(people.admin, '2026-09-24');
    try {
      expect(await badges(people.admin)).toEqual({ requests: 4, corrections: 2 });
      expect(await badges(other)).toEqual({ requests: 5, corrections: 2 });
    } finally {
      await db('reportEditRequests').where({ id }).del();
      await db('users').where({ id: other.id }).del();
    }
  });

  it("never counts HR's own correction request (another HR person or an Admin decides)", async () => {
    const id = await createCorrection(people.hr, '2026-09-29');
    try {
      expect(await badges(people.hr)).toEqual({ requests: 0, corrections: 2 });
      expect(await badges(people.admin)).toEqual({ requests: 4, corrections: 3 });
    } finally {
      await db('attendanceCorrections').where({ id }).del();
    }
  });

  it('gives employees, deactivated people and nobody zero', async () => {
    expect(await badges(people.e1)).toEqual({ requests: 0, corrections: 0 });
    expect(await badges({ ...people.pm, status: 'deactivated' })).toEqual({
      requests: 0,
      corrections: 0,
    });
    expect(await badges(null)).toEqual({ requests: 0, corrections: 0 });
  });

  it('counts with one query', async () => {
    const queries = [];
    const listen = (query) => queries.push(query.sql);
    db.on('query', listen);
    await badges(people.admin);
    db.removeListener('query', listen);
    expect(queries).toHaveLength(1);
  });
});
