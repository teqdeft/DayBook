// Two guards around missing check-outs (CONTRACT 25, items 2, B and 7):
// 1. A break fix forgets the row's kept suggested check-out (the per-process Map), so the HR
//    list, Today's pop-up and the self-fix limit work from the fixed breaks, not a stale time.
// 2. HR's single-row Fix and Edit (PATCH /api/attendance/:id, hr.updateRow) refuse a missing
//    check-out the person already sent HR a time for, as the bulk fix does ("Handle it under
//    Corrections."), so approving the request later never overwrites HR's time unseen.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { localToUtc, setNowForTests, toLocal } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { clearSuggestions } from '@/modules/attendance/checkoutSuggest';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { caught } from './timersKit.js';

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
const rowRoute = await import('@/app/api/attendance/[id]/route.js');

const TZ = 'Asia/Kolkata';
const TODAY = '2026-11-19'; // Thursday
const FRIDAY = '2026-11-13';
const EXPIRES = new Date('2026-12-26T04:00:00Z');
const HANDLE = 'Handle it under Corrections.';
const at = (clock, date = TODAY) => localToUtc(date, clock, TZ).toDate();

let neha;
let ravi;
let priya;
let rowId;

/** Priya's Friday: checked in 9:32, worked until 5 PM, no check-out. */
async function missingFriday() {
  const [id] = await db('attendance').insert({
    userId: priya.id,
    workDate: FRIDAY,
    checkInAt: at('09:32', FRIDAY),
    location: 'office',
    officeVerified: true,
    lateMinutes: 2,
    isWorkingDay: true,
    checkoutStatus: 'missing',
  });
  await db('activitySegments').insert({
    userId: priya.id,
    workDate: FRIDAY,
    state: 'active',
    source: 'system',
    startedAt: at('09:32', FRIDAY),
    endedAt: at('17:00', FRIDAY),
  });
  return id;
}

/** A break of Priya's Friday; its end counts as "last seen". */
async function addBreak(from, to) {
  const [id] = await db('attendanceBreaks').insert({
    userId: priya.id,
    attendanceId: rowId,
    workDate: FRIDAY,
    startedAt: at(from, FRIDAY),
    endedAt: at(to, FRIDAY),
    endReason: 'self',
  });
  return id;
}

/** The suggestion HR's list shows for Priya's Friday ('HH:mm'), or null. */
async function listed() {
  const list = await attendance.listMissingCheckouts({ viewer: neha, limit: 50, suggest: true });
  const item = list.items.find((row) => row.id === rowId);
  return item.suggestedAt ? toLocal(item.suggestedAt, TZ).format('HH:mm') : null;
}

/** Priya's own pop-up line for Friday: the suggestion and the self-fix limit. */
async function popup() {
  const { items } = await attendance.listMyMissingCheckouts({ user: priya });
  const item = items.find((row) => row.attendanceId === rowId);
  return { suggested: item.suggestedClock, limit: item.limitClock };
}

