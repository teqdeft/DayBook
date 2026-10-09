// Break API (CONTRACT 15): POST /api/attendance/break/start and /end — who may call them
// (attendance.self: employees, HR, tracked Admin; never PMs), the Origin check and the answers.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase } from '../helpers/db.js';

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
const { POST: postStart } = await import('@/app/api/attendance/break/start/route.js');
const { POST: postEnd } = await import('@/app/api/attendance/break/end/route.js');

const NOW = '2026-09-30T07:30:00Z'; // 1:00 PM in Asia/Kolkata
const EXPIRES = new Date('2026-10-26T04:00:00Z');
let employee;
let hr;
let pm;
let ceo;

function signInAs(user) {
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

function post(handler, path, { origin = env.appOrigin, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const request = new Request(`http://localhost:3000/api/attendance/break/${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(request, { params: Promise.resolve({}) });
}

const start = (options) => post(postStart, 'start', options);
const end = (options) => post(postEnd, 'end', options);

async function errorOf(response) {
  return (await response.json()).error;
}

beforeAll(async () => {
  await resetDatabase();
  employee = await createUser({ name: 'Vishal Saini' });
  hr = await createUser({ name: 'Neha Gupta', role: 'hr', department: 'HR' });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  ceo = await createUser({ name: 'Cee Eo', role: 'admin', tracksAttendance: false });
  setNowForTests('2026-09-30T04:00:00Z'); // 9:30 AM
  await attendance.checkIn({ user: employee, ip: null });
  await attendance.checkIn({ user: hr, ip: null });
});

beforeEach(() => {
  jar.clear();
  sessionUser = null;
  setNowForTests(NOW);
});

afterAll(() => setNowForTests(null));

describe('POST /api/attendance/break/start and /end', () => {
  it('need a signed-in person and a same-site Origin', async () => {
    expect((await start()).status).toBe(401);
    expect((await end()).status).toBe(401);
    signInAs(employee);
    const missing = await start({ origin: null });
    expect(missing.status).toBe(403);
    expect((await errorOf(missing)).code).toBe('BAD_ORIGIN');
    const foreign = await end({ origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect((await errorOf(foreign)).code).toBe('BAD_ORIGIN');
  });

  it('refuse PMs, and an Admin who does not check in', async () => {
    signInAs(pm);
    const toPm = await start();
    expect(toPm.status).toBe(403);
    expect((await errorOf(toPm)).code).toBe('FORBIDDEN');
    expect((await end()).status).toBe(403);
    signInAs(ceo);
    const toCeo = await start();
    expect(toCeo.status).toBe(403);
    expect((await errorOf(toCeo)).code).toBe('FORBIDDEN');
  });

  it('start a break, refuse a second one, then end it', async () => {
    signInAs(employee);
    const started = await start();
    expect(started.status).toBe(200);
    const { data } = await started.json();
    expect(data).toEqual({
      break: expect.objectContaining({
        userId: employee.id,
        workDate: '2026-09-30',
        startedAt: NOW.replace('Z', '.000Z'),
        endedAt: null,
        endReason: null,
      }),
      pausedEntryId: null,
    });

    const again = await start({ body: {} });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toEqual({
      code: 'ALREADY_ON_BREAK',
      message: "You're already on a break.",
    });

    setNowForTests('2026-09-30T07:50:00Z');
    const ended = await end();
    expect(ended.status).toBe(200);
    const result = (await ended.json()).data;
    expect(result).toMatchObject({ breakMinutesToday: 20, overAllowanceMinutes: 0 });
    expect(result.break).toMatchObject({ endReason: 'self', endedAt: '2026-09-30T07:50:00.000Z' });

    const none = await end();
    expect(none.status).toBe(409);
    expect((await errorOf(none)).code).toBe('NOT_ON_BREAK');
  });

  it('work for HR, and say when the person has not checked in', async () => {
    signInAs(hr);
    expect((await start()).status).toBe(200);
    expect((await end()).status).toBe(200);
    const late = await createUser({ name: 'Not In Yet' });
    signInAs(late);
    const response = await start();
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe('NOT_CHECKED_IN');
  });
});
