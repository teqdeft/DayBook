// The person's own missing check-outs on Today (CONTRACT 25, item B): the pop-up's rows, the
// self-fix limit, saving within it ("By Priya", audited, HR told only for an earlier payroll
// month), sending a later time to HR as a correction request in the locked transaction, the
// races, "Not now" and the suggestion's signs.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { resetRateLimitsForTests } from '@/lib/route';
import { localToUtc, setNowForTests } from '@/lib/time';
import { activity } from '@/modules/activity';
import { attendance } from '@/modules/attendance';
import { clearSuggestions } from '@/modules/attendance/checkoutSuggest';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { createProject } from './dashboardKit.js';

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
const { POST: postFix } =
  await import('@/app/api/attendance/me/missing-checkouts/[id]/fix/route.js');
const { POST: postHide } = await import('@/app/api/attendance/me/missing-checkouts/hide/route.js');

const TZ = 'Asia/Kolkata';
const TODAY = '2026-11-19'; // Thursday
const FRI = '2026-11-13';
const SAT = '2026-11-14';
const MON = '2026-11-16';
const at = (clock, date = TODAY) => localToUtc(date, clock, TZ).toDate();
const setClock = (clock, date = TODAY) => setNowForTests(at(clock, date).toISOString());

let hr;
let pm;
let acme;

async function missingRow(user, date, { checkIn = '09:32', ...extra } = {}) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(checkIn, date),
    location: 'office',
    officeVerified: true,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: 'missing',
    ...extra,
  });
  return id;
}

async function addSegment(user, state, from, to, date, source = 'system') {
  await db('activitySegments').insert({
    userId: user.id,
    workDate: date,
    state,
    source,
    startedAt: at(from, date),
    endedAt: at(to, date),
  });
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return { code: error.code, message: error.message, fields: error.fields };
  }
  throw new Error('Expected the call to fail');
}

const fix = (user, attendanceId, checkOut, reason) =>
  attendance.fixMyMissingCheckout({ user, attendanceId, checkOut, reason, ip: '198.51.100.7' });

const rowOf = (id) => db('attendance').where({ id }).first();
const notes = (type) => db('notifications').where({ type }).orderBy('id');

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
});

