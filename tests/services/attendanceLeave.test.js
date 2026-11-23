// Leave days (CONTRACT 25, item 9): only working days count; a half day is one day; five parallel
// creates save one; who may mark whose leave (own, an Admin's, untracked); update and delete need
// a reason; the person is told without the note; the preview (and HR's preview of an Admin); late
// marks with half-day and full-day leave; the day list; the Leave page with a payroll month from
// the 26th; the note never reaches the person; who may call the routes.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { reports } from '@/modules/reports';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

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
const leaveRoute = await import('@/app/api/leave/route.js');
const leaveIdRoute = await import('@/app/api/leave/[id]/route.js');
const previewRoute = await import('@/app/api/leave/preview/route.js');
const peopleRoute = await import('@/app/api/leave/people/route.js');

// Thursday 19 November 2026, 11:30 AM in India.
const NOW = '2026-11-19T06:00:00Z';
const TODAY = '2026-11-19';
const FRI = '2026-11-20';
const MON = '2026-11-23';
const TUE = '2026-11-24';
const NOTE = "Fever, doctor's note sent";
const at = (clock, date) => new Date(`${date}T${clock}:00+05:30`);
const EXPIRES = new Date('2026-12-26T04:00:00Z');

let neha;
let admin;
let trackedAdmin;
let pm;
let priya;
let karan;
let meera;
let aman;
let rahul;

async function addRow(user, date, clock, lateMinutes, extra = {}) {
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
    createdAt: at('09:00', '2026-10-01'),
    updatedAt: at('09:00', '2026-10-01'),
    ...extra,
  });
  return id;
}

const row = (id) => db('attendance').where({ id }).first();

async function code(promise) {
  try {
    await promise;
  } catch (error) {
    return { code: error.code, message: error.message, fields: error.fields };
  }
  return { code: 'OK' };
}

const mark = (input) => attendance.createLeave({ actor: neha, part: 'full', ...input });

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
  trackedAdmin = await createUser({ name: 'Tara Admin', role: 'admin' });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  priya = await createUser({ name: 'Priya Sharma' });
  karan = await createUser({ name: 'Karan Mehta' });
  meera = await createUser({ name: 'Meera Nair' });
  aman = await createUser({ name: 'Aman Singh' });
  rahul = await createUser({ name: 'Rahul Verma', tracksAttendance: false });
});

beforeEach(async () => {
  setNowForTests(NOW);
  resetRateLimitsForTests();
  await setSettings({ late_after: '09:30', payroll_month_start_day: 1 });
  for (const table of [
    'notifications',
    'auditLogs',
    'attendance',
    'holidays',
    'leaveEntries',
    'wfhRequests',
  ]) {
    await db(table).delete();
  }
});

afterAll(() => setNowForTests(null));

