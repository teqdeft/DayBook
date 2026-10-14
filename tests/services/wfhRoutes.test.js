// Work-from-home API (CONTRACT 17): POST/GET /api/wfh-requests, /:id/approve, /:id/decline and
// /:id/cancel — who may call them, the Origin check, the answers and their codes, and check-in's
// WFH_NOT_APPROVED through POST /api/attendance/check-in.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNowForTests } from '@/lib/time';
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
const requests = await import('@/app/api/wfh-requests/route.js');
const { POST: approveRoute } = await import('@/app/api/wfh-requests/[id]/approve/route.js');
const { POST: declineRoute } = await import('@/app/api/wfh-requests/[id]/decline/route.js');
const { POST: cancelRoute } = await import('@/app/api/wfh-requests/[id]/cancel/route.js');
const { POST: checkInRoute } = await import('@/app/api/attendance/check-in/route.js');

const NOW = '2026-09-30T04:00:00Z'; // Wednesday 30 September, 9:30 AM in India
const EXPIRES = new Date('2026-10-26T04:00:00Z');
let employee;
let hr;
let pm;
let ceo;

function signInAs(user) {
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

function call(handler, path, { method = 'POST', body, params = {}, origin = env.appOrigin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const request = new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handler(request, { params: Promise.resolve(params) });
}

const ask = (body, options) => call(requests.POST, '/api/wfh-requests', { body, ...options });
const list = (query = '') => call(requests.GET, `/api/wfh-requests${query}`, { method: 'GET' });
const act = (handler, action, id, body) =>
  call(handler, `/api/wfh-requests/${id}/${action}`, { body, params: { id: String(id) } });

async function answer(response) {
  return { status: response.status, ...(await response.json()) };
}

beforeAll(async () => {
  await resetDatabase();
  employee = await createUser({ name: 'Vishal Saini' });
  hr = await createUser({ name: 'Neha Gupta', role: 'hr' });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  ceo = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
});

beforeEach(() => {
  jar.clear();
  sessionUser = null;
  setNowForTests(NOW);
});

afterAll(() => setNowForTests(null));

describe('POST /api/wfh-requests', () => {
  it('needs a signed-in person who checks in, and a same-site Origin', async () => {
    expect((await ask({ fromDate: '2026-10-01', reason: 'Plumber visit' })).status).toBe(401);
    signInAs(employee);
    const missing = await answer(await ask({}, { origin: null }));
    expect([missing.status, missing.error.code]).toEqual([403, 'BAD_ORIGIN']);
    const foreign = await answer(await ask({}, { origin: 'https://evil.example' }));
    expect([foreign.status, foreign.error.code]).toEqual([403, 'BAD_ORIGIN']);
    signInAs(pm);
    const forPm = await answer(await ask({ fromDate: '2026-10-01', reason: 'Plumber visit' }));
    expect([forPm.status, forPm.error.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('answers 201 with the request, 400 for bad fields and 409 for days already asked', async () => {
    signInAs(employee);
    const created = await answer(
      await ask({ fromDate: '2026-10-01', toDate: '', reason: 'Plumber visit' }),
    );
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({
      user: { id: employee.id, name: 'Vishal Saini' },
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
      status: 'pending',
    });
    const bad = await answer(await ask({ fromDate: '1 Oct', reason: 'Hm' }));
    expect(bad.status).toBe(400);
    expect(bad.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { fromDate: 'Pick the first day.', reason: 'Add a reason of at least 5 characters.' },
    });
    const past = await answer(await ask({ fromDate: '2026-09-29', reason: 'Plumber visit' }));
    expect([past.status, past.error.fields]).toEqual([
      400,
      { fromDate: 'Pick today or a later day.' },
    ]);
    const again = await answer(await ask({ fromDate: '2026-10-01', reason: 'Plumber visit' }));
    expect(again.status).toBe(409);
    expect(again.error).toEqual({
      code: 'REQUEST_ALREADY_PENDING',
      message: 'You already asked to work from home on Thu, 1 Oct.',
      fields: { fromDate: 'You already asked to work from home on Thu, 1 Oct.' },
    });
  });
});

describe('GET /api/wfh-requests', () => {
  it("gives HR everyone's but an Admin's, an Admin all, anyone else their own", async () => {
    signInAs(ceo);
    expect((await ask({ fromDate: '2026-10-02', reason: 'Board call at home' })).status).toBe(201);
    signInAs(hr);
    const forHr = await answer(await list('?status=pending&limit=10'));
    expect(forHr.status).toBe(200);
    expect(forHr.data.map((item) => item.user.name)).toEqual(['Vishal Saini']);
    expect(forHr.page).toEqual({ limit: 10, offset: 0, total: 1 });
    signInAs(ceo);
    const forCeo = await answer(await list());
    expect(forCeo.data.map((item) => item.user.name)).toEqual(['Vishal Saini', 'Ravi Kapoor']);
    signInAs(pm);
    expect((await answer(await list())).data).toEqual([]);
    const bad = await answer(await list('?status=maybe'));
    expect([bad.status, bad.error.code]).toEqual([400, 'VALIDATION_FAILED']);
    sessionUser = null;
    jar.clear();
    expect((await list()).status).toBe(401);
  });
});

describe('approve, decline and cancel', () => {
  async function newRequest(user, fromDate) {
    signInAs(user);
    return (await answer(await ask({ fromDate, reason: 'Waiting for a delivery' }))).data;
  }

  it('lets HR and Admins approve or decline, others get 403, hidden ones 404', async () => {
    const first = await newRequest(employee, '2026-10-05');
    const second = await newRequest(employee, '2026-10-06');
    const forEmployee = await answer(await act(approveRoute, 'approve', first.id));
    expect([forEmployee.status, forEmployee.error.code]).toEqual([403, 'FORBIDDEN']);

    signInAs(hr);
    const done = await answer(await act(approveRoute, 'approve', first.id));
    expect([done.status, done.data.status]).toEqual([200, 'approved']);
    const twice = await answer(await act(approveRoute, 'approve', first.id));
    expect([twice.status, twice.error.code]).toEqual([409, 'REQUEST_ALREADY_HANDLED']);
    const noReason = await answer(await act(declineRoute, 'decline', second.id, {}));
    expect([noReason.status, Object.keys(noReason.error.fields)]).toEqual([400, ['reason']]);
    const declined = await answer(
      await act(declineRoute, 'decline', second.id, { reason: 'Team day' }),
    );
    expect(declined.data).toMatchObject({ status: 'declined', declineReason: 'Team day' });

    const ceoRequest = await newRequest(ceo, '2026-10-07');
    signInAs(hr);
    const hidden = await answer(await act(approveRoute, 'approve', ceoRequest.id));
    const unknown = await answer(await act(approveRoute, 'approve', 999999));
    expect([hidden.status, hidden.error]).toEqual([404, unknown.error]);
    const badId = await answer(await act(declineRoute, 'decline', 'abc', { reason: 'No' }));
    expect([badId.status, badId.error.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('lets the person cancel their own request (PMs get 403, others 404)', async () => {
    const own = await newRequest(employee, '2026-10-08');
    const cancelled = await answer(await act(cancelRoute, 'cancel', own.id));
    expect([cancelled.status, cancelled.data.status]).toEqual([200, 'cancelled']);
    const hrs = await newRequest(hr, '2026-10-08');
    signInAs(employee);
    const other = await answer(await act(cancelRoute, 'cancel', hrs.id));
    expect([other.status, other.error.code]).toEqual([404, 'NOT_FOUND']);
    signInAs(pm);
    expect((await act(cancelRoute, 'cancel', hrs.id)).status).toBe(403);
  });
});

describe('POST /api/attendance/check-in', () => {
  it('answers 409 WFH_NOT_APPROVED without an approved request for today', async () => {
    signInAs(await createUser({ name: 'Karan Mehta' }));
    const refused = await answer(
      await call(checkInRoute, '/api/attendance/check-in', { body: {} }),
    );
    expect(refused).toEqual({
      status: 409,
      error: {
        code: 'WFH_NOT_APPROVED',
        message: "Working from home needs HR's approval for today. Ask HR first.",
      },
    });
  });
});