beforeEach(async () => {
  clearSuggestions();
  resetRateLimitsForTests();
  for (const table of ['notifications', 'auditLogs', 'attendanceCorrections', 'timeEntries']) {
    await db(table).del();
  }
  await db('activitySegments').del();
  await db('attendanceBreaks').del();
  await db('attendance').del();
  await setSettings({
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    payroll_month_start_day: 1,
  });
  setClock('10:00');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pop-up's rows", () => {
  it('lists own missing rows of the last 30 days, newest first, with the suggestion and limit', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const other = await createUser({ name: 'Karan Mehta' });
    const fri = await missingRow(priya, FRI);
    const mon = await missingRow(priya, MON, { checkIn: '09:40' });
    await missingRow(priya, '2026-10-19'); // older than 30 days
    await missingRow(other, FRI);
    await addSegment(priya, 'active', '09:32', '18:41', FRI);

    const { items, autoOpen } = await attendance.listMyMissingCheckouts({ user: priya });

    expect(autoOpen).toBe(true);
    expect(items.map((item) => item.attendanceId)).toEqual([mon, fri]);
    expect(items[1]).toMatchObject({
      workDate: FRI,
      checkInClock: '09:32',
      suggestedAt: at('18:41', FRI),
      suggestedClock: '18:41',
      limitClock: '18:56',
      basis: 'suggestion',
    });
    // No screen time: no suggestion, and the limit is the shift end.
    expect(items[0]).toMatchObject({
      suggestedAt: null,
      limitClock: '18:30',
      basis: 'shift_end',
    });
  });

  it('leaves out a row with a pending check_out correction, and untracked people get none', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const id = await missingRow(priya, FRI);
    await db('attendanceCorrections').insert({
      userId: priya.id,
      attendanceId: id,
      workDate: FRI,
      type: 'check_out',
      requestedTime: at('19:10', FRI),
      reason: 'Stayed late',
      status: 'pending',
    });
    expect((await attendance.listMyMissingCheckouts({ user: priya })).items).toEqual([]);
    expect(await attendance.listMyMissingCheckouts({ user: pm })).toEqual({
      items: [],
      autoOpen: false,
    });
  });

  it('uses only finished timer entries: a timer still running from that date gives no sign', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    await missingRow(priya, FRI);
    const entry = { userId: priya.id, workDate: FRI, projectId: acme.id, source: 'timer' };
    await db('timeEntries').insert({ ...entry, startedAt: at('10:00', FRI), endedAt: null });
    let [item] = (await attendance.listMyMissingCheckouts({ user: priya })).items;
    expect(item.suggestedAt).toBeNull();

    clearSuggestions();
    await db('timeEntries').insert({
      ...entry,
      startedAt: at('09:35', FRI),
      endedAt: at('17:10', FRI),
      stopReason: 'stopped',
    });
    [item] = (await attendance.listMyMissingCheckouts({ user: priya })).items;
    expect(item.suggestedClock).toBe('17:10');
  });

  it('"Not now" hides the rows until tomorrow, but keeps them listed', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    await missingRow(priya, FRI);
    expect(await attendance.hideMissingCheckoutPrompt({ user: priya })).toEqual({
      hiddenOn: TODAY,
    });
    const hidden = await attendance.listMyMissingCheckouts({ user: priya });
    expect(hidden.autoOpen).toBe(false);
    expect(hidden.items).toHaveLength(1);

    // A new missing day comes up the morning after it is marked.
    await missingRow(priya, '2026-11-18');
    expect((await attendance.listMyMissingCheckouts({ user: priya })).autoOpen).toBe(true);
    await attendance.hideMissingCheckoutPrompt({ user: priya });
    setClock('09:00', '2026-11-20');
    expect((await attendance.listMyMissingCheckouts({ user: priya })).autoOpen).toBe(true);
  });
});

describe('saving within the limit', () => {
  it("saves 'corrected' with who entered it, audits it, and tells nobody", async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const id = await missingRow(priya, FRI);
    await addSegment(priya, 'active', '09:32', '18:41', FRI);

    const answer = await fix(priya, id, '18:41');

    expect(answer).toMatchObject({ outcome: 'saved', missing: { items: [] } });
    expect(answer.row).toMatchObject({ id, checkoutStatus: 'corrected' });
    expect(await rowOf(id)).toMatchObject({
      checkOutAt: at('18:41', FRI),
      checkoutStatus: 'corrected',
      checkoutEnteredBy: priya.id,
      checkoutEnteredAt: at('10:00'),
      checkoutSuggestedAt: at('18:41', FRI),
    });
    const log = await db('auditLogs').where({ action: 'attendance.self_checkout' }).first();
    expect(log).toMatchObject({
      actorId: priya.id,
      entityType: 'attendance',
      entityId: id,
      reason: 'Entered from Today',
      ip: '198.51.100.7',
    });
    expect(parseJson(log.after)).toMatchObject({
      checkoutStatus: 'corrected',
      suggestedClock: '18:41',
      limitClock: '18:56',
      pastLastSeen: false,
    });
    expect(await db('notifications').count({ n: '*' }).first()).toEqual({ n: 0 });
  });

  it('last seen 1:05 PM, entered 6:30 PM: saved, past last seen, and HR gets the Check tag data', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const id = await missingRow(priya, FRI);
    await addSegment(priya, 'active', '09:32', '13:05', FRI);

    expect((await fix(priya, id, '18:30')).outcome).toBe('saved');

    const log = await db('auditLogs').where({ action: 'attendance.self_checkout' }).first();
    expect(parseJson(log.after)).toMatchObject({ suggestedClock: '13:05', pastLastSeen: true });
    const forHr = (await attendance.listDay(FRI, { viewer: hr })).find(
      (item) => item.user.id === priya.id,
    );
    expect(forHr.checkoutEnteredBy).toMatchObject({
      id: priya.id,
      name: 'Priya Sharma',
      self: true,
      pastLastSeen: true,
      suggestedAt: at('13:05', FRI),
    });
    const forPm = (await attendance.listDay(FRI, { viewer: pm })).find(
      (item) => item.user.id === priya.id,
    );
    expect(forPm.checkoutEnteredBy).toMatchObject({
      self: true,
      pastLastSeen: false,
      suggestedAt: null,
    });
  });

  it('a save for a day in an earlier payroll month tells HR', async () => {
    await setSettings({ payroll_month_start_day: 26 });
    const priya = await createUser({ name: 'Priya Sharma' });
    const october = await missingRow(priya, '2026-10-23'); // Fri, in the October 2026 period
    const november = await missingRow(priya, FRI);

    await fix(priya, november, '18:30');
    expect(await notes('attendance.self_checkout_past')).toHaveLength(0);
    await fix(priya, october, '18:30');

    const [note] = await notes('attendance.self_checkout_past');
    expect(note).toMatchObject({
      userId: hr.id,
      title: 'Priya Sharma entered a check-out for Fri, 23 Oct',
      body: '6:30 PM. That day is in the October 2026 payroll month.',
      link: `/attendance/people/${priya.id}?month=2026-10`,
    });
  });

  it('refuses a check-out before the check-in', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const id = await missingRow(priya, FRI);
    expect(await failure(fix(priya, id, '09:00'))).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { checkOut: 'The check-out must be after the check-in.' },
    });
  });
});

