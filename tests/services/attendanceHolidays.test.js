// Company holidays (CONTRACT 25, item 6): create, rename, move and delete with their audit rows;
// one holiday a date, 60 a year, last year to next year; the day rules on the attendance rows of
// that date (late 0 and flag 0, restored on delete), who is told (the person, and the Admins with
// "<actor>'s own row is one of them."); a check-in that commits while a holiday is added
// (recheckDayRules); the day list and the worker on a holiday; who may call the routes.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { companyNow } from '@/worker/clock';
import { reportReminderJob } from '@/worker/jobs/reportReminder';
import { timerRemindersJob } from '@/worker/jobs/timerReminders';
import { aiPmSummaryJob } from '@/worker/jobs/aiPmSummary';
import { onOrAfterLastWorkingDay } from '@/worker/jobs/aiHrNotes';
import { lateAlertsJob } from '@/worker/jobs/lateAlerts';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

// Runs once, just before the after-commit re-check of the next holiday or leave write: stands in
// for a check-in that committed after the write's own day rules had read the rows.
const hooks = vi.hoisted(() => ({ beforeRecheck: null }));
vi.mock('@/modules/attendance/calendarEffects', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    async afterCalendarWrite(input) {
      const run = hooks.beforeRecheck;
      hooks.beforeRecheck = null;
      if (run) await run();
      return real.afterCalendarWrite(input);
    },
  };
});

const jar = new Map();
let sessionUser = null;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name, value) => jar.set(name, value),
    delete: ({ name }) => jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const { resetRateLimitsForTests } = await import('@/lib/route');
const holidaysRoute = await import('@/app/api/holidays/route.js');
const holidayRoute = await import('@/app/api/holidays/[id]/route.js');

// Thursday 19 November 2026, 11:30 AM in India.
const NOW = '2026-11-19T06:00:00Z';
const TODAY = '2026-11-19';
const FRI = '2026-11-13';
const at = (clock, date) => new Date(`${date}T${clock}:00+05:30`);
const EXPIRES = new Date('2026-12-26T04:00:00Z');

let neha;
let admin;
let admin2;
let pm;
let priya;
let vishal;

async function addRow(user, date, clock, lateMinutes) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(clock, date),
    checkOutAt: date === TODAY ? null : at('18:30', date),
    location: 'office',
    officeVerified: true,
    lateMinutes,
    isWorkingDay: true,
    checkoutStatus: date === TODAY ? 'open' : 'checked_out',
    source: 'self',
    createdAt: at('09:00', '2026-11-01'),
    updatedAt: at('09:00', '2026-11-01'),
  });
  return id;
}

const row = (id) => db('attendance').where({ id }).first();
const bells = (type) => db('notifications').where({ type }).orderBy('id', 'asc');

async function code(promise) {
  try {
    await promise;
  } catch (error) {
    return { code: error.code, message: error.message, fields: error.fields };
  }
  return { code: 'OK' };
}

