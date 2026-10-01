// Project report API: who may call it (team.view: PMs on any project, Admin; never employees or
// HR), 404 for an unknown project, query validation and the Excel download.
import ExcelJS from 'exceljs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase } from '../helpers/db.js';
import { NOW, addMembers, createProject, createReport } from './dashboardKit.js';

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
const { GET: getReport } = await import('@/app/api/projects/[id]/report/route.js');
const { GET: getExport } = await import('@/app/api/projects/[id]/report/export/route.js');

const EXPIRES = new Date('2026-10-26T04:00:00Z');
let otherPm;
let project;

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

function call(handler, id, query = '') {
  const request = new Request(`http://localhost:3000/api/projects/${id}/report${query}`);
  return handler(request, { params: Promise.resolve({ id: String(id) }) });
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(NOW);
  const pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  otherPm = await createUser({ name: 'Other PM', role: 'pm', tracksAttendance: false });
  const worker = await createUser({ name: 'Worker' });
  project = await createProject(pm, { name: 'lyra' });
  await addMembers(project, [worker]);
  await createReport(worker, '2026-09-29', {
    entries: [
      { projectId: project.id, minutes: 120, tasks: [{ title: 'Ship it', status: 'done' }] },
    ],
  });
  await createReport(worker, '2026-09-30', {
    entries: [{ projectId: project.id, minutes: 60, tasks: [{ title: 'More', status: 'done' }] }],
  });
});

beforeEach(() => {
  jar.clear();
  sessionUser = null;
});

describe('GET /api/projects/:id/report', () => {
  it('needs a signed-in person', async () => {
    const response = await call(getReport, project.id);
    expect(response.status).toBe(401);
  });

  it('is forbidden for employees and HR', async () => {
    signInAs({ id: 900, role: 'employee' });
    expect((await call(getReport, project.id)).status).toBe(403);
    signInAs({ id: 901, role: 'hr' });
    expect((await call(getReport, project.id)).status).toBe(403);
    expect((await call(getExport, project.id)).status).toBe(403);
  });

  it('lets a PM read any project, not only their own, and Admin too', async () => {
    signInAs({ id: otherPm.id, role: 'pm' });
    const response = await call(getReport, project.id);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.project.name).toBe('lyra');
    expect(data.totals).toMatchObject({ minutes: 180, people: 1, tasksDone: 2 });
    signInAs({ id: 902, role: 'admin' });
    expect((await call(getReport, project.id, '?range=week')).status).toBe(200);
  });

  it('pages the daily log on its own with section=entries', async () => {
    signInAs({ id: otherPm.id, role: 'pm' });
    const response = await call(getReport, project.id, '?section=entries&limit=1&offset=1');
    const { data } = await response.json();
    expect(Object.keys(data).sort()).toEqual(['entries', 'entriesPage']);
    expect(data.entriesPage).toEqual({ limit: 1, offset: 1, total: 2 });
    expect(data.entries[0].workDate).toBe('2026-09-29');
  });

  it('is 404 for an unknown or malformed project id', async () => {
    signInAs({ id: otherPm.id, role: 'pm' });
    expect((await call(getReport, 999999)).status).toBe(404);
    expect((await call(getReport, 'abc')).status).toBe(404);
    expect((await call(getReport, `0x${project.id.toString(16)}`)).status).toBe(404);
    expect((await call(getExport, 999999)).status).toBe(404);
  });

  it('rejects a bad range with field errors', async () => {
    signInAs({ id: otherPm.id, role: 'pm' });
    const response = await call(getReport, project.id, '?range=custom&from=2026-09-10');
    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fields.from).toBe('Pick a start and an end date.');
    expect((await call(getReport, project.id, '?limit=500')).status).toBe(400);
  });
});

describe('GET /api/projects/:id/report/export', () => {
  it('downloads an Excel file ExcelJS can read back', async () => {
    signInAs({ id: otherPm.id, role: 'pm' });
    const response = await call(getExport, project.id, '?range=month');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="daybook-project-lyra-2026-09-01-to-2026-09-30.xlsx"',
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await response.arrayBuffer());
    expect(book.getWorksheet('Daily log').rowCount).toBe(3);
    expect(book.getWorksheet('Tasks').getCell('A2').value).toBe('More');
  });
});
