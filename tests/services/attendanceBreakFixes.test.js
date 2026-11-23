// HR's break list and break fixes (CONTRACT 25, item 2), on the real modules and routes: the list
// and its words, Change end (a forgotten open break, a check-out-ended one), every validation
// message, Delete, audit rows on the attendance row, the person's notification, who may do what,
// On break on the day list and the per-person rate limit.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { at, caught, insertEntry, setClock } from './timersKit.js';

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
const { resetRateLimitsForTests } = await import('@/lib/route');
const listRoute = await import('@/app/api/attendance/[id]/breaks/route.js');
const fixRoute = await import('@/app/api/attendance/[id]/breaks/[breakId]/route.js');

const TODAY = '2026-11-19'; // Thursday
const YESTERDAY = '2026-11-18';
const EXPIRES = new Date('2026-12-26T04:00:00Z');
const OWN = "You can't change your own attendance. Ask another HR person or an Admin.";

let neha;
let pm;
let ada;
let tia;
let priya;
let karan;
let acme;
let rows;
let ids;

const plus30s = (clock, date) => new Date(at(clock, date).getTime() + 30_000);

async function addBreak(user, date, from, to, extra = {}) {
  const row = await db('attendance').where({ userId: user.id, workDate: date }).first();
  const [id] = await db('attendanceBreaks').insert({
    userId: user.id,
    attendanceId: row.id,
    workDate: date,
    startedAt: from instanceof Date ? from : at(from, date),
    endedAt: to === null ? null : to instanceof Date ? to : at(to, date),
    endReason: to === null ? null : 'self',
    ...extra,
  });
  return id;
}