function call(handler, path, { method = 'GET', body, params = {}, as } = {}) {
  sessionUser = as && { ...as, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, encodeSessionCookie('tok', EXPIRES));
  const request = new Request(`http://localhost:3000${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: env.appOrigin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(request, { params: Promise.resolve(params) });
}

beforeAll(async () => {
  await resetDatabase();
  await setSettings({
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    wfh_requires_approval: false,
  });
  neha = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  admin = await createUser({ name: 'Ravi Admin', role: 'admin', tracksAttendance: false });
  admin2 = await createUser({ name: 'Sara Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  priya = await createUser({ name: 'Priya Sharma' });
  vishal = await createUser({ name: 'Vishal Saini' });
});

beforeEach(async () => {
  setNowForTests(NOW);
  resetRateLimitsForTests();
  hooks.beforeRecheck = null;
  for (const table of ['notifications', 'auditLogs', 'attendance', 'holidays', 'leaveEntries']) {
    await db(table).delete();
  }
});

afterAll(() => setNowForTests(null));

describe('holiday writes', () => {
  it('creates, renames, moves and deletes, auditing each', async () => {
    const made = await attendance.createHoliday({
      actor: neha,
      date: '2026-11-24',
      name: ' Gurpurab ',
    });
    expect(made).toMatchObject({ date: '2026-11-24', name: 'Gurpurab' });

    const renamed = await attendance.updateHoliday({
      actor: neha,
      id: made.id,
      name: 'Guru Nanak Jayanti',
    });
    expect(renamed).toEqual({ id: made.id, date: '2026-11-24', name: 'Guru Nanak Jayanti' });
    const moved = await attendance.updateHoliday({ actor: neha, id: made.id, date: '2026-11-25' });
    expect(moved.date).toBe('2026-11-25');

    const list = await attendance.listHolidays({ year: 2026 });
    expect(list).toMatchObject({ year: 2026, available: true, upcoming: 1, firstYear: 2025 });
    expect(list.items[0]).toMatchObject({
      date: '2026-11-25',
      name: 'Guru Nanak Jayanti',
      dayLabel: 'Wed, 25 Nov',
      weekday: true,
      past: false,
      today: false,
    });

    await attendance.deleteHoliday({ actor: neha, id: made.id });
    expect(await db('holidays').count({ n: '*' })).toEqual([{ n: 0 }]);
    const audits = await db('auditLogs').where({ entityType: 'holiday' }).orderBy('id', 'asc');
    expect(audits.map((item) => item.action)).toEqual([
      'holiday.create',
      'holiday.update',
      'holiday.update',
      'holiday.delete',
    ]);
    expect(JSON.parse(audits[2].before)).toEqual({
      date: '2026-11-24',
      name: 'Guru Nanak Jayanti',
    });
    expect(JSON.parse(audits[3].before)).toEqual({
      date: '2026-11-25',
      name: 'Guru Nanak Jayanti',
    });
    expect(await code(attendance.deleteHoliday({ actor: neha, id: made.id }))).toMatchObject({
      code: 'NOT_FOUND',
      message: 'That holiday no longer exists.',
    });
  });

  it('refuses a second holiday on a date, a 61st in a year and a date outside the window', async () => {
    await attendance.createHoliday({ actor: neha, date: '2026-11-24', name: 'Guru Nanak Jayanti' });
    expect(
      await code(attendance.createHoliday({ actor: neha, date: '2026-11-24', name: 'Again' })),
    ).toEqual({
      code: 'CONFLICT',
      message: "There's already a holiday on Tue, 24 Nov.",
      fields: { date: "There's already a holiday on Tue, 24 Nov." },
    });
    const other = await attendance.createHoliday({ actor: neha, date: '2026-12-25', name: 'Xmas' });
    expect(
      await code(attendance.updateHoliday({ actor: neha, id: other.id, date: '2026-11-24' })),
    ).toMatchObject({ code: 'CONFLICT', message: "There's already a holiday on Tue, 24 Nov." });

    expect(
      await code(attendance.createHoliday({ actor: neha, date: '2028-01-01', name: 'Too far' })),
    ).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { date: 'Pick a date from 1 Jan 2025 to 31 Dec 2027.' },
    });
    expect(
      await code(attendance.createHoliday({ actor: neha, date: '2027-01-04', name: 'x' })),
    ).toMatchObject({ fields: { name: 'Name the holiday (2 to 80 characters).' } });

    const year = Array.from({ length: 60 }, (_, index) => ({
      holidayDate: `2027-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
      name: `Day ${index + 1}`,
    }));
    await db('holidays').insert(year);
    expect(
      await code(attendance.createHoliday({ actor: neha, date: '2027-06-01', name: 'One more' })),
    ).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { date: 'A year can have up to 60 holidays.' },
    });
  });
});