describe('marking leave', () => {
  it('counts only the working days across a weekend and a holiday, and previews them', async () => {
    await db('holidays').insert({ holidayDate: TUE, name: 'Guru Nanak Jayanti' });
    await addRow(priya, FRI, '09:40', 10);
    const preview = await attendance.previewLeave({
      actor: neha,
      userId: priya.id,
      fromDate: FRI,
      toDate: TUE,
      part: 'full',
    });
    expect(preview).toEqual({
      workingDays: 2,
      split: '14:00',
      offDays: [
        { date: '2026-11-21', why: 'not_working' },
        { date: '2026-11-22', why: 'not_working' },
        { date: TUE, why: 'holiday', name: 'Guru Nanak Jayanti' },
      ],
      checkIns: [FRI],
      overlap: null,
    });
    const entry = await mark({ userId: priya.id, fromDate: FRI, toDate: TUE, note: NOTE });
    expect(entry).toMatchObject({
      user: { id: priya.id, name: 'Priya Sharma' },
      fromDate: FRI,
      toDate: TUE,
      days: 'Fri, 20 – Tue, 24 Nov',
      part: 'full',
      partLabel: 'Full day',
      paid: true,
      leaveType: 'casual',
      typeLabel: 'Casual',
      note: NOTE,
      workingDays: 2,
      createdBy: { id: neha.id, name: 'Neha Kapoor' },
    });
    const again = await attendance.previewLeave({
      actor: neha,
      userId: priya.id,
      fromDate: TUE,
      toDate: '2026-11-25',
    });
    expect(again.overlap).toEqual({ fromDate: FRI, toDate: TUE, firstDay: TUE });
  });

  it('tells the person without the note, and audits the whole entry', async () => {
    const entry = await mark({
      userId: meera.id,
      fromDate: MON,
      toDate: TUE,
      leaveType: 'sick',
      paid: false,
      note: NOTE,
    });
    const [bell] = await db('notifications').where({ userId: meera.id });
    expect(bell).toMatchObject({
      type: 'leave.marked',
      title: 'Neha Kapoor marked leave for you: Mon, 23 – Tue, 24 Nov',
      body: 'Sick, unpaid.',
      link: '/today',
    });
    expect(JSON.stringify(bell)).not.toContain('Fever');
    const [audit] = await db('auditLogs').where({ action: 'leave.create' });
    expect(audit).toMatchObject({ entityType: 'leave', entityId: entry.id, actorId: neha.id });
    expect(JSON.parse(audit.after)).toEqual({
      userId: meera.id,
      fromDate: MON,
      toDate: TUE,
      part: 'full',
      paid: false,
      leaveType: 'sick',
      note: NOTE,
    });

    await attendance.updateLeave({ actor: neha, id: entry.id, toDate: MON, reason: 'One day' });
    await attendance.deleteLeave({ actor: neha, id: entry.id, reason: 'Came in' });
    const titles = await db('notifications')
      .where({ userId: meera.id })
      .orderBy('id')
      .pluck('title');
    expect(titles.slice(1)).toEqual([
      'Neha Kapoor changed your leave: Mon, 23 Nov',
      'Neha Kapoor removed your leave on Mon, 23 Nov',
    ]);
    const deleted = await db('auditLogs').where({ action: 'leave.delete' }).first();
    expect(deleted.reason).toBe('Came in');
    expect(JSON.parse(deleted.before)).toMatchObject({ fromDate: MON, toDate: MON, note: NOTE });
  });

  it('a half day needs one day; no working days and missing reasons are refused', async () => {
    expect(
      await code(mark({ userId: priya.id, fromDate: FRI, toDate: MON, part: 'first_half' })),
    ).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { part: 'Half days are for one day. Pick the same first and last day.' },
    });
    expect(
      await code(mark({ userId: priya.id, fromDate: '2026-11-21', toDate: '2026-11-22' })),
    ).toMatchObject({ code: 'VALIDATION_FAILED', message: 'No working days in these dates.' });
    expect(await code(mark({ userId: priya.id, fromDate: MON, toDate: FRI }))).toMatchObject({
      fields: { toDate: "The last day can't be before the first day." },
    });
    expect(
      await code(mark({ userId: priya.id, fromDate: '2026-01-01', toDate: '2027-01-02' })),
    ).toMatchObject({ fields: { toDate: 'Mark up to a year at a time.' } });
    const entry = await mark({ userId: priya.id, fromDate: MON });
    expect(
      await code(attendance.updateLeave({ actor: neha, id: entry.id, paid: false })),
    ).toMatchObject({ code: 'VALIDATION_FAILED', fields: { reason: 'Add a reason.' } });
    expect(
      await code(attendance.deleteLeave({ actor: neha, id: entry.id, reason: ' ' })),
    ).toMatchObject({ code: 'VALIDATION_FAILED', fields: { reason: 'Add a reason.' } });
  });

  it('saves one of five parallel creates for the same person and day', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => mark({ userId: karan.id, fromDate: MON })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.filter((result) => result.status === 'rejected');
    expect(refused.map((result) => result.reason.code)).toEqual(Array(4).fill('CONFLICT'));
    expect(await db('leaveEntries').where({ userId: karan.id })).toHaveLength(1);
    expect(await code(mark({ userId: karan.id, fromDate: '2026-11-22', toDate: TUE }))).toEqual({
      code: 'CONFLICT',
      message: 'Karan Mehta already has leave on Mon, 23 Nov.',
      fields: { fromDate: 'Karan Mehta already has leave on Mon, 23 Nov.' },
    });
  });

  it('checks the person: own leave, an Admin for HR, untracked, missing', async () => {
    expect(await code(mark({ userId: neha.id, fromDate: MON }))).toEqual({
      code: 'FORBIDDEN',
      message: "You can't mark your own leave. Ask another HR person or an Admin.",
    });
    expect(await code(mark({ userId: trackedAdmin.id, fromDate: MON }))).toEqual({
      code: 'FORBIDDEN',
      message: "Only an Admin can mark an Admin's leave.",
    });
    const byAdmin = await attendance.createLeave({
      actor: admin,
      userId: trackedAdmin.id,
      fromDate: MON,
      part: 'full',
    });
    expect(byAdmin.user.id).toBe(trackedAdmin.id);
    expect(
      await code(
        attendance.updateLeave({ actor: neha, id: byAdmin.id, paid: false, reason: 'No' }),
      ),
    ).toEqual({
      code: 'NOT_FOUND',
      message: 'That leave no longer exists.',
    });
    expect(await code(mark({ userId: rahul.id, fromDate: MON }))).toEqual({
      code: 'CONFLICT',
      message: "Rahul Verma doesn't check in, so there's no leave to mark.",
    });
    expect(await code(mark({ userId: 999999, fromDate: MON }))).toEqual({
      code: 'NOT_FOUND',
      message: "We couldn't find that person.",
    });
  });

  it("HR's preview of an Admin is NOT_FOUND and shows no check-ins", async () => {
    await addRow(trackedAdmin, FRI, '09:30', 0);
    const hidden = await code(
      attendance.previewLeave({ actor: neha, userId: trackedAdmin.id, fromDate: FRI }),
    );
    expect(hidden).toEqual({ code: 'NOT_FOUND', message: "We couldn't find that person." });
    const shown = await attendance.previewLeave({
      actor: admin,
      userId: trackedAdmin.id,
      fromDate: FRI,
    });
    expect(shown.checkIns).toEqual([FRI]);
  });
});