function signInAs(user) {
  sessionUser = user && { ...user, status: 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function call(handler, { method, rowId, breakId, body }) {
  const path = `/api/attendance/${rowId}/breaks${breakId ? `/${breakId}` : ''}`;
  const request = new Request(`${env.appOrigin}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: env.appOrigin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const params = { id: String(rowId), ...(breakId ? { breakId: String(breakId) } : {}) };
  const response = await handler(request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() };
}

const list = (rowId) => call(listRoute.GET, { method: 'GET', rowId });
const change = (rowId, breakId, body) =>
  call(fixRoute.PATCH, { method: 'PATCH', rowId, breakId, body });
const remove = (rowId, breakId, body) =>
  call(fixRoute.DELETE, { method: 'DELETE', rowId, breakId, body });
const fixEnd = (actor, rowId, breakId, endClock, reason = 'Forgot to end it after lunch.') =>
  attendance.changeBreakEnd({ actor, attendanceId: rowId, breakId, endClock, reason });

beforeAll(async () => {
  await resetDatabase();
  await setSettings({ timers_mode: 'optional', break_allowance_minutes: 60 });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  neha = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  ada = await createUser({ name: 'Ada Admin', role: 'admin' });
  tia = await createUser({ name: 'Tia Admin', role: 'admin' });
  priya = await createUser({ name: 'Priya Sharma' });
  karan = await createUser({ name: 'Karan Mehta' });
  acme = await createProject(pm, { name: 'acme-app' });
  await addMembers(acme, [priya, karan]);
  for (const user of [neha, tia, priya]) await checkIn(user, TODAY, { in: '09:30' });
  await checkIn(karan, YESTERDAY, { in: '09:30', out: '18:30' });
  // Priya today: a break a timer ended, time removed from her timer, and a forgotten break.
  await insertEntry(priya, acme, { from: '09:30', to: '10:30', stopReason: 'break' });
  await insertEntry(priya, acme, { from: '10:40', to: '12:05', stopReason: 'away' });
  const paused = await insertEntry(priya, acme, {
    from: '12:20',
    to: '13:10',
    stopReason: 'break',
  });
  ids = {
    timerEnded: await addBreak(priya, TODAY, '10:30', '10:40', { endReason: 'timer' }),
    away: await addBreak(priya, TODAY, '12:05', '12:20', { endReason: 'away', source: 'away' }),
    open: await addBreak(priya, TODAY, '13:10', null, { pausedEntryId: paused }),
  };
  // Karan yesterday: a break a timer ended at 2:00 PM, and one check-out ended.
  await insertEntry(karan, acme, {
    from: '09:30',
    to: '13:30',
    stopReason: 'break',
    date: YESTERDAY,
  });
  await insertEntry(karan, acme, {
    from: '14:00',
    to: '17:00',
    stopReason: 'break',
    date: YESTERDAY,
  });
  ids.karanTimer = await addBreak(karan, YESTERDAY, plus30s('13:30', YESTERDAY), '14:00', {
    endReason: 'timer',
  });
  ids.karanOut = await addBreak(karan, YESTERDAY, '17:00', '18:30', { endReason: 'checkout' });
  ids.neha = await addBreak(neha, TODAY, '11:00', '11:15');
  ids.tia = await addBreak(tia, TODAY, '11:00', '11:15');
  rows = Object.fromEntries(
    await Promise.all(
      [
        ['priya', priya, TODAY],
        ['karan', karan, YESTERDAY],
        ['neha', neha, TODAY],
        ['tia', tia, TODAY],
      ].map(async ([key, user, date]) => [
        key,
        (await db('attendance').where({ userId: user.id, workDate: date }).first()).id,
      ]),
    ),
  );
});

beforeEach(() => {
  jar.clear();
  sessionUser = null;
  resetRateLimitsForTests();
  setClock('14:30', TODAY);
});

describe('the break list', () => {
  it("shows a row's breaks with their words, for HR", async () => {
    const data = await attendance.listBreaksForRow({ viewer: neha, attendanceId: rows.priya });
    expect(data).toMatchObject({
      attendanceId: rows.priya,
      workDate: TODAY,
      dayLabel: 'Thu, 19 Nov',
      isToday: true,
      person: { id: priya.id, name: 'Priya Sharma' },
      breakMinutes: 105,
      overAllowanceMinutes: 45,
      onBreakSince: at('13:10', TODAY).toISOString(),
      description: 'Thu, 19 Nov · On break since 1:10 · Breaks 1h 45m · Over 45m',
      canCorrect: true,
      canChange: true,
      ownRow: false,
      needsUpdate: false,
    });
    expect(data.breaks.map((item) => [item.startClock, item.endClock, item.minutes])).toEqual([
      ['10:30', '10:40', 10],
      ['12:05', '12:20', 15],
      ['13:10', null, 80],
    ]);
    expect(data.breaks.map((item) => [item.label, item.note])).toEqual([
      ['Break', 'Ended when a timer started'],
      ['Away, removed from timer', null],
      ['On break now', null],
    ]);
    // HR never sees the project or any screen time here.
    expect(JSON.stringify(data)).not.toMatch(/acme|segment|projectName/);
  });

  it('is read only for a PM and for HR on their own row; an employee may not read it', async () => {
    signInAs(pm);
    const read = await list(rows.priya);
    expect(read.status).toBe(200);
    expect(read.json.data).toMatchObject({ canCorrect: false, canChange: false });
    const own = await attendance.listBreaksForRow({ viewer: neha, attendanceId: rows.neha });
    expect(own).toMatchObject({ ownRow: true, canChange: false });
    signInAs(priya);
    expect((await list(rows.priya)).status).toBe(403);
  });

  it("hides an Admin's row from HR; an Admin sees it", async () => {
    signInAs(neha);
    expect((await list(rows.tia)).json.error.code).toBe('NOT_FOUND');
    signInAs(ada);
    expect((await list(rows.tia)).status).toBe(200);
    expect((await list(999999)).status).toBe(404);
    expect((await list('abc')).status).toBe(404);
  });

  it('shows who is on a break on the day list', async () => {
    const items = await attendance.listDay(TODAY, { viewer: neha });
    const item = items.find((entry) => entry.user.id === priya.id);
    expect(item).toMatchObject({ onBreakSince: at('13:10', TODAY), breakCount: 3 });
    expect(attendance.filterDay(items, 'on_break').map((entry) => entry.user.id)).toEqual([
      priya.id,
    ]);
    expect(attendance.summarize(items, { count: 0 }).onBreak).toBe(1);
  });
});

describe('Change end', () => {
  it('every validation message', async () => {
    const message = async (clock, breakId = ids.karanTimer, rowId = rows.karan) =>
      (await caught(fixEnd(neha, rowId, breakId, clock))).fields.endClock;
    expect(await message('13:30')).toBe('End must be after the start.');
    expect(await message('13:31')).toBe('Add at least 1 minute.');
    expect(await message('15:00', ids.open, rows.priya)).toBe("That time hasn't come yet.");
    expect(await message('18:45', ids.karanOut)).toBe(
      'The break must end by the check-out (6:30 PM).',
    );
    expect(await message('14:00')).toBe("That's already the end time.");
    expect(await message('17:10')).toBe('That overlaps another break (5:00 to 6:30 PM).');
    expect(await message('14:05')).toBe('A timer started at 2:00 PM. Pick 2:00 PM or earlier.');
    const noReason = await caught(fixEnd(neha, rows.karan, ids.karanTimer, '13:50', '  '));
    expect(noReason).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { reason: 'Add a reason.' },
    });
  });

  it('ends a forgotten open break (end reason hr, no timer resumed), audited and told', async () => {
    const data = await fixEnd(neha, rows.priya, ids.open, '14:00');
    const ended = data.breaks.find((item) => item.id === ids.open);
    expect(ended).toMatchObject({
      endClock: '14:00',
      endReason: 'hr',
      open: false,
      note: 'Changed by Neha Kapoor',
      changedBy: { id: neha.id, name: 'Neha Kapoor' },
    });
    expect(data).toMatchObject({ onBreakSince: null, breakMinutes: 75 });
    const saved = await db('attendanceBreaks').where({ id: ids.open }).first();
    expect(saved).toMatchObject({ endReason: 'hr', changedById: neha.id, source: 'self' });
    expect(await db('timeEntries').where({ userId: priya.id }).whereNull('endedAt')).toEqual([]);
    const [logged] = await db('auditLogs').where({ action: 'attendance.break_change' });
    expect(logged).toMatchObject({
      actorId: neha.id,
      entityType: 'attendance',
      entityId: rows.priya,
      reason: 'Forgot to end it after lunch.',
    });
    expect(JSON.parse(logged.before)).toMatchObject({ breakId: ids.open, endedAt: null });
    const told = await db('notifications').where({ userId: priya.id, type: 'attendance.edited' });
    expect(told.map((item) => [item.title, item.link])).toEqual([
      ['Neha Kapoor changed a break in your attendance for Thu, 19 Nov', '/log?month=2026-11'],
    ]);
    // HR fixes never send the allowance notice.
    const over = await db('notifications').where({ type: 'attendance.break_over_allowance' });
    expect(over).toEqual([]);
  });

  it('shortens a check-out-ended break through the route', async () => {
    signInAs(neha);
    const done = await change(rows.karan, ids.karanOut, {
      endClock: '18:00',
      reason: 'Left the break at 6.',
    });
    expect(done.status).toBe(200);
    expect(done.json.data.breaks.at(-1)).toMatchObject({ endClock: '18:00', endReason: 'hr' });
    const bad = await change(rows.karan, ids.karanOut, { endClock: 'soon', reason: 'x' });
    expect(bad.json.error.fields).toEqual({ endClock: 'Enter the end time.' });
  });

  it('refuses HR on their own row, a PM and an employee; an Admin may fix an Admin', async () => {
    expect(await caught(fixEnd(neha, rows.neha, ids.neha, '11:10'))).toMatchObject({
      code: 'FORBIDDEN',
      message: OWN,
    });
    expect((await caught(fixEnd(neha, rows.tia, ids.tia, '11:10'))).code).toBe('NOT_FOUND');
    signInAs(pm);
    expect((await change(rows.priya, ids.away, { endClock: '12:15', reason: 'x' })).status).toBe(
      403,
    );
    signInAs(priya);
    expect((await change(rows.priya, ids.away, { endClock: '12:15', reason: 'x' })).status).toBe(
      403,
    );
    const fixed = await fixEnd(ada, rows.tia, ids.tia, '11:10');
    expect(fixed.breaks[0]).toMatchObject({ endClock: '11:10', note: 'Changed by Ada Admin' });
    expect((await caught(fixEnd(neha, rows.priya, ids.neha, '11:10'))).code).toBe('NOT_FOUND');
  });
});

describe('Delete', () => {
  it('deletes a break with a reason, audited and told', async () => {
    signInAs(neha);
    const done = await remove(rows.karan, ids.karanTimer, { reason: 'Not a break.' });
    expect(done.status).toBe(200);
    expect(done.json.data.breaks.map((item) => item.id)).toEqual([ids.karanOut]);
    const [logged] = await db('auditLogs').where({ action: 'attendance.break_delete' });
    expect(logged).toMatchObject({ entityId: rows.karan, reason: 'Not a break.' });
    expect(JSON.parse(logged.before)).toMatchObject({ breakId: ids.karanTimer, source: 'self' });
    const told = await db('notifications').where({ userId: karan.id, type: 'attendance.edited' });
    expect(told.at(-1).title).toBe(
      'Neha Kapoor deleted a break from your attendance for Wed, 18 Nov',
    );
    expect((await remove(rows.karan, ids.karanTimer, { reason: 'Again.' })).status).toBe(404);
    expect((await remove(rows.karan, ids.karanOut, {})).json.error.fields).toEqual({
      reason: 'Add a reason.',
    });
  });
});

describe('rate limits', () => {
  it('allows 120 reads a minute per person', async () => {
    signInAs(pm);
    for (let index = 0; index < 120; index += 1) {
      expect((await list(rows.priya)).status).toBe(200);
    }
    expect((await list(rows.priya)).status).toBe(429);
    signInAs(neha);
    expect((await list(rows.priya)).status).toBe(200);
  });
});
