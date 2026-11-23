// Missing check-outs for HR (CONTRACT 25, item 7): the full list with paging and its total, the
// suggestions (attendance.correct only, read once per row and kept), the pending corrections and
// reminders beside each row, the rows D's reminders ask about, the bulk fix with its per-row
// failures, who entered a check-out after HR's edits and corrections, and the bulk route.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { resetRateLimitsForTests } from '@/lib/route';
import { localToUtc, setNowForTests } from '@/lib/time';
import { activity } from '@/modules/activity';
import { attendance } from '@/modules/attendance';
import { clearSuggestions } from '@/modules/attendance/checkoutSuggest';
import * as reminderExports from '@/modules/attendance/reminderExports';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

vi.mock('@/modules/attendance/reminderExports', async (importOriginal) => ({
  ...(await importOriginal()),
  listReminders: vi.fn(async () => []),
}));

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
const { POST: postBulk } = await import('@/app/api/attendance/missing-checkouts/fix/route.js');

const TZ = 'Asia/Kolkata';
const TODAY = '2026-11-19'; // Thursday
const at = (clock, date = TODAY) => localToUtc(date, clock, TZ).toDate();
const setClock = (clock, date = TODAY) => setNowForTests(at(clock, date).toISOString());

let hr;
let admin;
let pm;
const people = {};

async function missingRow(user, date, { checkIn = '09:30', ...extra } = {}) {
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

async function activeUntil(user, date, clock) {
  await db('activitySegments').insert({
    userId: user.id,
    workDate: date,
    state: 'active',
    source: 'system',
    startedAt: at('09:30', date),
    endedAt: at(clock, date),
  });
}

async function pendingCheckout(user, date, rowId, clock = '19:10') {
  const [id] = await db('attendanceCorrections').insert({
    userId: user.id,
    attendanceId: rowId,
    workDate: date,
    type: 'check_out',
    requestedTime: at(clock, date),
    reason: 'Stayed late',
    status: 'pending',
  });
  return id;
}

const rows = {};

/** The prototype's list: two on Wed 18 Nov, one each Tue and Mon, two on Fri 13 Nov. */
async function seedList() {
  rows.karan = await missingRow(people.karan, '2026-11-18', { checkIn: '09:24' });
  rows.rohit = await missingRow(people.rohit, '2026-11-18', { checkIn: '10:02' });
  rows.sam = await missingRow(people.sam, '2026-11-17');
  rows.neha = await missingRow(hr, '2026-11-16', { checkIn: '09:21' });
  rows.vishal = await missingRow(people.vishal, '2026-11-16', { checkIn: '09:27' });
  rows.ankit = await missingRow(people.ankit, '2026-11-13', { checkIn: '09:58' });
  rows.priya = await missingRow(people.priya, '2026-11-13', { checkIn: '09:32' });
  rows.admin = await missingRow(admin, '2026-11-12');
  await activeUntil(people.karan, '2026-11-18', '19:12');
  await activeUntil(people.sam, '2026-11-17', '18:35');
  await activeUntil(people.priya, '2026-11-13', '18:41');
  await pendingCheckout(people.sam, '2026-11-17', rows.sam);
}

const names = (list) => list.items.map((item) => item.user.name);

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  admin = await createUser({ name: 'Asha Admin', role: 'admin' });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  for (const [key, name] of [
    ['karan', 'Karan Mehta'],
    ['rohit', 'Rohit Verma'],
    ['sam', 'Sam Lee'],
    ['vishal', 'Vishal Saini'],
    ['ankit', 'Ankit Rana'],
    ['priya', 'Priya Sharma'],
  ]) {
    people[key] = await createUser({ name });
  }
});

