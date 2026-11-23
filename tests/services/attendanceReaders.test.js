// The readers of the person's day (CONTRACT 25, builder H): the Team board's "Off today" group,
// the Company overview's week, Employee detail, My log and the weekly HR notes follow company
// holidays and HR's leave. A PM's payloads, Gemini's prompt and the person's own log never carry
// HR's leave note, and only the person gets their own leave type and pay.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { aiSummaries } from '@/modules/aiSummaries';
import { dashboard } from '@/modules/dashboard';
import { reports } from '@/modules/reports';
import { createUser, resetDatabase } from '../helpers/db.js';
import { fakeGemini, promptData, requests, setUpAi, tearDownAi } from './aiSummariesKit.js';
import { NOW, TODAY, checkIn } from './dashboardKit.js';

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
const { GET: getTeamToday } = await import('@/app/api/team/today/route.js');
const { GET: getEmployee } = await import('@/app/api/team/[userId]/route.js');
const { GET: getMyLog } = await import('@/app/api/me/log/route.js');
const { dayRows, kpiCards, attendanceItems } = await import('../../src/app/(app)/log/logView.js');

const MON = '2026-09-28';
const TUE = '2026-09-29'; // a company holiday
const WED = TODAY;
const MORNING = '2026-09-30T06:00:00Z'; // 11:30 AM in Kolkata, before the 2:00 PM split
const HOLIDAY_NOON = '2026-09-29T06:30:00Z';
const NOTE = 'Private note for HR only';
const EXPIRES = new Date('2026-10-26T04:00:00Z');
const people = {};

function signInAs(user) {
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function get(handler, path, params = {}) {
  const response = await handler(new Request(`http://localhost:3000/api${path}`), {
    params: Promise.resolve(params),
  });
  expect(response.status).toBe(200);
  return response.text();
}

/** The text never carries the leave type, the pay or HR's note. */
function expectNoLeaveDetail(text) {
  expect(text).not.toContain('leaveType');
  expect(text).not.toMatch(/"paid"/);
  expect(text).not.toMatch(/sick|unpaid/i);
  expect(text).not.toContain(NOTE);
}

const rowsOf = (team) => team.groups.flatMap((group) => group.rows);
const byName = (team) => Object.fromEntries(rowsOf(team).map((row) => [row.name, row]));
const groupOf = (team, key) => team.groups.find((group) => group.key === key);
const values = (segments) => segments.map((segment) => segment.value);

async function audit(action, entityId) {
  await db('auditLogs').insert({ actorId: null, action, entityType: 'attendance', entityId });
}

function leave(user, fromDate, toDate, extra = {}) {
  return db('leaveEntries').insert({
    userId: user.id,
    fromDate,
    toDate,
    part: 'full',
    paid: true,
    leaveType: 'casual',
    createdBy: people.hr.id,
    ...extra,
  });
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(NOW);
  people.pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  people.hr = await createUser({ name: 'Neha Kapoor', role: 'hr', tracksAttendance: false });
  people.ceo = await createUser({ name: 'Chief', role: 'admin', tracksAttendance: false });
  people.ava = await createUser({ name: 'Ava' });
  people.ben = await createUser({ name: 'Ben', joinedOn: MON });
  people.cara = await createUser({ name: 'Cara', joinedOn: MON });
  people.dev = await createUser({ name: 'Dev' });
  people.eli = await createUser({ name: 'Eli' });
  const { ava, ben, cara, dev, eli } = people;

  await db('holidays').insert({ holidayDate: TUE, name: 'Test festival', createdBy: people.hr.id });
  // Ben: Monday to Wednesday, full days, sick and unpaid, with HR's note (Tuesday is a holiday).
  await leave(ben, MON, WED, { paid: false, leaveType: 'sick', note: NOTE });
  await leave(cara, MON, MON, { part: 'second_half' });
  await leave(cara, WED, WED, { part: 'first_half' });
  await leave(dev, WED, WED, { part: 'second_half' });

  // Ava: Monday's check-out came from the auto check-out (fixed since), worked the holiday (its
  // late minutes are stale on purpose: a holiday has no late mark) and is in today.
  const avaMonday = await checkIn(ava, MON, { out: '18:30', checkoutStatus: 'corrected' });
  await audit('attendance.auto_checkout', avaMonday);
  await checkIn(ava, TUE, { in: '10:00', out: '16:00', lateMinutes: 30, isWorkingDay: false });
  await checkIn(ava, WED, { in: '09:28' });
  // Dev forgot to check out on Monday; Eli's Monday was marked missing and fixed since.
  await checkIn(dev, MON, { in: '09:30' });
  const eliMonday = await checkIn(eli, MON, { out: '18:30', checkoutStatus: 'corrected' });
  await audit('attendance.mark_missing', eliMonday);
  await checkIn(eli, WED, { in: '09:50', lateMinutes: 20 });
});

