// POST /api/me/carry-suggestions/:taskId/close (CONTRACT 24): sign-in and report.self, the body,
// NOT_FOUND (never FORBIDDEN) for a line that isn't the person's own open line, Undo, and the
// per-person rate limit (60 a minute).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { resetDatabase } from '../helpers/db.js';
import { createPeople, createProject, insertReport } from './reportsTestKit.js';

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
vi.mock('@/modules/users', async () => ({
  users: (await import('./reportsTestKit.js')).fakeUsers,
}));
vi.mock('@/modules/projects', async () => ({
  projects: (await import('./reportsTestKit.js')).fakeProjects,
}));
vi.mock('@/modules/attendance', async () => ({
  attendance: (await import('./reportsTestKit.js')).fakeAttendance,
}));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const { resetRateLimitsForTests } = await import('@/lib/route');
const { POST } = await import('@/app/api/me/carry-suggestions/[taskId]/close/route.js');

const T0 = '2026-09-29T04:00:00Z'; // Tuesday 29 September, 9:30 in Kolkata
const EXPIRES = new Date('2026-10-29T04:00:00Z');
let people;
let mine;
let theirs;

function signInAs(user) {
  jar.clear();
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  if (user) jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function close(taskId, body) {
  const request = new Request(`http://localhost:3000/api/me/carry-suggestions/${taskId}/close`, {
    method: 'POST',
    headers: { Origin: env.appOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await POST(request, { params: Promise.resolve({ taskId: String(taskId) }) });
  return { status: response.status, ...(await response.json()) };
}

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  const internal = await createProject(people.pm, { name: 'internal-tool' });
  const open = (title) => ({
    project: internal,
    minutes: 60,
    tasks: [{ title, status: 'blocked' }],
  });
  mine = await insertReport(people.person, '2026-09-28', { entries: [open('Payment page')] });
  theirs = await insertReport(people.colleague, '2026-09-28', { entries: [open('Their task')] });
});

beforeEach(() => {
  setNowForTests(T0);
  resetRateLimitsForTests();
  signInAs(people.person);
});

describe('POST /api/me/carry-suggestions/:taskId/close', () => {
  it('needs a signed-in person who writes reports', async () => {
    signInAs(null);
    expect((await close(mine.taskIds[0], { reason: 'done' })).status).toBe(401);
    signInAs(people.pm);
    const answer = await close(mine.taskIds[0], { reason: 'done' });
    expect(answer).toMatchObject({ status: 403, error: { code: 'FORBIDDEN' } });
    expect(await db('reportTasks').whereNotNull('carryClosedAt')).toEqual([]);
  });

  it('closes the own open line and opens it again with undo', async () => {
    const id = mine.taskIds[0];
    expect(await close(id, { reason: 'done' })).toEqual({
      status: 200,
      data: { taskId: id, closed: true, reason: 'done' },
    });
    expect(await close(id, { reason: 'done', undo: true })).toEqual({
      status: 200,
      data: { taskId: id, closed: false, reason: null },
    });
    expect(await db('reportTasks').where({ id }).first()).toMatchObject({ carryClosedAt: null });
  });

  it("answers NOT_FOUND for someone else's line or a bad id, and names a wrong field", async () => {
    for (const taskId of [theirs.taskIds[0], 'abc', 0]) {
      const answer = await close(taskId, { reason: 'dropped' });
      expect(answer).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } });
    }
    expect(await close(mine.taskIds[0], { reason: 'later' })).toMatchObject({
      status: 400,
      error: { code: 'VALIDATION_FAILED', fields: { reason: 'Pick Done already or Not needed.' } },
    });
    expect(await close(mine.taskIds[0], { reason: 'done', undo: 'yes' })).toMatchObject({
      status: 400,
      error: { fields: { undo: 'Undo must be true or false.' } },
    });
  });

  it('allows 60 a minute for one person, whoever else is busy', async () => {
    for (let i = 0; i < 60; i += 1) {
      const answer = await close(mine.taskIds[0], { reason: 'done', undo: i % 2 === 1 });
      expect(answer.status).toBe(200);
    }
    expect(await close(mine.taskIds[0], { reason: 'done' })).toMatchObject({
      status: 429,
      error: { code: 'RATE_LIMITED' },
    });
    signInAs(people.colleague);
    expect((await close(theirs.taskIds[0], { reason: 'done' })).status).toBe(200);
    setNowForTests('2026-09-29T04:01:01Z');
    signInAs(people.person);
    expect((await close(mine.taskIds[0], { reason: 'done', undo: true })).status).toBe(200);
  });
});