describe('holidays and the day rules', () => {
  it('check-in on a holiday saves flag 0 and late 0', async () => {
    await attendance.createHoliday({ actor: neha, date: TODAY, name: 'Guru Nanak Jayanti' });
    const checked = await attendance.checkIn({ user: priya, ip: null, location: 'wfh' });
    expect(checked).toMatchObject({ lateMinutes: 0, isWorkingDay: false });
  });

  it('a past holiday clears the late marks, tells the person and the Admins; deleting restores them', async () => {
    const priyaRow = await addRow(priya, FRI, '09:52', 22);
    const nehaRow = await addRow(neha, FRI, '09:45', 15);
    const thursday = await addRow(vishal, '2026-11-12', '09:50', 20);

    const holiday = await attendance.createHoliday({ actor: neha, date: FRI, name: 'Diwali' });
    expect(await row(priyaRow)).toMatchObject({ lateMinutes: 0, isWorkingDay: false });
    expect(await row(nehaRow)).toMatchObject({ lateMinutes: 0, isWorkingDay: false });
    expect(await row(thursday)).toMatchObject({ lateMinutes: 20, isWorkingDay: true });
    const audits = await db('auditLogs').where({ action: 'attendance.day_rules' });
    expect(audits.map((item) => item.entityId).sort()).toEqual([priyaRow, nehaRow].sort());
    expect(audits[0]).toMatchObject({ actorId: neha.id, reason: 'Holiday added: Diwali' });

    const told = await bells('attendance.edited');
    expect(told).toHaveLength(1); // Priya; never Neha about her own row
    expect(told[0]).toMatchObject({
      userId: priya.id,
      title: 'Your late mark for Fri, 13 Nov changed',
      body: 'Holiday added: Diwali.',
      link: '/log?month=2026-11',
    });
    const admins = await bells('holiday.past_changed');
    expect(admins.map((item) => item.userId).sort()).toEqual([admin.id, admin2.id].sort());
    expect(admins[0]).toMatchObject({
      title: 'Neha Kapoor added a holiday on Fri, 13 Nov',
      body: "2 attendance rows changed. Neha Kapoor's own row is one of them.",
      link: '/attendance/holidays?year=2026',
    });

    await attendance.deleteHoliday({ actor: neha, id: holiday.id });
    expect(await row(priyaRow)).toMatchObject({ lateMinutes: 22, isWorkingDay: true });
    expect(await row(nehaRow)).toMatchObject({ lateMinutes: 15, isWorkingDay: true });
    const deleted = (await bells('holiday.past_changed')).slice(2);
    expect(deleted[0]).toMatchObject({ title: 'Neha Kapoor deleted a holiday on Fri, 13 Nov' });
    const restored = (await bells('attendance.edited')).at(-1);
    expect(restored).toMatchObject({ userId: priya.id, body: 'Holiday removed: Diwali.' });
  });

  it('an Admin adding a past holiday tells the other Admins, without the own-row sentence', async () => {
    await addRow(priya, FRI, '09:52', 22);
    await attendance.createHoliday({ actor: admin, date: FRI, name: 'Diwali' });
    const admins = await bells('holiday.past_changed');
    expect(admins.map((item) => item.userId)).toEqual([admin2.id]);
    expect(admins[0]).toMatchObject({
      title: 'Ravi Admin added a holiday on Fri, 13 Nov',
      body: '1 attendance row changed.',
    });
  });

  it('a holiday for days to come that changes no row tells nobody', async () => {
    await attendance.createHoliday({ actor: neha, date: '2026-11-24', name: 'Guru Nanak Jayanti' });
    expect(await bells('holiday.past_changed')).toHaveLength(0);
    expect(await bells('attendance.edited')).toHaveLength(0);
  });

  it('a move runs the day rules on the old and the new date', async () => {
    const fri = await addRow(priya, FRI, '09:52', 22);
    const thu = await addRow(priya, '2026-11-12', '09:40', 10);
    const holiday = await attendance.createHoliday({ actor: neha, date: FRI, name: 'Diwali' });
    await attendance.updateHoliday({ actor: neha, id: holiday.id, date: '2026-11-12' });
    expect(await row(fri)).toMatchObject({ lateMinutes: 22, isWorkingDay: true });
    expect(await row(thu)).toMatchObject({ lateMinutes: 0, isWorkingDay: false });
    const reasons = await db('auditLogs')
      .where({ action: 'attendance.day_rules' })
      .orderBy('id', 'asc')
      .pluck('reason');
    expect(reasons).toEqual([
      'Holiday added: Diwali',
      'Holiday moved: Diwali',
      'Holiday moved: Diwali',
    ]);
    const moved = (await bells('holiday.past_changed')).at(-1);
    expect(moved).toMatchObject({
      title: 'Neha Kapoor moved a holiday to Thu, 12 Nov',
      body: '2 attendance rows changed.',
    });
  });

  it('a check-in that commits while a holiday for today is being added ends with flag 0 and late 0', async () => {
    let raced;
    hooks.beforeRecheck = async () => {
      // A check-in that read the calendar before the holiday: late 25 on a working day.
      [raced] = await db('attendance').insert({
        userId: vishal.id,
        workDate: TODAY,
        checkInAt: at('09:55', TODAY),
        location: 'office',
        officeVerified: true,
        lateMinutes: 25,
        isWorkingDay: true,
        checkoutStatus: 'open',
        source: 'self',
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      });
    };
    await attendance.createHoliday({ actor: neha, date: TODAY, name: 'Guru Nanak Jayanti' });
    expect(await row(raced)).toMatchObject({ lateMinutes: 0, isWorkingDay: false });
    const audit = await db('auditLogs').where({ action: 'attendance.day_rules', entityId: raced });
    expect(audit).toHaveLength(1);
    // Vishal is told, and the Admins count the re-checked row too.
    expect(await bells('attendance.edited')).toHaveLength(1);
    expect((await bells('holiday.past_changed'))[0].body).toBe('1 attendance row changed.');
  });
});

