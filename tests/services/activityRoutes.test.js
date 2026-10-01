// Screen time API (CONTRACT section 11): who may call each endpoint (activity.self for the
// heartbeat and one's own numbers; activity.view_all, PMs and Admin, for everyone's), the Origin
// check on heartbeats, validation, and the Excel download.
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

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
const { POST: postHeartbeat } = await import('@/app/api/activity/heartbeat/route.js');
const { GET: getMe } = await import('@/app/api/activity/me/route.js');
const { GET: getTeam } = await import('@/app/api/activity/team/route.js');
const { GET: getUser } = await import('@/app/api/activity/users/[id]/route.js');
const { GET: getExport } = await import('@/app/api/activity/export/route.js');

const NOW = '2026-09-30T06:00:00Z'; // 11:30 in Asia/Kolkata
const EXPIRES = new Date('2026-10-26T04:00:00Z');
let employee;
let hr;
let pm;
let ceo;

function signInAs(user) {
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

function get(handler, path, params = {}) {
  const request = new Request(`http://localhost:3000/api/activity${path}`);
  return handler(request, { params: Promise.resolve(params) });
}

function beat(body, { origin = env.appOrigin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const request = new Request('http://localhost:3000/api/activity/heartbeat', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return postHeartbeat(request, { params: Promise.resolve({}) });
}

async function errorOf(response) {
  return (await response.json()).error;
}

beforeAll(async () => {
  await resetDatabase();
  await setSettings({ timezone: 'Asia/Kolkata', activity_tracking_enabled: true });
  employee = await createUser({ name: 'Vishal Saini' });
  hr = await createUser({ name: 'Neha Gupta', role: 'hr', department: 'HR' });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  ceo = await createUser({ name: 'Cee Eo', role: 'admin', tracksAttendance: false });
  const segment = (user, state, from, to) => ({
    userId: user.id,
    workDate: '2026-09-29',
    state,
    source: 'system',
    startedAt: new Date(from),
    endedAt: new Date(to),
  });
  await db('activitySegments').insert([
    segment(employee, 'active', '2026-09-29T04:00:00Z', '2026-09-29T06:00:00Z'),
    segment(employee, 'idle', '2026-09-29T06:00:00Z', '2026-09-29T06:10:00Z'),
    segment(hr, 'active', '2026-09-29T04:30:00Z', '2026-09-29T05:00:00Z'),
  ]);
});

beforeEach(() => {
  jar.clear();
  sessionUser = null;
  setNowForTests(NOW);
});

afterAll(() => setNowForTests(null));

describe('POST /api/activity/heartbeat', () => {
  it('needs a signed-in person and a same-site Origin', async () => {
    expect((await beat({ state: 'active' })).status).toBe(401);
    signInAs(employee);
    const response = await beat({ state: 'active' }, { origin: null });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('BAD_ORIGIN');
    const foreign = await beat({ state: 'active' }, { origin: 'https://evil.example' });
    expect((await errorOf(foreign)).code).toBe('BAD_ORIGIN');
  });

  it('records tracked employees and HR, defaulting the source to system', async () => {
    signInAs(employee);
    const response = await beat({ state: 'active' });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toEqual({ state: 'active', segmentId: expect.any(Number) });
    const row = await db('activitySegments').where({ id: data.segmentId }).first();
    expect(row).toMatchObject({ userId: employee.id, workDate: '2026-09-30', source: 'system' });

    signInAs(hr);
    expect((await beat({ state: 'idle', source: 'window' })).status).toBe(200);
  });

  it('refuses PMs and untracked Admin', async () => {
    signInAs(pm);
    expect((await beat({ state: 'active' })).status).toBe(403);
    signInAs(ceo);
    const response = await beat({ state: 'active' });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('FORBIDDEN');
  });

  it('rejects an unknown state or source with a field message', async () => {
    signInAs(employee);
    const bad = await beat({ state: 'busy' });
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).fields.state).toBe('State must be active, idle or locked.');
    const source = await beat({ state: 'active', source: 'x'.repeat(500) });
    expect((await errorOf(source)).fields.source).toBe('Source must be system or window.');
  });

  it("answers { state: 'off' } and writes nothing while screen time is off", async () => {
    await setSettings({ activity_tracking_enabled: false });
    try {
      signInAs(employee);
      const before = await db('activitySegments').count({ n: '*' }).first();
      const response = await beat({ state: 'active' });
      expect(await response.json()).toEqual({ data: { state: 'off', segmentId: null } });
      expect(await db('activitySegments').count({ n: '*' }).first()).toEqual(before);
    } finally {
      await setSettings({ activity_tracking_enabled: true });
    }
  });
});

describe('GET /api/activity/me', () => {
  it("gives only the signed-in person's own days", async () => {
    signInAs(employee);
    const response = await get(getMe, '/me?from=2026-09-01&to=2026-09-29');
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.from).toBe('2026-09-01');
    expect(data.days).toEqual([
      expect.objectContaining({ workDate: '2026-09-29', activeMinutes: 120, idleMinutes: 10 }),
    ]);
    expect(data.totals).toEqual({
      activeMinutes: 120,
      idleMinutes: 10,
      lockedMinutes: 0,
      daysWithData: 1,
    });
  });

  it('defaults to this month so far and checks the range', async () => {
    signInAs(employee);
    const { data } = await (await get(getMe, '/me')).json();
    expect([data.from, data.to]).toEqual(['2026-09-01', '2026-09-30']);
    const reversed = await get(getMe, '/me?from=2026-09-30&to=2026-09-01');
    expect(reversed.status).toBe(400);
    expect((await errorOf(reversed)).fields.from).toBeDefined();
    expect((await get(getMe, '/me?from=2025-01-01&to=2026-09-30')).status).toBe(400);
    expect((await get(getMe, '/me?from=2026-02-30')).status).toBe(400);
  });

  it('is forbidden for PMs (they are never tracked)', async () => {
    signInAs(pm);
    expect((await get(getMe, '/me')).status).toBe(403);
  });
});

