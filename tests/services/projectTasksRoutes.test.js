// Priority task API: GET/POST /api/projects/:id/tasks, PATCH/DELETE /api/project-tasks/:id and
// POST /api/project-tasks/:id/status — permissions, ids, validation and response shapes.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';

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
const tasksRoute = await import('@/app/api/projects/[id]/tasks/route.js');
const taskRoute = await import('@/app/api/project-tasks/[id]/route.js');
const statusRoute = await import('@/app/api/project-tasks/[id]/status/route.js');

const EXPIRES = new Date('2026-10-26T04:00:00Z');
let admin;
let pm;
let otherPm;
let hr;
let member;
let outsider;
let project;

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function call(handler, { method = 'GET', path, id, body, query = '' }) {
  const request = new Request(`${env.appOrigin}${path}${query}`, {
    method,
    headers: { origin: env.appOrigin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve({ id: String(id) }) });
  return { status: response.status, json: await response.json() };
}

const list = (id, query) => call(tasksRoute.GET, { path: `/api/projects/${id}/tasks`, id, query });
const create = (id, body) =>
  call(tasksRoute.POST, { method: 'POST', path: `/api/projects/${id}/tasks`, id, body });
const patch = (id, body) =>
  call(taskRoute.PATCH, { method: 'PATCH', path: `/api/project-tasks/${id}`, id, body });
const destroy = (id) =>
  call(taskRoute.DELETE, { method: 'DELETE', path: `/api/project-tasks/${id}`, id });
const setStatus = (id, body) =>
  call(statusRoute.POST, { method: 'POST', path: `/api/project-tasks/${id}/status`, id, body });

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-09-30T05:00:00Z');
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  otherPm = await createUser({ name: 'Other PM', role: 'pm', tracksAttendance: false });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  member = await createUser({ name: 'Mia Member' });
  outsider = await createUser({ name: 'Otto Outsider' });
  project = await createProject(pm, { name: 'lyra' });
  await addMembers(project, [member]);
});

beforeEach(() => {
  jar.clear();
  sessionUser = null;
});

describe('POST /api/projects/:id/tasks', () => {
  it('needs a signed-in person', async () => {
    expect((await create(project.id, { title: 'Hello' })).status).toBe(401);
  });

  it('lets the project PM and Admin create, with 201', async () => {
    signInAs(pm);
    const made = await create(project.id, {
      title: 'Fix login timeout',
      priority: 'p1',
      assigneeId: String(member.id),
    });
    expect(made.status).toBe(201);
    expect(made.json.data).toMatchObject({
      title: 'Fix login timeout',
      priority: 'p1',
      assignee: { id: member.id, name: 'Mia Member' },
    });
    signInAs(admin);
    expect((await create(project.id, { title: 'From Admin' })).status).toBe(201);
  });

  it('is forbidden for another PM, HR and employees', async () => {
    for (const user of [otherPm, hr, member]) {
      signInAs(user);
      const result = await create(project.id, { title: 'Nope' });
      expect(result.status).toBe(403);
      expect(result.json.error.code).toBe('FORBIDDEN');
    }
  });

  it('validates the body and the id', async () => {
    signInAs(pm);
    const bad = await create(project.id, { title: 'x', details: 'd'.repeat(1001), priority: 'p9' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.error.fields).sort()).toEqual(['details', 'priority', 'title']);
    const outsiderTask = await create(project.id, { title: 'For Otto', assigneeId: outsider.id });
    expect(outsiderTask.status).toBe(400);
    expect(outsiderTask.json.error.fields.assigneeId).toBeTruthy();
    expect((await create('1e3', { title: 'Hello' })).status).toBe(404);
    expect((await create('007', { title: 'Hello' })).status).toBe(404);
    expect((await create(999999, { title: 'Hello' })).status).toBe(404);
  });
});

describe('GET /api/projects/:id/tasks', () => {
  it('lists for members, PMs and Admin with paging', async () => {
    for (const user of [member, otherPm, admin]) {
      signInAs(user);
      const result = await list(project.id, '?limit=1');
      expect(result.status).toBe(200);
      expect(result.json.data).toHaveLength(1);
      expect(result.json.data[0].title).toBe('Fix login timeout');
      expect(result.json.page).toEqual({ limit: 1, offset: 0, total: 2 });
    }
  });

  it('is forbidden for people outside the project and rejects big limits', async () => {
    signInAs(outsider);
    expect((await list(project.id)).status).toBe(403);
    signInAs(hr);
    expect((await list(project.id)).status).toBe(403);
    signInAs(pm);
    expect((await list(project.id, '?limit=500')).status).toBe(400);
    expect((await list(project.id, '?status=closed')).status).toBe(400);
  });
});

describe('PATCH, DELETE and status', () => {
  it('edits, marks done, reopens and deletes for the project PM only', async () => {
    signInAs(pm);
    const made = await create(project.id, { title: 'Ship it', priority: 'p3' });
    const id = made.json.data.id;

    signInAs(otherPm);
    expect((await patch(id, { priority: 'p1' })).status).toBe(403);
    expect((await setStatus(id, { status: 'done' })).status).toBe(403);
    expect((await destroy(id)).status).toBe(403);
    signInAs(member);
    expect((await patch(id, { priority: 'p1' })).status).toBe(403);

    signInAs(pm);
    expect((await patch(id, {})).status).toBe(400);
    const edited = await patch(id, { priority: 'p1', details: 'Today' });
    expect(edited.status).toBe(200);
    expect(edited.json.data).toMatchObject({ priority: 'p1', details: 'Today' });
    expect((await setStatus(id, { status: 'finished' })).status).toBe(400);
    const done = await setStatus(id, { status: 'done' });
    expect(done.json.data).toMatchObject({ status: 'done', doneBy: pm.id });
    const open = await setStatus(id, { status: 'open' });
    expect(open.json.data.status).toBe('open');
    expect((await destroy(id)).json.data).toEqual({ id, deleted: true });
    expect((await destroy(id)).status).toBe(404);
    expect((await patch('abc', { title: 'Hello' })).status).toBe(404);
  });
});