describe('a holiday everywhere else', () => {
  it('the day list has nobody not checked in on a holiday', async () => {
    await addRow(priya, TODAY, '09:40', 10);
    await attendance.createHoliday({ actor: neha, date: TODAY, name: 'Guru Nanak Jayanti' });
    const items = await attendance.listDay(TODAY, { viewer: neha });
    expect(items.filter((item) => item.where === 'not_checked_in')).toHaveLength(0);
    expect(items.find((item) => item.user.id === vishal.id).where).toBe('holiday');
    const summary = await attendance.getDaySummary(TODAY, { items, viewer: neha });
    expect(summary).toMatchObject({ notCheckedIn: 0, holiday: { name: 'Guru Nanak Jayanti' } });
  });

  it('the worker sees a holiday as not a working day and its day jobs skip it', async () => {
    await attendance.createHoliday({ actor: neha, date: TODAY, name: 'Guru Nanak Jayanti' });
    attendance.clearCompanyDayCache();
    setNowForTests('2026-11-19T13:30:00Z'); // 7:00 PM, past every job's time
    const now = await companyNow();
    expect(now).toMatchObject({
      workingDay: false,
      holiday: { name: 'Guru Nanak Jayanti' },
    });
    setNowForTests('2026-11-19T07:30:00Z'); // 1:00 PM, inside office hours
    expect(await reportReminderJob.tick()).toBeNull();
    expect(await timerRemindersJob.tick()).toBeNull();
    expect(await aiPmSummaryJob.tick()).toBeNull();
    setNowForTests('2026-11-19T13:30:00Z');
    expect(await lateAlertsJob.tick()).toBeNull();
  });

  it('HR notes run on Thursday when Friday is a holiday', async () => {
    const workingDays = [1, 2, 3, 4, 5];
    expect(await onOrAfterLastWorkingDay('2026-11-26', workingDays)).toBe(false);
    await attendance.createHoliday({ actor: neha, date: '2026-11-27', name: 'Founders Day' });
    expect(await onOrAfterLastWorkingDay('2026-11-26', workingDays)).toBe(true);
    expect(await onOrAfterLastWorkingDay('2026-11-25', workingDays)).toBe(false);
  });
});

describe('holiday routes', () => {
  const employee = () => priya;

  it('lets attendance.view_all read and attendance.correct write; others get FORBIDDEN', async () => {
    const list = await call(holidaysRoute.GET, '/api/holidays?year=2026', { as: pm });
    expect(list.status).toBe(200);
    expect((await list.json()).data).toMatchObject({ year: 2026, available: true, items: [] });
    expect((await call(holidaysRoute.GET, '/api/holidays', { as: employee() })).status).toBe(403);

    const body = { date: '2026-11-24', name: 'Guru Nanak Jayanti' };
    const byPm = await call(holidaysRoute.POST, '/api/holidays', { method: 'POST', body, as: pm });
    expect(byPm.status).toBe(403);
    const made = await call(holidaysRoute.POST, '/api/holidays', {
      method: 'POST',
      body,
      as: neha,
    });
    expect(made.status).toBe(201);
    const { data } = await made.json();
    expect(data).toMatchObject(body);

    const again = await call(holidaysRoute.POST, '/api/holidays', {
      method: 'POST',
      body,
      as: neha,
    });
    expect(again.status).toBe(409);
    expect((await again.json()).error.fields.date).toBe(
      "There's already a holiday on Tue, 24 Nov.",
    );

    const params = { id: String(data.id) };
    const patch = { method: 'PATCH', body: { name: 'Gurpurab' }, params };
    expect(
      (await call(holidayRoute.PATCH, `/api/holidays/${data.id}`, { ...patch, as: pm })).status,
    ).toBe(403);
    const renamed = await call(holidayRoute.PATCH, `/api/holidays/${data.id}`, {
      ...patch,
      as: neha,
    });
    expect((await renamed.json()).data.name).toBe('Gurpurab');
    const odd = await call(holidayRoute.DELETE, '/api/holidays/1e3', {
      method: 'DELETE',
      params: { id: '1e3' },
      as: neha,
    });
    expect(odd.status).toBe(404);
    const gone = await call(holidayRoute.DELETE, `/api/holidays/${data.id}`, {
      method: 'DELETE',
      params,
      as: neha,
    });
    expect((await gone.json()).data).toEqual({ id: data.id });
  });

  it('allows 60 writes a minute per person', async () => {
    // The first saves, the next 59 are refused as a clash: every one counts.
    const body = { date: '2025-01-01', name: 'New Year' };
    for (let index = 0; index < 60; index += 1) {
      await call(holidaysRoute.POST, '/api/holidays', { method: 'POST', body, as: neha });
    }
    const limited = await call(holidaysRoute.POST, '/api/holidays', {
      method: 'POST',
      body,
      as: neha,
    });
    expect(limited.status).toBe(429);
  });
});
