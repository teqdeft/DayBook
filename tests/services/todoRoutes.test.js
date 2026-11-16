// The /api/me/todo routes (CONTRACT 24): sign-in and report.self, the JSON each one answers,
// NOT_FOUND for someone else's line or project and for ids that aren't ids, the paste route's own
// body reading (413 over 128 KB, BAD_REQUEST for broken JSON), and the per-person rate limits:
// 60 to-do writes a minute (all write routes together) and 6 Slack posts a minute.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setSlackClientForTests } from '@/modules/slack/client';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { setClock, TODAY } from './timersKit.js';

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
const todoRoute = await import('@/app/api/me/todo/route.js');
const linesRoute = await import('@/app/api/me/todo/lines/route.js');
const bulkRoute = await import('@/app/api/me/todo/lines/bulk/route.js');
const lineRoute = await import('@/app/api/me/todo/lines/[id]/route.js');
const timerRoute = await import('@/app/api/me/todo/lines/[id]/timer/route.js');
const projectRoute = await import('@/app/api/me/todo/projects/[entryId]/route.js');
const slackRoute = await import('@/app/api/me/todo/slack/route.js');

const EXPIRES = new Date('2026-10-30T04:00:00Z');
let pm;
let emp;
let colleague;
let acme;

function signInAs(user) {
  jar.clear();
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  if (user) jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

/** Calls a route handler as the browser would; → { status, ...json }. */
async function call(handler, path, { method = 'GET', body, params = {}, headers = {} } = {}) {
  const init = { method, headers: { Origin: env.appOrigin, ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const request = new Request(`http://localhost:3000${path}`, init);
  const response = await handler(request, { params: Promise.resolve(params) });
  return { status: response.status, ...(await response.json()) };
}

const addLine = (title, project = acme) =>
  call(linesRoute.POST, '/api/me/todo/lines', {
    method: 'POST',
    body: { projectId: project.id, title },
  });
const patchLine = (id, body) =>
  call(lineRoute.PATCH, `/api/me/todo/lines/${id}`, {
    method: 'PATCH',
    body,
    params: { id: String(id) },
  });
const deleteLine = (id) =>
  call(lineRoute.DELETE, `/api/me/todo/lines/${id}`, {
    method: 'DELETE',
    params: { id: String(id) },
  });
const deleteProject = (entryId) =>
  call(projectRoute.DELETE, `/api/me/todo/projects/${entryId}`, {
    method: 'DELETE',
    params: { entryId: String(entryId) },
  });
const bulk = (body, headers) =>
  call(bulkRoute.POST, '/api/me/todo/lines/bulk', { method: 'POST', body, headers });
const postSlack = () => call(slackRoute.POST, '/api/me/todo/slack', { method: 'POST' });

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  emp = { ...(await createUser({ name: 'Priya Sharma' })), initials: 'PS' };
  colleague = { ...(await createUser({ name: 'Ankit Rana' })), initials: 'AR' };
  acme = await createProject(pm, { name: 'Pine Tree Lane' });
  await addMembers(acme, [emp, colleague]);
});

beforeEach(async () => {
  setClock('09:30');
  resetRateLimitsForTests();
  for (const table of ['slack_outbox', 'timeEntries', 'reportTasks', 'reportEntries']) {
    await db(table).del();
  }
  await db('dailyReports').del();
  await db('attendance').del();
  await setSettings({ slack_enabled: true, slack_todo_channel_id: null, timers_mode: 'optional' });
  signInAs(emp);
});

afterEach(() => {
  setSlackClientForTests(null);
});

describe('who may call', () => {
  it('needs a signed-in person who writes reports', async () => {
    signInAs(null);
    expect((await call(todoRoute.GET, '/api/me/todo')).status).toBe(401);
    signInAs(pm);
    expect(await call(todoRoute.GET, '/api/me/todo')).toMatchObject({
      status: 403,
      error: { code: 'FORBIDDEN' },
    });
    expect((await addLine('Monitor ads')).status).toBe(403);
    expect(await db('dailyReports')).toEqual([]);
  });
});

describe('answers', () => {
  it('GET gives the to-do; POST lines gives the new to-do with added and lineId', async () => {
    const empty = await call(todoRoute.GET, '/api/me/todo');
    expect(empty).toMatchObject({
      status: 200,
      data: { workDate: TODAY, reportId: null, total: 0, groups: [], suggestions: {} },
    });
    const added = await addLine('Monitor ads');
    expect(added.status).toBe(200);
    expect(added.data).toMatchObject({
      total: 1,
      added: true,
      lineId: expect.any(Number),
      groups: [{ project: { id: acme.id, name: 'Pine Tree Lane' }, minutes: 0 }],
    });
    expect((await addLine('monitor ADS')).data).toMatchObject({ added: false, total: 1 });
    expect(
      await call(linesRoute.POST, '/api/me/todo/lines', { method: 'POST', body: {} }),
    ).toMatchObject({
      status: 400,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('PATCH and DELETE work on her own line and answer NOT_FOUND for anyone else’s', async () => {
    const { data } = await addLine('Monitor ads');
    const ticked = await patchLine(data.lineId, { done: true });
    expect(ticked).toMatchObject({ status: 200, data: { done: 1, total: 1 } });
    expect(await patchLine(data.lineId, { done: 'yes' })).toMatchObject({
      status: 400,
      error: { fields: { done: 'Done must be true or false.' } },
    });

    signInAs(colleague);
    const theirs = await addLine('Their line');
    signInAs(emp);
    for (const id of [theirs.data.lineId, 'abc', 0]) {
      expect(await patchLine(id, { done: true })).toMatchObject({
        status: 404,
        error: { code: 'NOT_FOUND' },
      });
      expect(await deleteLine(id)).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } });
    }
    for (const entryId of [theirs.data.groups[0].entryId, 'abc']) {
      expect(await deleteProject(entryId)).toMatchObject({
        status: 404,
        error: {
          code: 'NOT_FOUND',
          message:
            "We couldn't find that project in today's to-do. Reload the page to see the latest.",
        },
      });
    }
    const timer = await call(timerRoute.POST, `/api/me/todo/lines/${theirs.data.lineId}/timer`, {
      method: 'POST',
      params: { id: String(theirs.data.lineId) },
    });
    expect(timer).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } });

    expect(await deleteLine(data.lineId)).toMatchObject({ status: 200, data: { total: 0 } });
    expect(await deleteProject(data.groups[0].entryId)).toMatchObject({
      status: 200,
      data: { groups: [] },
    });
    expect(await db('reportTasks').where({ id: theirs.data.lineId }).first()).toBeTruthy();
  });

  it('the timer route starts the timer and answers the to-do with timerState', async () => {
    await checkIn(emp, TODAY, { in: '09:00' });
    const { data } = await addLine('Monitor ads');
    const answer = await call(timerRoute.POST, `/api/me/todo/lines/${data.lineId}/timer`, {
      method: 'POST',
      params: { id: String(data.lineId) },
    });
    expect(answer.status).toBe(200);
    expect(answer.data.groups[0].lines[0]).toMatchObject({ now: true });
    expect(answer.data.timerState).toMatchObject({ running: { note: 'Monitor ads' } });
  });
});

