// The document and AI summary API (CONTRACT 22): permissions, ids, response shapes, 413 for a raw
// body over 1 MB before anything parses it, and 4 summaries a minute per person. Fake transport only.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import { geminiAnswers, NOTE_TEXT, SAMPLE_ANSWER, T0 } from './projectSummariesKit.js';

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
const { ai } = await import('@/modules/ai');
const documentsRoute = await import('@/app/api/projects/[id]/documents/route.js');
const documentRoute = await import('@/app/api/project-documents/[id]/route.js');
const summaryRoute = await import('@/app/api/ai/projects/[id]/summary/route.js');
const tasksRoute = await import('@/app/api/ai/projects/[id]/summary/tasks/route.js');

const EXPIRES = new Date('2026-11-30T04:00:00Z');
const ONE_MB = 1024 * 1024;
let admin;
let pm;
let otherPm;
let hr;
let member;
let project;

function signInAs(user) {
  sessionUser = user && { ...user, status: user.status ?? 'active', sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

/** Calls a route handler; `raw` sends that text as it is, `body` as JSON. */
async function call(handler, { method = 'POST', id, body, raw, headers = {} }) {
  const hasBody = raw !== undefined || body !== undefined;
  const request = new Request(`${env.appOrigin}/api/x/${id}`, {
    method,
    headers: { origin: env.appOrigin, 'content-type': 'application/json', ...headers },
    body: hasBody ? (raw ?? JSON.stringify(body)) : undefined,
  });
  const response = await handler(request, { params: Promise.resolve({ id: String(id) }) });
  return { status: response.status, json: await response.json() };
}

const NOTE = { phase: 'design', kind: 'note', title: 'Kickoff call notes', text: NOTE_TEXT };
const addDocument = (id, body) => call(documentsRoute.POST, { id, body });
const getDocument = (id) => call(documentRoute.GET, { method: 'GET', id });
const patchDocument = (id, body) => call(documentRoute.PATCH, { method: 'PATCH', id, body });
const deleteDocument = (id) => call(documentRoute.DELETE, { method: 'DELETE', id });
const writeSummary = (id) => call(summaryRoute.POST, { id });
const addAction = (id, body) => call(tasksRoute.POST, { id, body });

async function newNote() {
  signInAs(pm);
  return (await addDocument(project.id, NOTE)).json.data;
}

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  pm = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  otherPm = await createUser({ name: 'Omar Other', role: 'pm', tracksAttendance: false });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  member = await createUser({ name: 'Mia Member' });
  project = await createProject(pm, { name: 'lyra' });
  await addMembers(project, [member]);
});

beforeEach(async () => {
  setNowForTests(T0);
  resetRateLimitsForTests();
  await setSettings({ ai_enabled: true, ai_project_summary_enabled: true });
  signInAs(pm);
});

afterEach(() => {
  ai.setTransportForTests(null);
});

describe('documents', () => {
  it('adds with 201 and no text, reads with the text, edits and deletes', async () => {
    const added = await addDocument(project.id, NOTE);
    expect(added.status).toBe(201);
    expect(added.json.data).toMatchObject({ kind: 'note', title: 'Kickoff call notes' });
    expect(added.json.data).not.toHaveProperty('body');
    const { id } = added.json.data;
    const read = await getDocument(id);
    expect(read.status).toBe(200);
    expect(read.json.data.body).toBe(NOTE_TEXT);
    const edited = await patchDocument(id, { title: 'Renamed' });
    expect(edited.status).toBe(200);
    expect(edited.json.data.title).toBe('Renamed');
    expect(edited.json.data).not.toHaveProperty('body');
    const deleted = await deleteDocument(id);
    expect(deleted.json.data).toEqual({ id, deleted: true });
    expect((await getDocument(id)).status).toBe(404);
  });

  it('names the field that failed, in words for people', async () => {
    const { status, json } = await addDocument(project.id, { ...NOTE, title: ' ' });
    expect(status).toBe(400);
    expect(json.error.code).toBe('VALIDATION_FAILED');
    expect(json.error.fields.title).toBe('Add a title and the note text.');
    for (const body of ['"text"', '[]', 'null']) {
      const parsed = await call(documentsRoute.POST, { id: project.id, raw: body });
      expect(parsed.status, body).toBe(400);
    }
    expect((await call(documentsRoute.POST, { id: project.id, raw: '{nope' })).status).toBe(400);
  });

  it('answers 404 for an id that is not one', async () => {
    for (const id of ['abc', '0', '-1', '1e3', '999999']) {
      expect((await addDocument(id, NOTE)).status, id).toBe(404);
      expect((await getDocument(id)).status, id).toBe(404);
      expect((await patchDocument(id, { title: 'x' })).status, id).toBe(404);
      expect((await deleteDocument(id)).status, id).toBe(404);
    }
  });

  it('answers everyone else 404 on reads and 403 on writes', async () => {
    const note = await newNote();
    for (const user of [otherPm, hr, member]) {
      signInAs(user);
      const read = await getDocument(note.id);
      expect(read.status, user.name).toBe(404);
      expect(read.json.error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(read.json)).not.toContain('Client approved');
      expect((await addDocument(project.id, NOTE)).status, user.name).toBe(403);
      expect((await patchDocument(note.id, { title: 'x' })).status, user.name).toBe(403);
      expect((await deleteDocument(note.id)).status, user.name).toBe(403);
    }
    signInAs(admin);
    expect((await getDocument(note.id)).json.data.body).toBe(NOTE_TEXT);
  });

  it('asks for a session first', async () => {
    const note = await newNote();
    sessionUser = null;
    expect((await getDocument(note.id)).status).toBe(401);
    expect((await addDocument(project.id, NOTE)).status).toBe(401);
  });

  it('checks where a change came from', async () => {
    const response = await documentsRoute.POST(
      new Request(`${env.appOrigin}/api/x`, {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        body: JSON.stringify(NOTE),
      }),
      { params: Promise.resolve({ id: String(project.id) }) },
    );
    expect(response.status).toBe(403);
  });
});