describe('after the limit', () => {
  it('needs a reason, then becomes a check_out request for HR and leaves the pop-up', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const id = await missingRow(priya, FRI);
    await addSegment(priya, 'active', '09:32', '18:41', FRI);

    expect(await failure(fix(priya, id, '19:10'))).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { reason: 'Add a reason for HR.' },
    });
    const answer = await fix(priya, id, '19:10', 'Stayed for the release');

    expect(answer).toMatchObject({ outcome: 'sent', missing: { items: [] } });
    expect(answer.correction).toMatchObject({
      attendanceId: id,
      type: 'check_out',
      status: 'pending',
      reason: 'Stayed for the release',
    });
    expect((await rowOf(id)).checkoutStatus).toBe('missing');
    const told = await notes('attendance_correction.requested');
    expect(told.map((note) => note.userId)).toEqual([hr.id]);
  });

  it('a double tap on Send to HR gives one correction and REQUEST_ALREADY_PENDING', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const id = await missingRow(priya, FRI);
    const results = await Promise.allSettled([
      fix(priya, id, '20:00', 'Stayed late'),
      fix(priya, id, '20:00', 'Stayed late'),
    ]);
    const codes = results.map((result) => result.value?.outcome ?? result.reason.code).sort();
    expect(codes).toEqual(['REQUEST_ALREADY_PENDING', 'sent']);
    expect(await db('attendanceCorrections').count({ n: '*' }).first()).toEqual({ n: 1 });
    expect(await notes('attendance_correction.requested')).toHaveLength(1);
  });

  it('a Saturday check-in of 20 minutes: 6:30 PM goes to HR', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const id = await missingRow(priya, SAT, { checkIn: '10:00', isWorkingDay: false });
    await addSegment(priya, 'active', '10:00', '10:20', SAT);

    const [item] = (await attendance.listMyMissingCheckouts({ user: priya })).items;
    expect(item).toMatchObject({ limitClock: '10:35', basis: 'suggestion' });
    expect((await failure(fix(priya, id, '18:30'))).fields).toEqual({
      reason: 'Add a reason for HR.',
    });
    expect((await fix(priya, id, '18:30', 'Worked on the deploy')).outcome).toBe('sent');
  });
});