describe('GET /api/activity/team and /users/:id', () => {
  it('is for PMs and Admin only', async () => {
    for (const user of [employee, hr]) {
      signInAs(user);
      expect((await get(getTeam, '/team')).status).toBe(403);
      expect(
        (await get(getUser, `/users/${employee.id}`, { id: String(employee.id) })).status,
      ).toBe(403);
      expect((await get(getExport, '/export')).status).toBe(403);
    }
  });

  it('lists every tracked person for a day, never PMs or untracked Admin', async () => {
    signInAs(pm);
    const response = await get(getTeam, '/team?date=2026-09-29');
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.map((item) => item.user.name)).toEqual(['Neha Gupta', 'Vishal Saini']);
    const vishal = data.find((item) => item.user.id === employee.id);
    expect(vishal).toMatchObject({ currentState: 'offline', activeMinutes: 120, idleMinutes: 10 });
    expect(vishal.segments).toHaveLength(2);
    expect((await get(getTeam, '/team?date=29-09-2026')).status).toBe(400);
  });

  it("gives one person's range, 404 for unknown or malformed ids", async () => {
    signInAs(ceo);
    const ok = await get(getUser, `/users/${employee.id}?from=2026-09-01&to=2026-09-30`, {
      id: String(employee.id),
    });
    expect(ok.status).toBe(200);
    const { data } = await ok.json();
    expect(data.user).toMatchObject({ id: employee.id, tracksAttendance: true });
    expect(data.totals.activeMinutes).toBe(120);
    expect((await get(getUser, '/users/999999', { id: '999999' })).status).toBe(404);
    for (const id of ['abc', '0', `0x${employee.id.toString(16)}`, `${employee.id}e0`, ' 1']) {
      expect((await get(getUser, `/users/${id}`, { id })).status, id).toBe(404);
    }
    const range = await get(getUser, `/users/${employee.id}?to=nope`, { id: String(employee.id) });
    expect(range.status).toBe(400);
  });
});

describe('GET /api/activity/export', () => {
  it('downloads the day as Excel ExcelJS can read back', async () => {
    signInAs(pm);
    const response = await get(getExport, '/export?date=2026-09-29');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="screen-time-2026-09-29.xlsx"',
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    const summary = book.getWorksheet('Screen time');
    expect(summary.rowCount).toBe(3); // header + Neha + Vishal
    expect(summary.getCell('A3').value).toBe('Vishal Saini');
    expect(summary.getCell('E3').value).toBe('09:30'); // first active, company time
    expect(book.getWorksheet('Segments').rowCount).toBe(4);
  });
});