describe('the paste route', () => {
  it('adds the groups and answers { added, skipped, todo }', async () => {
    await addLine('Monitor ads');
    const answer = await bulk({
      groups: [{ projectId: acme.id, lines: [{ title: 'monitor ads' }, { title: 'Blog post' }] }],
    });
    expect(answer).toMatchObject({
      status: 200,
      data: { added: 1, skipped: 1, todo: { total: 2 } },
    });
    expect(await bulk({ groups: [{ projectId: acme.id, lines: [{ title: 'x' }] }] })).toMatchObject(
      {
        status: 400,
        error: { fields: { 'groups.0.lines.0.title': 'Write at least 2 characters.' } },
      },
    );
    expect(await bulk('{"groups": [')).toMatchObject({
      status: 400,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('answers 413 over 128 KB, by its length or by what arrives', async () => {
    const big = { groups: [{ projectId: acme.id, lines: [{ title: 'a'.repeat(140_000) }] }] };
    expect(await bulk(big)).toMatchObject({ status: 413, error: { code: 'PAYLOAD_TOO_LARGE' } });
    const small = { groups: [{ projectId: acme.id, lines: [{ title: 'Fine' }] }] };
    expect(await bulk(small, { 'Content-Length': '200000' })).toMatchObject({ status: 413 });
    expect(await db('reportTasks')).toEqual([]);
  });
});

describe('rate limits (per person)', () => {
  it('allows 60 to-do writes a minute across the routes, whoever else is busy', async () => {
    const { data } = await addLine('Monitor ads');
    for (let i = 1; i < 60; i += 1) {
      const answer = await patchLine(data.lineId, { done: i % 2 === 1 });
      expect(answer.status).toBe(200);
    }
    expect(await addLine('One too many')).toMatchObject({
      status: 429,
      error: { code: 'RATE_LIMITED' },
    });
    expect((await bulk({ groups: [] })).status).toBe(429);
    signInAs(colleague);
    expect((await addLine('Their line')).status).toBe(200);
    signInAs(emp);
    setClock('09:31:01');
    expect((await addLine('A minute later')).status).toBe(200);
  });

  it('allows 6 Slack posts a minute', async () => {
    setSlackClientForTests({ chat: {}, auth: {}, conversations: {}, users: {} });
    await setSettings({ slack_todo_channel_id: 'C0TODO', slack_todo_channel_name: 'morning-todo' });
    await addLine('Monitor ads');
    for (let i = 0; i < 6; i += 1) {
      const answer = await postSlack();
      expect(answer).toMatchObject({ status: 200, data: { queued: 'post' } });
    }
    expect(await postSlack()).toMatchObject({ status: 429, error: { code: 'RATE_LIMITED' } });
    expect((await addLine('Writes still count apart')).status).toBe(200);
  });
});
