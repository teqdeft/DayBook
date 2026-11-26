// The "From project files" picker (CONTRACT 28, API and Every read with links): managers only (a
// member and another PM 403, a stranger 404), the places and their counts, `onThisTask` and
// `linkCount`, a task of another project 404, the 500 cap, `linksReady: false` before migration 020,
// through GET /api/projects/[id]/files?taskId= and the service. Also in the MySQL 8.4 workflow
// (the grouped link count).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import {
  createTask,
  emptyFilesDir,
  expectCode,
  linkFile,
  projectFile,
  taskFile,
} from './projectFilesKit.js';

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
const { resetRateLimitsForTests } = await import('@/lib/route');
const { projectFiles } = await import('@/modules/projectFiles');
const pickerRoute = await import('@/app/api/projects/[id]/files/route.js');

const T0 = '2026-11-24T06:00:00Z';
const EXPIRES = new Date('2026-12-30T04:00:00Z');
const CANT = "You can't change files on this project.";

const people = {};
let project;
let otherProject;
let task;
let otherTask;

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

/** GET of the picker route as the browser sends it. */
async function pick(projectId, query = '') {
  const url = `${env.appOrigin}/api/projects/${projectId}/files${query}`;
  const response = await pickerRoute.GET(new Request(url), {
    params: Promise.resolve({ id: String(projectId) }),
  });
  return {
    status: response.status,
    cache: response.headers.get('cache-control'),
    json: await response.json(),
  };
}

beforeAll(async () => {
  setNowForTests(T0);
  await resetDatabase();
  await emptyFilesDir();
  const user = (name, role = 'employee') => createUser({ name, role, tracksAttendance: false });
  people.pm = await user('Riya Kapoor', 'pm');
  people.admin = await user('Arvind Menon', 'admin');
  people.member = await user('Vishal Saini');
  people.otherPm = await user('Omar Other', 'pm');
  people.stranger = await user('Sam Stranger');
  project = await createProject(people.pm, { name: 'acme-store' });
  await addMembers(project, [people.member]);
  otherProject = await createProject(people.otherPm, { name: 'internal-tool' });
  task = await createTask(project, { assigneeId: people.member.id, phase: 'development' });
  const another = await createTask(project, { title: 'Payment settings page' });
  otherTask = await createTask(otherProject, { title: 'Elsewhere' });
  const { pm } = people;
  const at = (iso) => setNowForTests(iso);
  at('2026-11-20T06:00:00Z');
  const brief = await projectFile({ user: pm, projectId: project.id, name: 'brief.pdf' });
  at('2026-11-21T06:00:00Z');
  await projectFile({
    user: pm,
    projectId: project.id,
    phase: 'design',
    visibility: 'managers',
    name: 'contract.pdf',
  });
  at('2026-11-22T06:00:00Z');
  const testing = await projectFile({
    user: pm,
    projectId: project.id,
    phase: 'testing',
    name: 'test-plan.pdf',
  });
  setNowForTests(T0);
  // Never in the picker: a task's own file, a deleted file, another project's file.
  await taskFile({ user: pm, projectId: project.id, taskId: task.id, name: 'own.pdf' });
  const gone = await projectFile({ user: pm, projectId: project.id, name: 'gone.pdf' });
  await projectFiles.removeFile({ user: pm, id: gone.id });
  await projectFile({ user: people.otherPm, projectId: otherProject.id, name: 'theirs.pdf' });
  await linkFile({ user: pm, project, task, fileIds: brief.id });
  await linkFile({ user: pm, project, task: another, fileIds: [brief.id, testing.id] });
});

beforeEach(() => {
  setNowForTests(T0);
  resetRateLimitsForTests();
});

afterEach(() => {
  sessionUser = null;
  jar.clear();
});