describe('refusals and races', () => {
  it("answers NOT_FOUND for someone else's row and an older one, CONFLICT once fixed", async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const karan = await createUser({ name: 'Karan Mehta' });
    const theirs = await missingRow(karan, FRI);
    const old = await missingRow(priya, '2026-10-19');
    const mine = await missingRow(priya, FRI);
    const notFound = { code: 'NOT_FOUND', message: "We couldn't find that missing check-out." };
    expect(await failure(fix(priya, theirs, '18:00'))).toMatchObject(notFound);
    expect(await failure(fix(priya, old, '18:00'))).toMatchObject(notFound);
    expect(await failure(fix(priya, 999999, '18:00'))).toMatchObject(notFound);

    await fix(priya, mine, '18:00');
    expect(await failure(fix(priya, mine, '18:10'))).toMatchObject({
      code: 'CONFLICT',
      message: 'This check-out was just fixed. Refresh to see it.',
    });
  });

  it('two parallel saves give one save and one CONFLICT', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const id = await missingRow(priya, FRI);
    const results = await Promise.allSettled([fix(priya, id, '18:00'), fix(priya, id, '18:10')]);
    const outcomes = results.map((result) => result.value?.outcome ?? result.reason.code).sort();
    expect(outcomes).toEqual(['CONFLICT', 'saved']);
    expect(await db('auditLogs').where({ action: 'attendance.self_checkout' })).toHaveLength(1);
  });

  it('HR fixing at the same moment: exactly one of them saves', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const id = await missingRow(priya, FRI);
    const [self, bulk] = await Promise.allSettled([
      fix(priya, id, '18:00'),
      attendance.fixMissingCheckouts({
        actor: hr,
        items: [{ attendanceId: id, checkOut: '18:20' }],
        reason: 'Confirmed with her PM',
      }),
    ]);
    const row = await rowOf(id);
    if (self.status === 'fulfilled') {
      expect(bulk.value.failed).toEqual([
        { attendanceId: id, field: null, message: 'Already fixed.' },
      ]);
      expect(row).toMatchObject({ checkOutAt: at('18:00', FRI), checkoutEnteredBy: priya.id });
    } else {
      expect(self.reason.code).toBe('CONFLICT');
      expect(bulk.value.fixed).toHaveLength(1);
      expect(row).toMatchObject({ checkOutAt: at('18:20', FRI), checkoutEnteredBy: hr.id });
    }
  });

  it('reads screen time once per row, then keeps the suggestion', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    await missingRow(priya, FRI);
    const spy = vi.spyOn(activity, 'getDay');
    await attendance.listMyMissingCheckouts({ user: priya });
    await attendance.listMyMissingCheckouts({ user: priya });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the routes', () => {
  const EXPIRES = new Date('2026-12-26T04:00:00Z');

  function signInAs(user) {
    sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
    jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
  }

  function call(handler, path, { body, params = {} } = {}) {
    const headers = { Origin: env.appOrigin, 'Content-Type': 'application/json' };
    const request = new Request(`http://localhost:3000${path}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return handler(request, { params: Promise.resolve(params) });
  }

  it('saves through the API and answers the fresh list; ids that are not digits are 404', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const id = await missingRow(priya, FRI);
    signInAs(priya);
    const bad = await call(postFix, '/x', { body: { checkOut: '18:00' }, params: { id: '1e3' } });
    expect(bad.status).toBe(404);
    const empty = await call(postFix, '/x', { body: {}, params: { id: String(id) } });
    expect((await empty.json()).error.fields).toEqual({ checkOut: 'Enter the time you left.' });

    const ok = await call(postFix, '/x', {
      body: { checkOut: '18:00' },
      params: { id: String(id) },
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ outcome: 'saved', missing: { items: [] } });
    const hide = await call(postHide, '/x');
    expect((await hide.json()).data).toEqual({ hiddenOn: TODAY });
  });

  it('is for people with attendance.self, and limits each person to 10 hides a minute', async () => {
    signInAs(pm);
    expect((await call(postHide, '/x')).status).toBe(403);
    const priya = await createUser({ name: 'Priya Sharma' });
    signInAs(priya);
    for (let i = 0; i < 10; i += 1) expect((await call(postHide, '/x')).status).toBe(200);
    expect((await call(postHide, '/x')).status).toBe(429);
  });
});