beforeEach(() => {
  jar.clear();
  sessionUser = null;
});

afterEach(() => setNowForTests(NOW));

describe('Team board (CONTRACT 25)', () => {
  it('puts leave in "Off today" with its tag, never in Not checked in', async () => {
    setNowForTests(MORNING);
    const team = await dashboard.getTeamToday({ viewer: people.pm });
    expect(team.groups.map((group) => [group.key, group.title, group.tone, group.count])).toEqual([
      ['office', 'In office', 'primary', 2],
      ['wfh', 'Working from home', 'violet', 0],
      ['not_checked_in', 'Not checked in', 'red', 1],
      ['off', 'Off today', 'teal', 2],
    ]);
    const rows = byName(team);
    expect(rows.Ben).toMatchObject({
      group: 'off',
      offTag: { label: 'On leave', tone: 'teal' },
      report: 'off',
      logged: '—',
    });
    // First-half leave is off until the split (2:00 PM); second-half leave was expected now.
    expect(rows.Cara.offTag).toEqual({ label: 'On leave, first half', tone: 'teal' });
    expect(rows.Dev).toMatchObject({ group: 'not_checked_in', offTag: null });
    expect(team.summary).toMatchObject({ tracked: 5, checkedIn: 2, notCheckedIn: 1, off: 2 });
    expect(team.kpis[0]).toMatchObject({ sub: 'of 5 people, 2 off', percent: 66.7 });
    expect(team.attendance.segments.at(-1)).toEqual({
      key: 'off',
      label: 'Off today',
      value: 2,
      color: 'teal',
    });
    expect(values(team.attendance.segments)).toEqual([2, 0, 1, 2]);
  });

  it('moves first-half leave to Not checked in after the split', async () => {
    const team = await dashboard.getTeamToday({ viewer: people.pm });
    expect(groupOf(team, 'off').rows.map((row) => row.name)).toEqual(['Ben']);
    expect(groupOf(team, 'not_checked_in').rows.map((row) => row.name)).toEqual(['Cara', 'Dev']);
    expect(team.kpis[0].sub).toBe('of 5 people, 1 off');
  });

  it('shows a holiday as Holiday for everyone without a check-in, with no late marks', async () => {
    setNowForTests(HOLIDAY_NOON);
    const team = await dashboard.getTeamToday({ viewer: people.pm });
    expect(team.subtitle).toMatch(/ · Holiday: Test festival$/);
    expect(team.holiday).toEqual({ name: 'Test festival' });
    expect(team.summary).toMatchObject({ checkedIn: 1, notCheckedIn: 0, off: 4 });
    expect(team.summary.late.count).toBe(0);
    expect(byName(team).Ava).toMatchObject({ group: 'office', late: null, lateMinutes: 0 });
    // Ben's leave doesn't count on a holiday: the holiday does.
    expect(groupOf(team, 'off').rows.map((row) => [row.name, row.offTag.label])).toEqual([
      ['Ben', 'Holiday'],
      ['Cara', 'Holiday'],
      ['Dev', 'Holiday'],
      ['Eli', 'Holiday'],
    ]);
    expect(byName(team).Ben.offTag.tone).toBe('green');
  });

  it("gives a PM's /team and /team/[userId] payloads no leave type, pay or note", async () => {
    signInAs(people.pm);
    setNowForTests(MORNING);
    const team = await get(getTeamToday, '/team/today');
    expect(team).toContain('On leave, first half');
    expectNoLeaveDetail(team);
    for (const person of [people.ben, people.cara]) {
      const detail = await get(getEmployee, `/team/${person.id}`, { userId: String(person.id) });
      expect(detail).toContain('on_leave');
      expectNoLeaveDetail(detail);
    }
  });
});

describe('Employee detail (CONTRACT 25)', () => {
  it('lists holiday and leave days, with a dash for the report on a day off', async () => {
    const detail = await dashboard.getEmployeeDetail({ userId: people.ben.id, viewer: people.pm });
    expect(
      detail.history.map((row) => [row.date, row.where, row.whereNote, row.report, row.in]),
    ).toEqual([
      [WED, 'on_leave', null, 'off', '—'],
      [TUE, 'holiday', 'Test festival', 'off', '—'],
      [MON, 'on_leave', null, 'off', '—'],
    ]);
    const tones = Object.fromEntries(
      detail.calendar.weeks.flat().map((cell) => [cell.date, cell.tone]),
    );
    expect([tones[MON], tones[TUE], tones[WED]]).toEqual(['leave', 'holiday', 'leave']);
    expect(detail.stats.lateDays).toBe(0);
  });

  it('shows the half of a leave day and keeps a half-day no-show as not checked in', async () => {
    const detail = await dashboard.getEmployeeDetail({ userId: people.cara.id, viewer: people.pm });
    expect(detail.history.map((row) => [row.date, row.where, row.whereNote, row.report])).toEqual([
      [WED, 'on_leave', 'First half', 'not_checked_in'],
      [TUE, 'holiday', 'Test festival', 'off'],
      [MON, 'on_leave', 'Second half', 'not_checked_in'],
    ]);
  });

  it("doesn't count a stale late mark on a holiday", async () => {
    const detail = await dashboard.getEmployeeDetail({ userId: people.ava.id, viewer: people.pm });
    const tuesday = detail.history.find((row) => row.date === TUE);
    expect(tuesday).toMatchObject({ where: 'office', whereNote: null });
    expect(detail.stats.lateDays).toBe(0);
    const tones = Object.fromEntries(
      detail.calendar.weeks.flat().map((cell) => [cell.date, cell.tone]),
    );
    expect(tones[TUE]).toBe('office');
  });
});