describe('the picker', () => {
  it('lists the project files newest first with onThisTask, linkCount and the places', async () => {
    signInAs(people.pm);
    const answer = await pick(project.id, `?taskId=${task.id}`);
    expect([answer.status, answer.cache]).toEqual([200, 'no-store']);
    const { data } = answer.json;
    expect(data.linksReady).toBe(true);
    expect(data.taskPhase).toBe('development');
    expect(data.files.map((file) => [file.name, file.onThisTask, file.linkCount])).toEqual([
      ['test-plan.pdf', false, 1],
      ['contract.pdf', false, 0],
      ['brief.pdf', true, 2],
    ]);
    expect(data.files[1]).toMatchObject({ visibility: 'managers', phase: 'design', linked: false });
    expect(data.places).toEqual([
      { key: 'all', label: 'All files', count: 3 },
      { key: 'project', label: 'Whole project', count: 1 },
      { key: 'requirement_gathering', label: 'Requirement gathering', count: 0 },
      { key: 'design', label: 'Design', count: 1 },
      { key: 'development', label: 'Development', count: 0 },
      { key: 'testing', label: 'Testing', count: 1 },
      { key: 'launch', label: 'Launch', count: 0 },
      { key: 'support', label: 'Support', count: 0 },
    ]);
  });

  it('works for an Admin who is not on the project, and without a task', async () => {
    const data = await projectFiles.pickerFiles({ viewer: people.admin, projectId: project.id });
    expect(data.taskPhase).toBeNull();
    expect(data.files.every((file) => file.onThisTask === false)).toBe(true);
    expect(data.files).toHaveLength(3);
  });

  it('answers 403 to a member and another PM, 404 to a stranger and for a task elsewhere', async () => {
    signInAs(people.otherPm);
    const other = await pick(project.id);
    expect([other.status, other.json.error.message]).toEqual([403, CANT]);
    signInAs(people.member);
    expect((await pick(project.id)).status).toBe(403); // no project.manage: the route says no
    const member = { viewer: people.member, projectId: project.id };
    const refused = await expectCode(projectFiles.pickerFiles(member), 'FORBIDDEN');
    expect(refused.message).toBe(CANT);
    await expectCode(
      projectFiles.pickerFiles({ viewer: people.stranger, projectId: project.id }),
      'NOT_FOUND',
    );
    signInAs(people.pm);
    const elsewhere = await pick(project.id, `?taskId=${otherTask.id}`);
    expect([elsewhere.status, elsewhere.json.error.message]).toEqual([
      404,
      "We couldn't find that task.",
    ]);
    expect((await pick(999_999)).status).toBe(404);
    expect((await pick(project.id, '?taskId=abc')).status).toBe(400);
  });

  it('lists at most 500 files', async () => {
    const extra = await createProject(people.pm, { name: 'big-project' });
    const at = new Date('2026-11-24T06:00:00Z');
    const rows = Array.from({ length: 505 }, (_, index) => ({
      projectId: extra.id,
      scope: 'project',
      phase: null,
      visibility: 'everyone',
      status: 'active',
      name: `file-${index + 1}.pdf`,
      ext: 'pdf',
      sizeBytes: 10,
      storageKey: `2026/11/${crypto.randomBytes(16).toString('hex')}`,
      isPicture: false,
      hasThumb: false,
      createdBy: people.pm.id,
      createdAt: at,
      updatedAt: at,
    }));
    await db('projectFiles').insert(rows);
    const data = await projectFiles.pickerFiles({ viewer: people.pm, projectId: extra.id });
    expect(data.files).toHaveLength(500);
    expect(data.places[0]).toEqual({ key: 'all', label: 'All files', count: 500 });
  });
});

describe('before migration 020', () => {
  beforeAll(async () => {
    await db.migrate.down({ name: '020_task_file_links.js' });
  });

  afterAll(async () => {
    await db.migrate.latest();
  });

  it('opens with linksReady false and nothing to pick', async () => {
    signInAs(people.pm);
    const answer = await pick(project.id, `?taskId=${task.id}`);
    expect(answer.status).toBe(200);
    expect(answer.json.data).toEqual({
      files: [],
      places: [],
      taskPhase: 'development',
      linksReady: false,
    });
  });
});
