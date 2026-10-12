// Dashboards: a report is due until the report time and missing from it on, and Admins'
// attendance is shown to other Admins only (company requests after the build guide). Covers the
// services and the routes that pass the signed-in viewer on.
import ExcelJS from 'exceljs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { NOW, TODAY, checkIn, createProject, createReport } from './dashboardKit.js';

// A cookie jar standing in for next/headers, and the session the auth module "finds".
const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;

vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const { dashboard } = await import('@/modules/dashboard');
const { GET: getTeamToday } = await import('@/app/api/team/today/route.js');
const { GET: getEmployee } = await import('@/app/api/team/[userId]/route.js');
const { GET: getHoursExport } = await import('@/app/api/exports/hours/route.js');

const EXPIRES = new Date('2026-10-26T04:00:00Z');
const people = {};

function signInAs(user) {
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

function get(handler, path, params = {}) {
  const request = new Request(`http://localhost:3000/api${path}`);
  return handler(request, { params: Promise.resolve(params) });
}

const rowsOf = (team) => team.groups.flatMap((group) => group.rows);
const byName = (team) => Object.fromEntries(rowsOf(team).map((row) => [row.name, row]));
const reportOf = (row) => [row.report, row.reportLabel];

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(NOW);
  people.pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  people.hr = await createUser({ name: 'Hana', role: 'hr', tracksAttendance: false });
  people.ceo = await createUser({ name: 'Chief', role: 'admin', tracksAttendance: false });
  // An Admin who checks in: only another Admin may see that.
  people.meg = await createUser({ name: 'Meg Admin', role: 'admin', department: 'Leadership' });
  people.ava = await createUser({ name: 'Ava' });
  people.ben = await createUser({ name: 'Ben' });
  people.cara = await createUser({ name: 'Cara' });
  people.dev = await createUser({ name: 'Dev' });
  const alpha = await createProject(people.pm, { name: 'alpha' });

  const { ava, ben, cara, meg } = people;
  await checkIn(ava, TODAY, { in: '09:28' });
  await checkIn(ben, TODAY, { in: '11:07', lateMinutes: 97 });
  await checkIn(cara, TODAY, { in: '12:00', location: 'wfh', lateMinutes: 150 });
  await checkIn(meg, TODAY, { in: '09:50', location: 'wfh', lateMinutes: 20 });
  await createReport(ben, TODAY, {
    status: 'draft',
    entries: [{ projectId: alpha.id, minutes: 60 }],
  });
  await createReport(cara, TODAY, { entries: [{ projectId: alpha.id, minutes: 480 }] });
  // Meg's report hours are not attendance: everyone who sees hours sees them.
  await createReport(meg, '2026-09-29', { entries: [{ projectId: alpha.id, minutes: 90 }] });
});

beforeEach(() => {
  jar.clear();
  sessionUser = null;
});

afterEach(() => setNowForTests(NOW));

describe('report time on the Team board', () => {
  it('shows a report not submitted yet as due (or draft) before the report time', async () => {
    setNowForTests('2026-09-30T08:30:00Z'); // 2:00 PM in Kolkata, report time 6:30 PM
    const team = await dashboard.getTeamToday({ viewer: people.pm });
    const rows = byName(team);
    expect(reportOf(rows.Ava)).toEqual(['due', 'Due 6:30 PM']);
    expect(reportOf(rows.Ben)).toEqual(['draft', null]);
    expect(reportOf(rows.Cara)).toEqual(['submitted', null]);
    expect(reportOf(rows.Dev)).toEqual(['not_checked_in', null]);
    expect(team.reportDue).toEqual({ label: '6:30 PM', before: true });
    expect(team.counts.missing).toBe(0);
    const missing = await dashboard.getTeamToday({ viewer: people.pm, filter: 'missing' });
    expect(rowsOf(missing)).toEqual([]);
  });

  it('shows it as missing from the report time on', async () => {
    for (const at of ['2026-09-30T13:00:00Z', NOW]) {
      setNowForTests(at); // 6:30 PM exactly, then 6:52 PM
      const team = await dashboard.getTeamToday({ viewer: people.pm });
      const rows = byName(team);
      expect(reportOf(rows.Ava)).toEqual(['missing', null]);
      expect(reportOf(rows.Ben)).toEqual(['missing', null]);
      expect(team.reportDue.before).toBe(false);
      expect(team.counts.missing).toBe(2);
      const missing = await dashboard.getTeamToday({ viewer: people.pm, filter: 'missing' });
      expect(rowsOf(missing).map((row) => row.name)).toEqual(['Ava', 'Ben']);
    }
  });

  it('follows the report time in Settings', async () => {
    await setSettings({ report_reminder_at: '17:00' });
    try {
      setNowForTests('2026-09-30T11:00:00Z'); // 4:30 PM
      const before = await dashboard.getTeamToday({ viewer: people.pm });
      expect(reportOf(byName(before).Ava)).toEqual(['due', 'Due 5:00 PM']);
      setNowForTests('2026-09-30T12:00:00Z'); // 5:30 PM
      expect(byName(await dashboard.getTeamToday({ viewer: people.pm })).Ava.report).toBe(
        'missing',
      );
    } finally {
      await setSettings({ report_reminder_at: '18:30' });
    }
  });

  it('says "due" on the Company overview until the report time', async () => {
    setNowForTests('2026-09-30T08:30:00Z');
    const early = (await dashboard.getOverview()).needsAttention[0];
    expect(early).toEqual({
      key: 'reports',
      status: 'pending',
      text: '3 reports due at 6:30 PM',
      href: '/team',
    });
    setNowForTests(NOW);
    const late = (await dashboard.getOverview()).needsAttention[0];
    expect([late.status, late.text, late.href]).toEqual([
      'missing',
      '3 reports not submitted yet',
      '/team?filter=missing',
    ]);
  });

  it("shows today's history row as due on the Employee detailed view", async () => {
    setNowForTests('2026-09-30T08:30:00Z');
    const today = async (user) =>
      (await dashboard.getEmployeeDetail({ userId: user.id, viewer: people.pm })).history[0];
    expect(reportOf(await today(people.ava))).toEqual(['due', 'Due 6:30 PM']);
    expect(reportOf(await today(people.ben))).toEqual(['draft', null]);
    setNowForTests(NOW);
    expect(reportOf(await today(people.ava))).toEqual(['missing', null]);
  });

  it('writes late times in hours and minutes', async () => {
    const team = await dashboard.getTeamToday({ viewer: people.pm });
    expect(byName(team).Ben.late).toBe('Late 1h 37m');
    expect(byName(team).Cara.late).toBe('Late 2h 30m');
    // (97 + 150) / 2 = 123.5 -> 124 minutes
    expect(team.kpis.find((kpi) => kpi.key === 'late').sub).toBe('average 2h 4m');
  });
});