describe('a body over 1 MB', () => {
  const big = 'x'.repeat(ONE_MB + 1);

  function expectTooLarge({ status, json }) {
    expect(status).toBe(413);
    expect(json.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'That request is too large.',
    });
  }

  it('is refused with 413 on every route that reads a body, before it is parsed', async () => {
    const note = await newNote();
    expectTooLarge(await call(documentsRoute.POST, { id: project.id, raw: big }));
    expectTooLarge(await call(documentRoute.PATCH, { method: 'PATCH', id: note.id, raw: big }));
    expectTooLarge(await call(summaryRoute.POST, { id: project.id, raw: big }));
    expectTooLarge(await call(tasksRoute.POST, { id: project.id, raw: big }));
  });

  it('is refused from its Content-Length alone', async () => {
    expectTooLarge(
      await call(documentsRoute.POST, {
        id: project.id,
        raw: '{}',
        headers: { 'content-length': String(ONE_MB + 1) },
      }),
    );
  });

  it('is not needed for the longest text, in any script', async () => {
    const text = 'ग'.repeat(200_000); // 600,000 bytes
    const long = await createProject(pm, { name: 'long-text' });
    const { status, json } = await addDocument(long.id, { ...NOTE, text });
    expect(status).toBe(201);
    expect(json.data.charCount).toBe(200_000);
  });
});

describe('POST /api/ai/projects/:id/summary', () => {
  it('writes the summary and returns it', async () => {
    await newNote();
    geminiAnswers({ overview: 'A short overview.' });
    const { status, json } = await writeSummary(project.id);
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      stale: false,
      truncated: false,
      updatedByName: 'Riya Kapoor',
      body: { overview: 'A short overview.' },
    });
  });

  it('answers everyone else 403, and calls no AI', async () => {
    await newNote();
    const requests = geminiAnswers({ overview: 'x y' });
    for (const user of [otherPm, hr, member]) {
      signInAs(user);
      expect((await writeSummary(project.id)).status, user.name).toBe(403);
    }
    expect(requests).toHaveLength(0);
  });

  it('answers 409 while AI is off', async () => {
    await newNote();
    await setSettings({ ai_project_summary_enabled: false });
    const { status, json } = await writeSummary(project.id);
    expect(status).toBe(409);
    expect(json.error.code).toBe('AI_OFF');
  });

  it('allows 4 a minute per person, whichever project', async () => {
    await newNote();
    const other = await createProject(pm, { name: 'vega' });
    geminiAnswers({ overview: 'x y' });
    for (const id of [project.id, project.id, project.id, project.id]) {
      expect((await writeSummary(id)).status).toBe(200);
    }
    const limited = await writeSummary(project.id);
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe('RATE_LIMITED');
    expect((await writeSummary(other.id)).status).toBe(429);
    signInAs(admin);
    expect((await writeSummary(project.id)).status).toBe(200);
    signInAs(pm);
    setNowForTests('2026-10-30T06:01:01Z');
    expect((await writeSummary(project.id)).status).toBe(200);
  });
});

describe('POST /api/ai/projects/:id/summary/tasks', () => {
  async function summary() {
    await newNote();
    geminiAnswers(SAMPLE_ANSWER);
    return (await writeSummary(project.id)).json.data;
  }

  it('adds the task once, and answers 409 when the item is gone', async () => {
    const { body } = await summary();
    const { key } = body.actions[0];
    const first = await addAction(project.id, { actionKey: key });
    expect(first.status).toBe(200);
    expect(first.json.data.task).toMatchObject({ priority: 'p2', title: body.actions[0].text });
    const again = await addAction(project.id, { actionKey: key });
    expect(again.json.data.taskId).toBe(first.json.data.taskId);
    const gone = await addAction(project.id, { actionKey: 'gone' });
    expect(gone.status).toBe(409);
    expect(gone.json.error.message).toBe('The summary changed. Reload the page.');
    expect((await addAction(project.id, {})).status).toBe(400);
  });

  it('answers everyone else 403', async () => {
    const { body } = await summary();
    for (const user of [otherPm, hr, member]) {
      signInAs(user);
      const { status } = await addAction(project.id, { actionKey: body.actions[0].key });
      expect(status, user.name).toBe(403);
    }
  });
});