function patch(user, body) {
  sessionUser = { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
  const request = new Request(`http://localhost:3000/api/attendance/${rowId}`, {
    method: 'PATCH',
    headers: { Origin: env.appOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return rowRoute.PATCH(request, { params: Promise.resolve({ id: String(rowId) }) });
}

beforeAll(async () => {
  await resetDatabase();
  neha = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  ravi = await createUser({ name: 'Ravi Kapoor', role: 'hr' });
  priya = await createUser({ name: 'Priya Sharma' });
});

beforeEach(async () => {
  clearSuggestions();
  resetRateLimitsForTests();
  for (const table of ['notifications', 'auditLogs', 'attendanceCorrections']) {
    await db(table).del();
  }
  await db('attendanceBreaks').del();
  await db('activitySegments').del();
  await db('attendance').del();
  await setSettings({ working_days: [1, 2, 3, 4, 5], office_end: '18:30' });
  setNowForTests(at('10:30').toISOString());
  rowId = await missingFriday();
});

describe('a break fix forgets the kept suggestion', () => {
  it('HR deletes a wrong break: the list, the pop-up and the limit follow at once', async () => {
    const breakId = await addBreak('17:00', '21:00');
    expect(await listed()).toBe('21:00');
    expect(await popup()).toEqual({ suggested: '21:00', limit: '21:15' });

    await attendance.deleteBreak({ actor: neha, attendanceId: rowId, breakId, reason: 'Wrong' });
    expect(await listed()).toBe('17:00');
    expect(await popup()).toEqual({ suggested: '17:00', limit: '18:30' });

    // 9:10 PM is past the new limit: it goes to HR, never saved straight away.
    const late = await caught(
      attendance.fixMyMissingCheckout({ user: priya, attendanceId: rowId, checkOut: '21:10' }),
    );
    expect(late).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { reason: 'Add a reason for HR.' },
    });
    expect(await db('attendance').where({ id: rowId }).first()).toMatchObject({
      checkoutStatus: 'missing',
    });
  });

  it("HR changes a break's end: the suggestion moves with it", async () => {
    const breakId = await addBreak('17:00', '21:00');
    expect(await listed()).toBe('21:00');
    await attendance.changeBreakEnd({
      actor: neha,
      attendanceId: rowId,
      breakId,
      endClock: '17:40',
      reason: 'Back at 5:40',
    });
    expect(await listed()).toBe('17:40');
  });
});

describe("HR's single-row Fix and Edit of a missing check-out with a pending request", () => {
  async function requestTime() {
    return attendance.requestCorrection({
      user: priya,
      type: 'check_out',
      workDate: FRIDAY,
      checkOut: '21:00',
      reason: 'I stayed for the release',
    });
  }

  it('refuses under the Check-out field, and approving the request still works', async () => {
    const request = await requestTime();
    for (const change of [{ checkOut: '18:20' }, { checkIn: '09:40' }, { location: 'wfh' }]) {
      const refused = await caught(
        attendance.updateRow({ actor: neha, id: rowId, reason: 'Gate log', ...change }),
      );
      expect(refused).toMatchObject({
        code: 'CONFLICT',
        message: HANDLE,
        fields: { checkOut: HANDLE },
      });
    }
    expect(await db('attendance').where({ id: rowId }).first()).toMatchObject({
      checkoutStatus: 'missing',
      checkOutAt: null,
      checkInAt: at('09:32', FRIDAY),
      checkoutEnteredBy: null,
    });
    expect(await db('auditLogs').where({ action: 'attendance.edit' })).toEqual([]);

    await attendance.approveCorrection({ actor: ravi, id: request.id });
    expect(await db('attendance').where({ id: rowId }).first()).toMatchObject({
      checkoutStatus: 'corrected',
      checkOutAt: at('21:00', FRIDAY),
    });
  });

  it('PATCH /api/attendance/:id answers 409 with the message on checkOut', async () => {
    await requestTime();
    const response = await patch(neha, { checkOut: '18:20', reason: 'Gate log' });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({
      code: 'CONFLICT',
      message: HANDLE,
      fields: { checkOut: HANDLE },
    });
  });

  it('still fixes the row once the request is rejected, and a row without one as before', async () => {
    const request = await requestTime();
    await attendance.rejectCorrection({ actor: ravi, id: request.id, note: 'Gate log says 6' });
    const saved = await attendance.updateRow({
      actor: neha,
      id: rowId,
      checkOut: '18:20',
      reason: 'Gate log',
    });
    expect(saved).toMatchObject({ checkoutStatus: 'corrected', checkOutAt: at('18:20', FRIDAY) });
    expect(await db('attendance').where({ id: rowId }).first()).toMatchObject({
      checkoutEnteredBy: neha.id,
    });
  });

  it('a pending check-in request does not stop the check-out fix', async () => {
    await attendance.requestCorrection({
      user: priya,
      type: 'check_in',
      workDate: FRIDAY,
      checkIn: '09:15',
      reason: 'The door was stuck',
    });
    const saved = await attendance.updateRow({
      actor: neha,
      id: rowId,
      checkOut: '18:20',
      reason: 'Gate log',
    });
    expect(saved).toMatchObject({ checkoutStatus: 'corrected', checkOutAt: at('18:20', FRIDAY) });
  });
});