describe("Admins' attendance is for Admins only", () => {
  it('leaves Admins out of the Team board, its numbers and the donut for PMs and HR', async () => {
    for (const viewer of [people.pm, people.hr]) {
      const team = await dashboard.getTeamToday({ viewer });
      expect(rowsOf(team).map((row) => row.name)).toEqual(['Ava', 'Ben', 'Cara', 'Dev']);
      expect(team.summary).toMatchObject({ tracked: 4, checkedIn: 3, wfh: 1, notCheckedIn: 1 });
      expect(team.summary.late.count).toBe(2);
      expect(team.attendance.segments.map((segment) => segment.value)).toEqual([2, 1, 1]);
      expect(team.counts).toEqual({ everyone: 4, missing: 2, late: 2 });
      expect(team.kpis.map((kpi) => kpi.sub)).toEqual([
        'of 4 people',
        'of 3 checked in',
        'average 2h 4m',
        'of 3, due 6:30',
      ]);
    }
  });

  it('shows them to another Admin, and to system reads', async () => {
    for (const viewer of [people.ceo, undefined]) {
      const team = await dashboard.getTeamToday({ viewer });
      expect(byName(team)['Meg Admin']).toMatchObject({
        group: 'wfh',
        late: 'Late 20m',
        report: 'missing',
      });
      expect(team.summary).toMatchObject({ tracked: 5, checkedIn: 4, wfh: 2 });
      expect(team.counts).toEqual({ everyone: 5, missing: 3, late: 3 });
      // (97 + 150 + 20) / 3 = 89 minutes
      expect(team.kpis.find((kpi) => kpi.key === 'late').sub).toBe('average 1h 29m');
    }
  });

  it("hides an Admin's detailed view from PMs and HR", async () => {
    for (const viewer of [people.pm, people.hr]) {
      for (const target of [people.meg, people.ceo]) {
        await expect(
          dashboard.getEmployeeDetail({ userId: target.id, viewer }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
    }
    const detail = await dashboard.getEmployeeDetail({ userId: people.meg.id, viewer: people.ceo });
    expect(detail.person.name).toBe('Meg Admin');
    expect(detail.history[0]).toMatchObject({ date: TODAY, where: 'wfh', report: 'missing' });
    const employee = await dashboard.getEmployeeDetail({
      userId: people.ava.id,
      viewer: people.pm,
    });
    expect(employee.person.name).toBe('Ava');
  });

  it("keeps an Admin's report hours in the hours export, but not their check-in days", async () => {
    const rows = async (viewer) =>
      (await dashboard.buildHoursExport({ viewer })).sheets[0].rows.map((row) => [
        row.workDate,
        row.person,
        row.status,
      ]);
    expect(await rows(people.pm)).toEqual([
      ['2026-09-29', 'Meg Admin', 'Submitted'],
      ['2026-09-30', 'Ava', 'Missing'],
      ['2026-09-30', 'Ben', 'Draft'],
      ['2026-09-30', 'Cara', 'Submitted'],
    ]);
    expect(await rows(people.ceo)).toContainEqual(['2026-09-30', 'Meg Admin', 'Missing']);
  });

  it('applies the rule through the routes, with the signed-in person as the viewer', async () => {
    signInAs(people.pm);
    const team = await get(getTeamToday, '/team/today');
    expect(team.status).toBe(200);
    expect(rowsOf((await team.json()).data).map((row) => row.name)).not.toContain('Meg Admin');
    const params = { userId: String(people.meg.id) };
    const hidden = await get(getEmployee, `/team/${people.meg.id}`, params);
    expect(hidden.status).toBe(404);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await (await get(getHoursExport, '/exports/hours')).arrayBuffer());
    const persons = book.getWorksheet('Hours').getColumn(2).values.slice(2);
    expect(persons).toEqual(['Meg Admin', 'Ava', 'Ben', 'Cara']);

    signInAs(people.ceo);
    const all = (await (await get(getTeamToday, '/team/today?filter=missing')).json()).data;
    expect(rowsOf(all).map((row) => row.name)).toEqual(['Ava', 'Ben', 'Meg Admin']);
    expect((await get(getEmployee, `/team/${people.meg.id}`, params)).status).toBe(200);
  });
});