describe('Company overview (CONTRACT 25)', () => {
  it('counts first-half leave before the split as Off, and fades the holiday', async () => {
    setNowForTests(MORNING);
    const overview = await dashboard.getOverview({ viewer: people.ceo });
    const [monday, tuesday, today] = overview.attendanceWeek.days;
    // Office, WFH, Not checked in, Off. Monday: Cara (second-half leave) was expected and didn't
    // come; Ben was on leave. Tuesday was a holiday: only Ava worked.
    expect(values(monday.segments)).toEqual([3, 0, 1, 1]);
    expect(tuesday).toMatchObject({ faded: true, title: 'Holiday: Test festival' });
    expect(values(tuesday.segments)).toEqual([1, 0, 0, 0]);
    expect(values(today.segments)).toEqual([2, 0, 1, 2]);
    expect(today.segments.map((segment) => segment.label)).toEqual([
      'Office',
      'Working from home',
      'Not checked in',
      'Off',
    ]);
    expect(overview.attendanceWeek.hasOff).toBe(true);
    expect(overview.kpis[0].sub).toBe('of 5 people, 2 off');
    expect(overview.summary).toMatchObject({ notCheckedIn: 1, off: 2 });
  });

  it('moves first-half leave to Not checked in after the split', async () => {
    const overview = await dashboard.getOverview({ viewer: people.ceo });
    const today = overview.attendanceWeek.days.find((day) => day.date === WED);
    expect(values(today.segments)).toEqual([2, 0, 2, 1]);
  });

  it('compares the hours with the days people were expected so far', async () => {
    const overview = await dashboard.getOverview({ viewer: people.ceo });
    // Expected days: Monday 3.5 (Ben off, Cara half), the holiday 0, today 3 (Ben off, Cara and
    // Dev half), at 9 office hours each: no report hours yet, so 0%.
    expect(overview.kpis.find((kpi) => kpi.key === 'hours').percent).toBe(0);
  });
});

describe('My log (CONTRACT 25)', () => {
  const asPerson = (user) => ({ ...user, tracksAttendance: true });

  it('shows holiday and leave days, and counts leave in the working days', async () => {
    const log = await reports.getMonthLog({ user: asPerson(people.ben), month: '2026-09' });
    expect(log.days.map((day) => [day.date, day.status, day.isWorkingDay])).toEqual([
      [WED, 'on_leave', true],
      [TUE, 'holiday', false],
      [MON, 'on_leave', true],
    ]);
    // The person's own leave: the part, type and pay, never HR's note.
    expect(log.days[0].leave).toEqual({ part: 'full', paid: false, leaveType: 'sick' });
    expect(log.days[1].holiday).toEqual({ name: 'Test festival' });
    expect(log.kpis).toMatchObject({ daysPresent: 0, workingDays: 2, leaveDays: 2 });
    expect(log.attendance).toMatchObject({ notCheckedIn: 0, leave: 2 });
    expect(kpiCards(log)[1]).toMatchObject({ value: '0', sub: 'of 2 working days' });
    const rows = dayRows(log);
    expect(rows.map((row) => [row.status, row.label, row.dayNote])).toEqual([
      ['on_leave', 'On leave', null],
      ['holiday', 'Holiday', 'Test festival'],
      ['on_leave', 'On leave', null],
    ]);
    expect(rows[0].note).toBe("You're on leave today.");
    expect(rows[1].note).toBe('Holiday: Test festival. Nobody was expected in.');
    expect(JSON.stringify(log)).not.toContain(NOTE);
  });

  it('counts a half-day leave no-show as half a day not checked in', async () => {
    const log = await reports.getMonthLog({ user: asPerson(people.cara), month: '2026-09' });
    const rows = dayRows(log);
    expect(rows.map((row) => [row.date, row.status, row.dayNote])).toEqual([
      [WED, 'not_checked_in', 'First half on leave'],
      [TUE, 'holiday', 'Test festival'],
      [MON, 'not_checked_in', 'Second half on leave'],
    ]);
    expect(log.kpis).toMatchObject({ daysPresent: 0, workingDays: 2, leaveDays: 1 });
    expect(attendanceItems(log).map((item) => [item.key, item.value])).toEqual([
      ['office', '0 days'],
      ['wfh', '0 days'],
      ['late', '0 days'],
      ['missing', '0.5 days'],
      ['leave', '1 day'],
    ]);
  });

  it('puts Day type and Leave in the Excel, with the person own type and pay only', async () => {
    const log = await reports.getMonthLog({ user: asPerson(people.ben), month: '2026-09' });
    const book = reports.monthLogWorkbook(log);
    const [days] = book.sheets;
    expect(days.columns.slice(-2).map((column) => column.header)).toEqual(['Day type', 'Leave']);
    expect(days.rows.map((row) => [row.date, row.dayType, row.leave, row.report])).toEqual([
      [MON, 'Working day', 'Full day, sick, unpaid', 'On leave'],
      [TUE, 'Holiday: Test festival', '', 'Holiday'],
      [WED, 'Working day', 'Full day, sick, unpaid', 'On leave'],
    ]);
    expect(JSON.stringify(book)).not.toContain(NOTE);
  });

  it('never sends the note through GET /api/me/log', async () => {
    signInAs(people.ben);
    const body = await get(getMyLog, '/me/log?month=2026-09');
    expect(body).toContain('"leaveType":"sick"');
    expect(body).not.toContain(NOTE);
  });
});