beforeEach(async () => {
  clearSuggestions();
  resetRateLimitsForTests();
  vi.mocked(reminderExports.listReminders).mockReset();
  vi.mocked(reminderExports.listReminders).mockResolvedValue([]);
  for (const table of ['notifications', 'auditLogs', 'attendanceCorrections', 'holidays']) {
    await db(table).del();
  }
  await db('activitySegments').del();
  await db('attendance').del();
  await setSettings({ working_days: [1, 2, 3, 4, 5], office_end: '18:30' });
  setClock('10:30');
  await seedList();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the full list', () => {
  it('pages newest day first, then name, and its total matches the KPI footer', async () => {
    const page = (offset) => attendance.listMissingCheckouts({ viewer: hr, limit: 3, offset });
    expect(names(await page(0))).toEqual(['Karan Mehta', 'Rohit Verma', 'Sam Lee']);
    expect(names(await page(3))).toEqual(['Neha Kapoor', 'Vishal Saini', 'Ankit Rana']);
    const last = await page(6);
    expect(names(last)).toEqual(['Priya Sharma']);
    expect(last.total).toBe(7);
    expect((await attendance.getDaySummary(TODAY, { viewer: hr })).missingTotal).toBe(7);
    // An Admin also sees the Admin's row.
    expect((await attendance.listMissingCheckouts({ viewer: admin, limit: 50 })).total).toBe(8);
  });

  it('marks own rows and pending corrections; PMs get neither suggestions nor HR marks', async () => {
    const list = await attendance.listMissingCheckouts({ viewer: hr, limit: 50, suggest: true });
    const byName = new Map(list.items.map((item) => [item.user.name, item]));
    expect(byName.get('Neha Kapoor').own).toBe(true);
    expect(byName.get('Karan Mehta')).toMatchObject({
      own: false,
      suggestedAt: at('19:12', '2026-11-18'),
      pendingCorrection: null,
    });
    expect(byName.get('Sam Lee').pendingCorrection).toMatchObject({ checkOutClock: '19:10' });
    expect(byName.get('Rohit Verma').suggestedAt).toBeNull();

    const forPm = await attendance.listMissingCheckouts({ viewer: pm, limit: 50 });
    const sam = forPm.items.find((item) => item.user.name === 'Sam Lee');
    expect(sam).not.toHaveProperty('suggestedAt');
    expect(sam).toMatchObject({ pendingCorrection: null, reminded: null });
  });

  it('reads screen time once per row with activity.getDay, then keeps each suggestion', async () => {
    const spy = vi.spyOn(activity, 'getDay');
    await attendance.listMissingCheckouts({ viewer: hr, limit: 50, suggest: true });
    expect(spy).toHaveBeenCalledTimes(7);
    await attendance.listMissingCheckouts({ viewer: hr, limit: 50, suggest: true });
    expect(spy).toHaveBeenCalledTimes(7);
    attendance.forgetSuggestion(rows.karan);
    await attendance.listMissingCheckouts({ viewer: hr, limit: 5, suggest: true });
    expect(spy).toHaveBeenCalledTimes(8);
  });

  it("shows each row's latest reminder sent on or after the row's date", async () => {
    const neha = { id: hr.id, name: 'Neha Kapoor' };
    vi.mocked(reminderExports.listReminders).mockResolvedValue([
      { userId: people.karan.id, kind: 'missing_checkout', sentAt: at('10:05'), sentBy: neha },
      {
        userId: people.priya.id,
        kind: 'missing_checkout',
        sentAt: at('11:00', '2026-11-17'),
        sentBy: neha,
      },
      // Before Rohit's missing day: not about it.
      {
        userId: people.rohit.id,
        kind: 'missing_checkout',
        sentAt: at('11:00', '2026-11-17'),
        sentBy: null,
      },
    ]);
    const list = await attendance.listMissingCheckouts({ viewer: hr, limit: 50 });
    const reminded = Object.fromEntries(list.items.map((item) => [item.user.name, item.reminded]));
    expect(reminded['Karan Mehta']).toEqual({ sentAt: at('10:05'), sentBy: neha });
    expect(reminded['Priya Sharma']).toEqual({ sentAt: at('11:00', '2026-11-17'), sentBy: neha });
    expect(reminded['Rohit Verma']).toBeNull();
    expect(reminderExports.listReminders).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ['missing_checkout'], since: at('00:00', '2026-11-13') }),
    );
  });

  it('missingCheckoutsFor leaves out a row with a pending check_out correction', async () => {
    const map = await attendance.missingCheckoutsFor([
      people.karan.id,
      people.sam.id,
      people.priya.id,
    ]);
    expect([...map.keys()].sort()).toEqual([people.karan.id, people.priya.id].sort());
    expect(map.get(people.karan.id)).toEqual([
      { attendanceId: rows.karan, workDate: '2026-11-18' },
    ]);
    expect(await attendance.missingCheckoutsFor([])).toEqual(new Map());
  });
});