describe('leave and the late marks', () => {
  it('first-half leave: a 14:10 check-in is 10m late; full leave: late 0', async () => {
    await mark({ userId: aman.id, fromDate: TODAY, part: 'first_half' });
    await mark({ userId: meera.id, fromDate: TODAY });
    setNowForTests(at('14:10', TODAY).toISOString());
    const amanIn = await attendance.checkIn({ user: aman, ip: null, location: 'wfh' });
    expect(amanIn.lateMinutes).toBe(10);
    const meeraIn = await attendance.checkIn({ user: meera, ip: null, location: 'wfh' });
    expect(meeraIn).toMatchObject({ lateMinutes: 0, isWorkingDay: true });
  });

  it('first-half leave added after a 13:45 check-in clears the late mark; deleting restores it', async () => {
    const id = await addRow(priya, '2026-11-18', '13:45', 255);
    const entry = await mark({ userId: priya.id, fromDate: '2026-11-18', part: 'first_half' });
    expect(await row(id)).toMatchObject({ lateMinutes: 0, isWorkingDay: true });
    const [audit] = await db('auditLogs').where({ action: 'attendance.day_rules' });
    expect(audit.reason).toBe('Leave marked: Wed, 18 Nov, first half');
    await attendance.deleteLeave({ actor: neha, id: entry.id, reason: 'Was in all day' });
    expect(await row(id)).toMatchObject({ lateMinutes: 255 });
  });

  it('a note edit keeps the stored late minutes even after Late after changed', async () => {
    const id = await addRow(priya, '2026-11-18', '09:52', 22);
    const entry = await mark({ userId: priya.id, fromDate: '2026-11-18', part: 'second_half' });
    expect(await row(id)).toMatchObject({ lateMinutes: 22 });
    await setSettings({ late_after: '09:40' });
    await attendance.updateLeave({ actor: neha, id: entry.id, note: 'Dentist', reason: 'Note' });
    expect(await row(id)).toMatchObject({ lateMinutes: 22 });
    expect(await db('auditLogs').where({ action: 'attendance.day_rules' })).toHaveLength(0);
  });
});

describe('leave on the day list', () => {
  it('full leave is on_leave; first half is on_leave until the split; PMs get no type or pay', async () => {
    await mark({ userId: meera.id, fromDate: TODAY, leaveType: 'sick', paid: false });
    await mark({ userId: aman.id, fromDate: TODAY, part: 'first_half' });
    await db('wfhRequests').insert({
      userId: karan.id,
      fromDate: TODAY,
      toDate: TODAY,
      reason: 'Repair at home',
      status: 'approved',
    });
    const items = await attendance.listDay(TODAY, { viewer: neha, leaveDetail: true });
    const whereOf = (user) => items.find((item) => item.user.id === user.id).where;
    expect(whereOf(meera)).toBe('on_leave');
    expect(whereOf(aman)).toBe('on_leave');
    const notIn = attendance.filterDay(items, 'not_checked_in').map((item) => item.user.id);
    expect(notIn).not.toContain(meera.id);
    const onLeave = attendance.filterDay(items, 'on_leave').map((item) => item.user.id);
    expect(onLeave.sort()).toEqual([meera.id, aman.id].sort());
    const meeraDay = items.find((item) => item.user.id === meera.id).day;
    expect(meeraDay.leave).toMatchObject({ part: 'full', leaveType: 'sick', paid: false });
    expect(items.find((item) => item.user.id === karan.id).day.wfhApproved).toBe(true);

    const forPm = await attendance.listDay(TODAY, { viewer: pm });
    const pmDay = forPm.find((item) => item.user.id === meera.id).day;
    expect(pmDay.leave).toEqual({ id: expect.any(Number), part: 'full' });
    expect(forPm.find((item) => item.user.id === karan.id).day.wfhApproved).toBe(false);

    setNowForTests(at('14:30', TODAY).toISOString());
    const later = await attendance.listDay(TODAY, { viewer: neha });
    expect(later.find((item) => item.user.id === aman.id).where).toBe('not_checked_in');
  });
});

