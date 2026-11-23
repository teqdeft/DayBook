// The month routes (CONTRACT 25, items 4, 8 and 10): HR and Admins only (PMs and employees
// FORBIDDEN), a bad month 400, the Excel's content type and file name, 404 for a person id that
// isn't plain digits or a hidden Admin, and per-person rate limits.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { resetRateLimitsForTests } from '@/lib/route';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

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
const { GET: getMonth } = await import('@/app/api/attendance/month/route.js');
const { GET: getExport } = await import('@/app/api/attendance/month/export/route.js');
const { GET: getPerson } = await import('@/app/api/attendance/people/[userId]/month/route.js');
const { GET: getNeedsLook } = await import('@/app/api/attendance/needs-look/route.js');
const { PATCH: patchRow } = await import('@/app/api/attendance/[id]/route.js');

const EXPIRES = new Date('2026-12-26T04:00:00Z');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let hr;
let pm;
let admin;
let employee;
let vishal;

function signInAs(user) {
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

function call(handler, path, { method = 'GET', body, params = {} } = {}) {
  const headers = { Origin: env.appOrigin };
  if (body) headers['Content-Type'] = 'application/json';
  const request = new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(request, { params: Promise.resolve(params) });
}

async function errorOf(response) {
  return (await response.json()).error;
}

beforeAll(async () => {
  await resetDatabase();
  await setSettings({ payroll_month_start_day: 1, working_days: [1, 2, 3, 4, 5] });
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  pm = await createUser({ name: 'Pam Mehta', role: 'pm', tracksAttendance: false });
  admin = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
  employee = await createUser({ name: 'Priya Sharma' });
  vishal = await createUser({ name: 'Vishal Saini' });
  await db('attendance').insert({
    userId: vishal.id,
    workDate: '2026-11-02',
    checkInAt: new Date('2026-11-02T04:00:00Z'),
    checkOutAt: new Date('2026-11-02T13:00:00Z'),
    location: 'office',
    officeVerified: true,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: 'checked_out',
    source: 'self',
  });
});

beforeEach(() => {
  setNowForTests('2026-11-19T06:30:00Z');
  resetRateLimitsForTests();
});

afterAll(() => {
  sessionUser = null;
});

describe('GET /api/attendance/month', () => {
  it('answers HR and Admins, refuses PMs and employees', async () => {
    signInAs(hr);
    const response = await call(getMonth, '/api/attendance/month?month=2026-11&filter=late');
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({ filter: 'late', period: { month: '2026-11' } });
    expect(data.counts.all).toBe(3); // Neha, Priya, Vishal: never the Admin for HR
    signInAs(admin);
    const forAdmin = (await (await call(getMonth, '/api/attendance/month')).json()).data;
    expect(forAdmin.counts.all).toBe(4);
    for (const user of [pm, employee]) {
      signInAs(user);
      const refused = await call(getMonth, '/api/attendance/month');
      expect(refused.status).toBe(403);
      expect((await errorOf(refused)).code).toBe('FORBIDDEN');
    }
  });

  it('answers a bad month or filter with 400', async () => {
    signInAs(hr);
    const month = await call(getMonth, '/api/attendance/month?month=2026-13');
    expect(month.status).toBe(400);
    expect(await errorOf(month)).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { month: 'Use a month like 2026-11.' },
    });
    const filter = await call(getMonth, '/api/attendance/month?filter=everyone');
    expect((await errorOf(filter)).fields.filter).toBe(
      'Pick a filter: needs_look, late, short, absent, leave or missing.',
    );
  });

  it('limits each person to 60 a minute', async () => {
    signInAs(hr);
    for (let i = 0; i < 60; i += 1) {
      expect((await call(getNeedsLook, '/api/attendance/needs-look')).status).toBe(200);
    }
    const limited = await call(getNeedsLook, '/api/attendance/needs-look');
    expect(limited.status).toBe(429);
    // Another person still gets through.
    signInAs(admin);
    expect((await call(getNeedsLook, '/api/attendance/needs-look')).status).toBe(200);
  });
});

describe('GET /api/attendance/month/export', () => {
  it("sends the month's Excel and one person's", async () => {
    signInAs(hr);
    const all = await call(getExport, '/api/attendance/month/export?month=2026-11');
    expect(all.status).toBe(200);
    expect(all.headers.get('Content-Type')).toBe(XLSX);
    expect(all.headers.get('Content-Disposition')).toContain('attendance-2026-11.xlsx');
    const one = await call(
      getExport,
      `/api/attendance/month/export?month=2026-11&userId=${vishal.id}`,
    );
    expect(one.headers.get('Content-Disposition')).toContain(
      'attendance-2026-11-vishal-saini.xlsx',
    );
  });

  it('answers a hidden Admin 404, a bad id 400, and 10 a minute per person', async () => {
    signInAs(hr);
    const hidden = await call(getExport, `/api/attendance/month/export?userId=${admin.id}`);
    expect(hidden.status).toBe(404);
    const bad = await call(getExport, '/api/attendance/month/export?userId=12a');
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).fields.userId).toBe('That id is not valid.');
    resetRateLimitsForTests();
    for (let i = 0; i < 10; i += 1) {
      const response = await call(getExport, `/api/attendance/month/export?userId=${vishal.id}`);
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    const limited = await call(getExport, `/api/attendance/month/export?userId=${vishal.id}`);
    expect(limited.status).toBe(429);
  });
});

describe('GET /api/attendance/people/[userId]/month', () => {
  it("answers HR with the person's month and never an IP", async () => {
    signInAs(hr);
    const response = await call(getPerson, `/api/attendance/people/${vishal.id}/month`, {
      params: { userId: String(vishal.id) },
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('checkInIp');
    expect(JSON.parse(text).data.person.name).toBe('Vishal Saini');
  });

  it('answers 404 for an id that is not digits or a hidden Admin, 403 for a PM', async () => {
    signInAs(hr);
    const letters = await call(getPerson, '/api/attendance/people/12x/month', {
      params: { userId: '12x' },
    });
    expect(letters.status).toBe(404);
    const hidden = await call(getPerson, `/api/attendance/people/${admin.id}/month`, {
      params: { userId: String(admin.id) },
    });
    expect(hidden.status).toBe(404);
    expect((await errorOf(hidden)).message).toBe("We couldn't find that person.");
    signInAs(pm);
    const refused = await call(getPerson, `/api/attendance/people/${vishal.id}/month`, {
      params: { userId: String(vishal.id) },
    });
    expect(refused.status).toBe(403);
  });
});

describe('the static segments beside [id]', () => {
  it('still sends PATCH /api/attendance/12 to the row route', async () => {
    signInAs(hr);
    const response = await call(patchRow, '/api/attendance/999999', {
      method: 'PATCH',
      body: { checkIn: '09:30', reason: 'Badge reader' },
      params: { id: '999999' },
    });
    expect(response.status).toBe(404);
  });
});
