// The Attendance API passes the signed-in viewer: HR and PMs never get an Admin's attendance from
// GET /api/attendance, /summary, /export or /api/attendance-corrections, and their PATCH of an
// Admin's row answers 404 like a row that doesn't exist; an Admin gets everyone.
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
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
const { GET: getDay } = await import('@/app/api/attendance/route.js');
const { GET: getSummary } = await import('@/app/api/attendance/summary/route.js');
const { GET: getExport } = await import('@/app/api/attendance/export/route.js');
const { GET: getCorrections } = await import('@/app/api/attendance-corrections/route.js');
const { PATCH: patchRow } = await import('@/app/api/attendance/[id]/route.js');

const DAY = '2026-09-30';
const NOW = '2026-09-30T07:30:00Z'; // 1:00 PM in Asia/Kolkata
const EXPIRES = new Date('2026-10-26T04:00:00Z');
let hr;
let pm;
let ceo;
let vishal;
let ceoRowId;

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

async function dataOf(response) {
  expect(response.status).toBe(200);
  return (await response.json()).data;
}

/** The names in the Excel download's first column (header row left out). */
async function exportedNames(response) {
  expect(response.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  const names = book.worksheets[0].getColumn(1).values.slice(2);
  return names.filter(Boolean);
}

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Gupta', role: 'hr' });
  pm = await createUser({ name: 'Pam Mehta', role: 'pm', tracksAttendance: false });
  ceo = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
  vishal = await createUser({ name: 'Vishal Saini' });
  setNowForTests('2026-09-30T04:00:00Z'); // 9:30 AM
  await attendance.checkIn({ user: vishal, ip: null });
  ceoRowId = (await attendance.checkIn({ user: ceo, ip: null })).id;
  await attendance.requestCorrection({
    user: ceo,
    type: 'check_in',
    workDate: DAY,
    checkIn: '09:00',
    reason: 'Was at the client',
  });
  await attendance.requestCorrection({
    user: vishal,
    type: 'check_in',
    workDate: DAY,
    checkIn: '09:10',
    reason: 'Lift was stuck',
  });
});

beforeEach(() => {
  jar.clear();
  sessionUser = null;
  setNowForTests(NOW);
});

afterAll(() => setNowForTests(null));

describe('Attendance API and Admins', () => {
  it('leaves Admins out of the day, its numbers and the Excel file for HR and PMs', async () => {
    for (const viewer of [hr, pm]) {
      signInAs(viewer);
      const day = await dataOf(await call(getDay, `/api/attendance?date=${DAY}`));
      expect(day.map((item) => item.user.id)).toEqual([hr.id, vishal.id]);
      const summary = await dataOf(await call(getSummary, `/api/attendance/summary?date=${DAY}`));
      expect(summary).toMatchObject({ tracked: 2, present: 1 });
      const file = await call(getExport, `/api/attendance/export?date=${DAY}`);
      expect(await exportedNames(file)).toEqual(['Neha Gupta', 'Vishal Saini']);
    }
    signInAs(ceo);
    const day = await dataOf(await call(getDay, `/api/attendance?date=${DAY}`));
    expect(day.map((item) => item.user.id)).toEqual([hr.id, ceo.id, vishal.id]);
    const summary = await dataOf(await call(getSummary, `/api/attendance/summary?date=${DAY}`));
    expect(summary).toMatchObject({ tracked: 3, present: 2 });
    const file = await call(getExport, `/api/attendance/export?date=${DAY}`);
    expect(await exportedNames(file)).toEqual(['Neha Gupta', 'Ravi Kapoor', 'Vishal Saini']);
  });

  it("lists an Admin's correction requests to Admins only", async () => {
    signInAs(hr);
    const forHr = await dataOf(await call(getCorrections, '/api/attendance-corrections'));
    expect(forHr.map((item) => item.userId)).toEqual([vishal.id]);
    signInAs(ceo);
    const forAdmin = await dataOf(await call(getCorrections, '/api/attendance-corrections'));
    expect(forAdmin.map((item) => item.userId)).toEqual([ceo.id, vishal.id]);
  });

  it("refuses HR's change to an Admin's row as if the row didn't exist", async () => {
    signInAs(hr);
    const patch = (id) =>
      call(patchRow, `/api/attendance/${id}`, {
        method: 'PATCH',
        body: { checkIn: '09:10', reason: 'Badge log' },
        params: { id: String(id) },
      });
    const response = await patch(ceoRowId);
    const missing = await patch(ceoRowId + 1000);
    expect([response.status, missing.status]).toEqual([404, 404]);
    const [error, missingError] = [(await response.json()).error, (await missing.json()).error];
    expect(error).toEqual(missingError);
    expect(error.code).toBe('NOT_FOUND');
    expect((await db('attendance').where({ id: ceoRowId }).first()).checkInAt.toISOString()).toBe(
      '2026-09-30T04:00:00.000Z',
    );
  });
});