describe('the bulk fix', () => {
  const reason = "Used Daybook's suggested time.";

  it('saves each row with its time and reports the others row by row', async () => {
    const result = await attendance.fixMissingCheckouts({
      actor: hr,
      reason,
      ip: '203.0.113.9',
      items: [
        { attendanceId: rows.karan, checkOut: '19:12' }, // the suggestion
        { attendanceId: rows.rohit, checkOut: '18:00' }, // typed, no suggestion
        { attendanceId: rows.sam, checkOut: '18:35' },
        { attendanceId: rows.neha, checkOut: '18:30' },
        { attendanceId: rows.admin, checkOut: '18:30' },
        { attendanceId: rows.vishal, checkOut: '' },
        { attendanceId: rows.ankit, checkOut: '09:00' },
      ],
    });

    expect(result.fixed).toEqual([
      { attendanceId: rows.karan, checkOutAt: at('19:12', '2026-11-18') },
      { attendanceId: rows.rohit, checkOutAt: at('18:00', '2026-11-18') },
    ]);
    expect(result.failed).toEqual([
      { attendanceId: rows.sam, field: null, message: 'Handle it under Corrections.' },
      {
        attendanceId: rows.neha,
        field: null,
        message: "You can't change your own attendance. Ask another HR person or an Admin.",
      },
      { attendanceId: rows.admin, field: null, message: 'That attendance row no longer exists.' },
      { attendanceId: rows.vishal, field: 'checkOut', message: 'Add a time.' },
      {
        attendanceId: rows.ankit,
        field: 'checkOut',
        message: 'The check-out must be after the check-in.',
      },
    ]);
  });

  it('audits, tells the person and names HR as who entered it', async () => {
    await attendance.fixMissingCheckouts({
      actor: hr,
      reason,
      ip: '203.0.113.9',
      items: [
        { attendanceId: rows.karan, checkOut: '19:12' },
        { attendanceId: rows.rohit, checkOut: '18:00' },
      ],
    });
    expect(await db('attendance').where({ id: rows.karan }).first()).toMatchObject({
      checkoutStatus: 'corrected',
      checkOutAt: at('19:12', '2026-11-18'),
      checkoutEnteredBy: hr.id,
      checkoutEnteredAt: at('10:30'),
      checkoutSuggestedAt: null,
    });
    const logs = await db('auditLogs').where({ action: 'attendance.fix_missing' }).orderBy('id');
    expect(logs.map((log) => [log.entityId, parseJson(log.after).suggested])).toEqual([
      [rows.karan, true],
      [rows.rohit, false],
    ]);
    expect(logs[0]).toMatchObject({ actorId: hr.id, reason, ip: '203.0.113.9' });
    const told = await db('notifications')
      .where({ type: 'attendance.edited', userId: people.karan.id })
      .first();
    expect(told).toMatchObject({
      title: 'Neha Kapoor entered your check-out for Wed, 18 Nov',
      body: '7:12 PM.',
      link: '/log?month=2026-11',
    });
    const entered = await attendance.checkoutEnteredFor([rows.karan]);
    expect(entered.get(rows.karan)).toMatchObject({ by: { id: hr.id }, self: false });
  });

  it("lets an Admin fix an Admin's row, needs a reason and 1 to 50 rows", async () => {
    const other = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
    const done = await attendance.fixMissingCheckouts({
      actor: other,
      reason: 'Checked the gate log',
      items: [{ attendanceId: rows.admin, checkOut: '18:30' }],
    });
    expect(done.fixed).toHaveLength(1);
    const call = (input) => attendance.fixMissingCheckouts({ actor: hr, ...input });
    await expect(
      call({ reason: ' ', items: [{ attendanceId: rows.karan, checkOut: '19:00' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', fields: { reason: 'Add a reason.' } });
    await expect(call({ reason, items: [] })).rejects.toMatchObject({
      fields: { items: 'Pick 1 to 50 check-outs.' },
    });
  });
});

describe('who entered a check-out', () => {
  it("HR's Edit of a missing row names HR", async () => {
    await attendance.updateRow({
      actor: hr,
      id: rows.vishal,
      checkOut: '18:52',
      reason: 'Gate log',
    });
    expect(await db('attendance').where({ id: rows.vishal }).first()).toMatchObject({
      checkoutStatus: 'corrected',
      checkoutEnteredBy: hr.id,
      checkoutSuggestedAt: null,
    });
  });

  it('a self-fix then an HR Edit reads "By Neha"; an approved correction clears it', async () => {
    const priya = people.priya;
    await attendance.fixMyMissingCheckout({
      user: priya,
      attendanceId: rows.priya,
      checkOut: '18:41',
    });
    let row = await db('attendance').where({ id: rows.priya }).first();
    expect(row).toMatchObject({
      checkoutEnteredBy: priya.id,
      checkoutSuggestedAt: at('18:41', '2026-11-13'),
    });

    await attendance.updateRow({
      actor: hr,
      id: rows.priya,
      checkOut: '18:45',
      reason: 'Gate log',
    });
    row = await db('attendance').where({ id: rows.priya }).first();
    expect(row).toMatchObject({ checkoutEnteredBy: hr.id, checkoutSuggestedAt: null });
    const entered = (await attendance.checkoutEnteredFor([rows.priya])).get(rows.priya);
    expect(entered).toMatchObject({ by: { name: 'Neha Kapoor' }, self: false });

    const correction = await attendance.requestCorrection({
      user: priya,
      type: 'check_out',
      workDate: '2026-11-13',
      checkOut: '19:00',
      reason: 'I left at seven',
    });
    await attendance.approveCorrection({ actor: hr, id: correction.id });
    row = await db('attendance').where({ id: rows.priya }).first();
    expect(row).toMatchObject({
      checkOutAt: at('19:00', '2026-11-13'),
      checkoutEnteredBy: null,
      checkoutEnteredAt: null,
      checkoutSuggestedAt: null,
    });
  });
});

describe('the missing window', () => {
  it('skips a holiday Friday', async () => {
    expect(attendance.missingWindow('2026-11-23', [1, 2, 3, 4, 5], ['2026-11-20'])).toEqual({
      from: '2026-11-19',
      to: '2026-11-22',
    });
    await db('holidays').insert({ holidayDate: '2026-11-20', name: 'Guru Nanak Jayanti' });
    await missingRow(people.priya, '2026-11-19');
    setClock('10:00', '2026-11-23');
    expect(await attendance.getDaySummary('2026-11-23', { viewer: hr })).toMatchObject({
      missingCheckouts: 1,
      missingFromDate: '2026-11-19',
    });
  });
});

describe('POST /api/attendance/missing-checkouts/fix', () => {
  const EXPIRES = new Date('2026-12-26T04:00:00Z');

  function signInAs(user) {
    sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
    jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
  }

  function post(body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const request = new Request('http://localhost:3000/api/attendance/missing-checkouts/fix', {
      method: 'POST',
      headers: { Origin: env.appOrigin, 'Content-Type': 'application/json' },
      body: text,
    });
    return postBulk(request, { params: Promise.resolve({}) });
  }

  it('answers 200 with per-row results, even when every row fails', async () => {
    signInAs(hr);
    const response = await post({
      reason: 'Gate log',
      items: [{ attendanceId: rows.sam, checkOut: '18:35' }],
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      fixed: [],
      failed: [{ attendanceId: rows.sam, field: null, message: 'Handle it under Corrections.' }],
    });
  });

  it('refuses PMs, over 50 rows, a short reason and a body over 16 KB', async () => {
    signInAs(pm);
    expect((await post({ reason: 'Gate log', items: [] })).status).toBe(403);
    signInAs(hr);
    const many = Array.from({ length: 51 }, (_, i) => ({ attendanceId: i + 1, checkOut: '18:00' }));
    const tooMany = await post({ reason: 'Gate log', items: many });
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error.fields).toEqual({
      items: 'Fix up to 50 check-outs at a time.',
    });
    const short = await post({
      reason: 'x',
      items: [{ attendanceId: rows.karan, checkOut: '19:00' }],
    });
    expect((await short.json()).error.fields).toEqual({ reason: 'Add a reason.' });
    const big = await post({ reason: 'x'.repeat(17 * 1024), items: [] });
    expect(big.status).toBe(413);
  });

  it('limits each person to 10 a minute', async () => {
    signInAs(hr);
    const body = { reason: 'Gate log', items: [{ attendanceId: rows.sam, checkOut: '18:35' }] };
    for (let i = 0; i < 10; i += 1) expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(429);
  });
});
