// Timer API (CONTRACT 15): GET /api/timers/current, POST start / stop / entries / away and
// PATCH / DELETE /api/timers/entries/:id — permissions, Origin, status codes and error shapes.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { addSegment, at, insertEntry, setClock, TODAY } from './timersKit.js';

const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;

vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));
vi.mock('@/modules/reports', () => ({ reports: {} }));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const currentRoute = await import('@/app/api/timers/current/route.js');
const startRoute = await import('@/app/api/timers/start/route.js');
const stopRoute = await import('@/app/api/timers/stop/route.js');
const entriesRoute = await import('@/app/api/timers/entries/route.js');
const entryRoute = await import('@/app/api/timers/entries/[id]/route.js');
const awayRoute = await import('@/app/api/timers/away/route.js');

const EXPIRES = new Date('2026-10-26T04:00:00Z');
let pm;
let emp;
let hr;
let untracked;
let acme;

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function call(handler, { method = 'GET', path, id, body, origin = env.appOrigin }) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  const request = new Request(`${env.appOrigin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve({ id: String(id) }) });
  return { status: response.status, json: await response.json() };
}

const current = () => call(currentRoute.GET, { path: '/api/timers/current' });
const start = (body, options) =>
  call(startRoute.POST, { method: 'POST', path: '/api/timers/start', body, ...options });
const stop = (options) =>
  call(stopRoute.POST, { method: 'POST', path: '/api/timers/stop', ...options });
const addTime = (body) =>
  call(entriesRoute.POST, { method: 'POST', path: '/api/timers/entries', body });
const patch = (id, body) =>
  call(entryRoute.PATCH, { method: 'PATCH', path: `/api/timers/entries/${id}`, id, body });
const destroy = (id) =>
  call(entryRoute.DELETE, { method: 'DELETE', path: `/api/timers/entries/${id}`, id });
const away = (body) => call(awayRoute.POST, { method: 'POST', path: '/api/timers/away', body });

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  emp = await createUser({ name: 'Emma Dev' });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  untracked = await createUser({ name: 'Uma Untracked', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
  await addMembers(acme, [emp, hr]);
  await checkIn(emp, TODAY, { in: '09:00' });
  await checkIn(hr, TODAY, { in: '09:00' });
});

beforeEach(async () => {
  jar.clear();
  sessionUser = null;
  setClock('11:10');
  await setSettings({ timers_mode: 'optional', activity_tracking_enabled: true });
  await db('timeEntries').del();
});

describe('GET /api/timers/current', () => {
  it('needs a signed-in person with report.self', async () => {
    expect((await current()).status).toBe(401);
    signInAs(pm);
    const result = await current();
    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('FORBIDDEN');
  });

  it('returns the state, and blocked not_allowed for an untracked person', async () => {
    signInAs(emp);
    const result = await current();
    expect(result.status).toBe(200);
    expect(result.json.data).toMatchObject({
      mode: 'optional',
      canUse: true,
      blocked: null,
      running: null,
      entries: [],
      serverNow: at('11:10').toISOString(),
    });
    signInAs(untracked);
    expect((await current()).json.data).toMatchObject({ canUse: false, blocked: 'not_allowed' });
  });
});

describe('POST /api/timers/start and /stop', () => {
  it('starts and stops for people who check in, HR too', async () => {
    signInAs(emp);
    const started = await start({ projectId: String(acme.id), note: 'Build' });
    expect(started.status).toBe(200);
    expect(started.json.data.running).toMatchObject({ projectId: acme.id, note: 'Build' });
    setClock('11:40');
    const stopped = await stop();
    expect(stopped.status).toBe(200);
    expect(stopped.json.data.entries[0]).toMatchObject({ minutes: 30, stopReason: 'stopped' });
    signInAs(hr);
    expect((await start({ projectId: acme.id })).status).toBe(200);
  });

  it('needs the Origin header on changes', async () => {
    signInAs(emp);
    const result = await start({ projectId: acme.id }, { origin: null });
    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('BAD_ORIGIN');
    expect((await stop({ origin: 'https://evil.example' })).status).toBe(403);
  });

  it('answers validation and rule errors in the standard shape', async () => {
    signInAs(emp);
    const bad = await start({ projectId: 'x', note: 'n'.repeat(201) });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(Object.keys(bad.json.error.fields).sort()).toEqual(['note', 'projectId']);
    await setSettings({ timers_mode: 'off' });
    const off = await start({ projectId: acme.id });
    expect(off.status).toBe(409);
    expect(off.json.error).toEqual({
      code: 'TIMERS_OFF',
      message: 'Timers are turned off for your company.',
    });
    signInAs(untracked);
    await setSettings({ timers_mode: 'optional' });
    expect((await start({ projectId: acme.id })).status).toBe(403);
  });
});

describe('/api/timers/entries', () => {
  it('adds time with 201, edits and deletes it', async () => {
    signInAs(emp);
    const made = await addTime({ projectId: acme.id, startClock: '09:10', endClock: '09:40' });
    expect(made.status).toBe(201);
    const id = made.json.data.entries[0].id;
    expect(made.json.data.entries[0]).toMatchObject({ source: 'manual', minutes: 30 });
    const edited = await patch(id, { endClock: '09:50', note: 'Planning' });
    expect(edited.status).toBe(200);
    expect(edited.json.data.entries[0]).toMatchObject({ endClock: '09:50', note: 'Planning' });
    const deleted = await destroy(id);
    expect(deleted.status).toBe(200);
    expect(deleted.json.data.entries).toEqual([]);
    expect((await destroy(id)).status).toBe(404);
  });

  it('validates bodies and ids', async () => {
    signInAs(emp);
    const bad = await addTime({ projectId: acme.id, startClock: '10:00', endClock: '09:00' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.fields).toEqual({ endClock: 'End must be after the start.' });
    const missing = await addTime({ projectId: acme.id });
    expect(Object.keys(missing.json.error.fields).sort()).toEqual(['endClock', 'startClock']);
    const id = await insertEntry(emp, acme, { from: '10:00', to: '10:30' });
    const empty = await patch(id, {});
    expect(empty.status).toBe(400);
    expect(empty.json.error.fields).toEqual({ _: 'Nothing to change.' });
    expect((await patch('abc', { note: 'x' })).status).toBe(404);
    expect((await destroy('1e3')).status).toBe(404);
    signInAs(pm);
    expect((await patch(id, { note: 'x' })).status).toBe(403);
  });
});

describe('POST /api/timers/away', () => {
  it('keeps away time, and answers a stale span with 409', async () => {
    const id = await insertEntry(emp, acme, { from: '10:00' });
    await addSegment(emp, 'active', '10:00', '10:30');
    await addSegment(emp, 'locked', '10:30', '11:00');
    await addSegment(emp, 'active', '11:01', '11:10');
    signInAs(emp);
    const offered = (await current()).json.data.away;
    expect(offered).toMatchObject({ entryId: id, minutes: 30, fromClock: '10:30' });
    const wrong = await away({ ...offered, to: at('10:59').toISOString(), decision: 'keep' });
    expect(wrong.status).toBe(409);
    expect(wrong.json.error).toEqual({
      code: 'CONFLICT',
      message: 'That away time changed. Refresh and try again.',
    });
    const bad = await away({ ...offered, decision: 'later' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.error.fields)).toEqual(['decision']);
    const kept = await away({ entryId: id, from: offered.from, to: offered.to, decision: 'keep' });
    expect(kept.status).toBe(200);
    expect(kept.json.data.away).toBeNull();
  });
});