describe('the Leave page', () => {
  it('lists a payroll month from the 26th, with the days inside it and the check-ins', async () => {
    await setSettings({ payroll_month_start_day: 26 });
    const sam = await mark({ userId: karan.id, fromDate: '2026-10-22', toDate: '2026-10-27' });
    await mark({ userId: priya.id, fromDate: '2026-11-25', toDate: '2026-11-26' });
    await mark({ userId: meera.id, fromDate: '2026-11-26' });
    await addRow(karan, '2026-10-26', '09:30', 0);
    const list = await attendance.listLeave({ viewer: neha, month: '2026-11' });
    expect(list.period).toMatchObject({ from: '2026-10-26', to: '2026-11-25' });
    expect(list.items.map((item) => item.user.id)).toEqual([priya.id, karan.id]);
    expect(list.items[1]).toMatchObject({
      id: sam.id,
      workingDays: 2,
      entryWorkingDays: 4,
      checkedInDays: 1,
    });
    expect(list.items[0]).toMatchObject({ workingDays: 1, entryWorkingDays: 2 });
    expect(list).toMatchObject({ total: 2, summary: { people: 2, workingDays: 3 } });
  });

  it("gives HR's own entry no note, and the note never reaches the person", async () => {
    const entry = await attendance.createLeave({
      actor: admin,
      userId: neha.id,
      fromDate: TODAY,
      part: 'full',
      note: NOTE,
    });
    const forNeha = await attendance.listLeave({ viewer: neha, month: '2026-11' });
    expect(forNeha.items[0]).toMatchObject({ id: entry.id, note: null });
    const forAdmin = await attendance.listLeave({ viewer: admin, month: '2026-11' });
    expect(forAdmin.items[0].note).toBe(NOTE);

    await mark({ userId: meera.id, fromDate: TODAY, note: NOTE });
    const today = await attendance.getMyToday({ user: meera, ip: null });
    expect(today.day.leave).toMatchObject({ part: 'full', leaveType: 'casual', paid: true });
    expect(today.upcoming.todayLeave).toMatchObject({ markedBy: { name: 'Neha Kapoor' } });
    expect(JSON.stringify(today)).not.toContain('Fever');
    const log = await reports.getMonthLog({ user: meera, month: '2026-11' });
    expect(JSON.stringify(reports.monthLogWorkbook(log))).not.toContain('Fever');
    expect(JSON.stringify(await db('notifications').where({ userId: meera.id }))).not.toContain(
      'Fever',
    );
  });
});

describe('leave routes', () => {
  it('is for attendance.correct only, and checks every body', async () => {
    expect((await call(leaveRoute.GET, '/api/leave', { as: pm })).status).toBe(403);
    expect((await call(leaveRoute.GET, '/api/leave', { as: priya })).status).toBe(403);
    const body = { userId: priya.id, fromDate: MON, part: 'full', paid: true, leaveType: 'casual' };
    const made = await call(leaveRoute.POST, '/api/leave', { method: 'POST', body, as: neha });
    expect(made.status).toBe(201);
    const { data } = await made.json();
    expect(data).toMatchObject({ fromDate: MON, toDate: MON, workingDays: 1 });

    const list = await call(leaveRoute.GET, '/api/leave?month=2026-11', { as: neha });
    expect(await list.json()).toMatchObject({ data: [{ id: data.id }], page: { total: 1 } });

    const preview = await call(
      previewRoute.GET,
      `/api/leave/preview?userId=${priya.id}&fromDate=${MON}&excludeId=${data.id}`,
      { as: neha },
    );
    expect((await preview.json()).data).toMatchObject({ workingDays: 1, overlap: null });

    const params = { id: String(data.id) };
    const noReason = await call(leaveIdRoute.PATCH, `/api/leave/${data.id}`, {
      method: 'PATCH',
      body: { paid: false },
      params,
      as: neha,
    });
    expect(noReason.status).toBe(400);
    expect((await noReason.json()).error.fields.reason).toBe('Add a reason.');
    const deleted = await call(leaveIdRoute.DELETE, `/api/leave/${data.id}`, {
      method: 'DELETE',
      body: { reason: 'Came in' },
      params,
      as: neha,
    });
    expect((await deleted.json()).data).toEqual({ id: data.id });

    const people = await call(peopleRoute.GET, '/api/leave/people', { as: neha });
    const names = (await people.json()).data.people.map((person) => person.name);
    expect(names).toContain('Priya Sharma');
    expect(names).not.toContain('Neha Kapoor');
    expect(names).not.toContain('Tara Admin');
  });
});