describe('weekly HR notes (CONTRACT 25)', () => {
  beforeEach(async () => {
    await db('aiSummaries').del();
    await db('notifications').del();
    await setUpAi();
    fakeGemini(() => ({ title: 'A calm week', body: 'A calm week overall.' }));
  });

  afterEach(() => tearDownAi());

  it('counts holidays and leave, and missing and auto check-outs by the month rules', async () => {
    expect(await aiSummaries.sendHrNotes(WED)).toMatchObject({ written: true, people: 5 });
    const [request] = requests;
    const data = promptData(request.prompt);
    const rows = data.people;
    const pick = (row) => ({
      workingDays: row.workingDays,
      expectedDays: row.expectedDays,
      daysPresent: row.daysPresent,
      daysOffWorked: row.daysOffWorked,
      absentDays: row.absentDays,
      holidays: row.holidays,
      leaveDays: row.leaveDays,
      lateDays: row.lateDays,
      missingCheckOuts: row.missingCheckOuts,
      autoCheckOuts: row.autoCheckOuts,
    });
    // In id order: Ava, Ben, Cara, Dev, Eli.
    expect(rows.map(pick)).toEqual([
      {
        workingDays: 2,
        expectedDays: 2,
        daysPresent: 2,
        daysOffWorked: 1,
        absentDays: 0,
        holidays: 1,
        leaveDays: 0,
        lateDays: 0,
        missingCheckOuts: 0,
        autoCheckOuts: 1,
      },
      {
        workingDays: 2,
        expectedDays: 0,
        daysPresent: 0,
        daysOffWorked: 0,
        absentDays: 0,
        holidays: 1,
        leaveDays: 2,
        lateDays: 0,
        missingCheckOuts: 0,
        autoCheckOuts: 0,
      },
      {
        workingDays: 2,
        expectedDays: 1,
        daysPresent: 0,
        daysOffWorked: 0,
        absentDays: 0.5,
        holidays: 1,
        leaveDays: 1,
        lateDays: 0,
        missingCheckOuts: 0,
        autoCheckOuts: 0,
      },
      {
        workingDays: 2,
        expectedDays: 1.5,
        daysPresent: 1,
        daysOffWorked: 0,
        absentDays: 0,
        holidays: 1,
        leaveDays: 0.5,
        lateDays: 0,
        missingCheckOuts: 1,
        autoCheckOuts: 0,
      },
      {
        workingDays: 2,
        expectedDays: 2,
        daysPresent: 2,
        daysOffWorked: 0,
        absentDays: 0,
        holidays: 1,
        leaveDays: 0,
        lateDays: 1,
        missingCheckOuts: 1,
        autoCheckOuts: 0,
      },
    ]);
    expect(request.prompt).toContain(
      'holidays are company holidays; leaveDays are days HR marked as leave (a half day is 0.5). Neither is an absence.',
    );
  });

  it('never sends the leave type, paid or unpaid, or the note', async () => {
    await aiSummaries.sendHrNotes(WED);
    const sent = requests.map((request) => `${request.system}\n${request.prompt}`).join('\n');
    expect(sent).not.toMatch(/sick|casual|unpaid|\bpaid\b|leaveType/i);
    expect(sent).not.toContain(NOTE);
  });
});
