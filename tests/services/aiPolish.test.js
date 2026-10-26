// POST /api/ai/polish (CONTRACT 20, "Polish my tasks"): who may call it, the body's limits, the
// request sent to Gemini (fast model, JSON keyed by line ids, never the browser's keys or contact
// details) and the answer: the same keys in order, unusable or missing lines unchanged, anything
// else dropped. AI off, limits and Gemini failures keep their codes. A fake transport stands in for
// Gemini; fetch is blocked.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { POLISHED_LENGTH, usableSuggestion } from '@/app/api/ai/polish/polish';
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
const { resetRateLimitsForTests } = await import('@/lib/route');
const { POST } = await import('@/app/api/ai/polish/route.js');

const T0 = '2026-10-26T06:00:00Z'; // Monday 26 October, 11:30 in Kolkata
const EXPIRES = new Date('2026-11-26T04:00:00Z');
let employee;
let pm;
let requests;

function signInAs(user) {
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function polish(body) {
  const response = await POST(
    new Request('http://localhost:3000/api/ai/polish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: env.appOrigin },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
  return { status: response.status, ...(await response.json()) };
}

/** Gemini answers with this JSON (or a function of the request), and the requests are kept. */
function geminiAnswers(answer, { status = 200 } = {}) {
  requests = [];
  ai.setTransportForTests(async (request) => {
    requests.push(structuredClone({ model: request.model, body: request.body }));
    const data = typeof answer === 'function' ? answer(request) : answer;
    return { status, data: ai.fakeGeminiResponse({ data, usage: { input: 50, output: 20 } }) };
  });
}

const LINES = [
  { key: 't12', title: 'fixed bug login pg', projectName: 'acme-seo' },
  { key: 't13', title: 'Reviewed the homepage copy', projectName: 'acme-seo' },
  { key: 't20', title: 'mail ravi@acme.com abt invoice', projectName: 'internal-tool' },
];

/** Everything the requests sent to Gemini, as one text. */
const sentText = () => JSON.stringify(requests.map((request) => request.body));

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  employee = await createUser({ name: 'Vishal Saini', email: 'vishal@example.com' });
  pm = await createUser({ name: 'Neha Kapoor', role: 'pm', tracksAttendance: false });
});

beforeEach(async () => {
  setNowForTests(T0);
  resetRateLimitsForTests();
  await db('ai_usage').delete();
  await setSettings({ ai_enabled: true, ai_daily_limit: 200, ai_polish_enabled: true });
  signInAs(employee);
});

afterEach(() => {
  ai.setTransportForTests(null);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/ai/polish', () => {
  it('returns every key once, in order, with Gemini’s line or the line as it was', async () => {
    geminiAnswers({
      L1: 'Fixed the login page bug',
      L2: 'Reviewed the homepage copy',
      L3: 'Emailed ravi@acme.com about the invoice',
      L9: 'A line nobody asked for',
      t12: 'Not a line id',
    });
    const answer = await polish({ lines: LINES });
    expect(answer.status).toBe(200);
    expect(answer.data).toEqual({
      lines: [
        { key: 't12', title: 'Fixed the login page bug' },
        { key: 't13', title: 'Reviewed the homepage copy' },
        { key: 't20', title: 'Emailed ravi@acme.com about the invoice' },
      ],
    });
  });

  it('asks the fast model for JSON keyed by line ids, without browser keys or emails', async () => {
    geminiAnswers({ L1: 'Fixed the login page bug' });
    await polish({ lines: LINES });
    expect(requests).toHaveLength(1);
    const [{ model, body }] = requests;
    expect(model).toBe(env.GEMINI_MODEL);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    const schema = body.generationConfig.responseJsonSchema;
    expect(Object.keys(schema.properties)).toEqual(['L1', 'L2', 'L3']);
    expect(schema.required).toEqual(['L1', 'L2', 'L3']);
    const text = sentText();
    expect(text).toContain('fixed bug login pg');
    expect(text).toContain('acme-seo');
    expect(text).toContain('at most 120 characters');
    expect(text).not.toContain('t12');
    expect(text).not.toContain('ravi@acme.com');
    expect(text).not.toContain('Vishal');

    const [row] = await db('ai_usage');
    expect(row).toMatchObject({ feature: 'polish', userId: employee.id, ok: true });
  });

  it('keeps a line when Gemini skips it, leaves it empty or answers something unusable', async () => {
    geminiAnswers({
      L1: '   ',
      L2: 'x'.repeat(POLISHED_LENGTH + 1),
      L3: 'Emailed [email 2] and boss@acme.com',
    });
    const answer = await polish({ lines: LINES });
    expect(answer.data.lines.map((line) => line.title)).toEqual(LINES.map((line) => line.title));

    geminiAnswers(['not', 'an', 'object']);
    const list = await polish({ lines: LINES.slice(0, 1) });
    expect(list.data).toEqual({ lines: [{ key: 't12', title: 'fixed bug login pg' }] });
  });

  it('takes 1 to 60 lines with their own keys and titles up to 500 characters', async () => {
    geminiAnswers({});
    const line = (i, title = `task ${i}`) => ({ key: `t${i}`, title, projectName: 'acme-seo' });
    const cases = [
      [{ lines: [] }, 'lines', 'There are no tasks to polish.'],
      [
        { lines: Array.from({ length: 61 }, (_, i) => line(i)) },
        'lines',
        'Polish up to 60 tasks at a time.',
      ],
      [
        { lines: [line(1, 'x'.repeat(501))] },
        'lines.0.title',
        'Keep the task under 500 characters.',
      ],
      [{ lines: [line(1, '   ')] }, 'lines.0.title', 'Write the task first.'],
      [{ lines: [line(1), line(1)] }, 'lines.1.key', 'Each task needs its own key.'],
    ];
    for (const [body, field, message] of cases) {
      const answer = await polish(body);
      expect(answer.status, field).toBe(400);
      expect(answer.error.code).toBe('VALIDATION_FAILED');
      expect(answer.error.fields[field], field).toBe(message);
    }
    expect(requests).toHaveLength(0);

    const sixty = await polish({ lines: Array.from({ length: 60 }, (_, i) => line(i)) });
    expect(sixty.status).toBe(200);
    expect(sixty.data.lines).toHaveLength(60);
    const noProject = await polish({ lines: [{ key: 'a', title: 'Write docs' }] });
    expect(noProject.data).toEqual({ lines: [{ key: 'a', title: 'Write docs' }] });
  });

  it('is for people who write reports', async () => {
    geminiAnswers({ L1: 'Fixed' });
    signInAs(pm);
    expect((await polish({ lines: LINES })).status).toBe(403);
    signInAs(null);
    jar.clear();
    expect((await polish({ lines: LINES })).status).toBe(401);
    expect(requests).toHaveLength(0);
  });

  it('answers AI_OFF while AI or Polish my tasks is off, without calling Gemini', async () => {
    geminiAnswers({ L1: 'Fixed' });
    for (const off of [{ ai_polish_enabled: false }, { ai_enabled: false }]) {
      await setSettings({ ai_enabled: true, ai_polish_enabled: true, ...off });
      const answer = await polish({ lines: LINES });
      expect(answer.status).toBe(409);
      expect(answer.error).toMatchObject({ code: 'AI_OFF', message: 'AI is turned off.' });
    }
    expect(requests).toHaveLength(0);
  });

  it('stops after 20 polish requests a person a day, and on the company limit', async () => {
    geminiAnswers({ L1: 'Fixed the login page bug' });
    for (let i = 0; i < 20; i += 1) {
      // Six seconds apart: ten a minute is the most one person may send.
      setNowForTests(new Date(Date.parse(T0) + i * 6000).toISOString());
      expect((await polish({ lines: LINES.slice(0, 1) })).status).toBe(200);
    }
    setNowForTests(new Date(Date.parse(T0) + 20 * 6000).toISOString());
    const capped = await polish({ lines: LINES.slice(0, 1) });
    expect(capped.status).toBe(429);
    expect(capped.error).toMatchObject({
      code: 'AI_LIMIT',
      message: "You've reached today's AI limit. Try again tomorrow.",
    });
    expect(requests).toHaveLength(20);

    // The next company day starts again; a company limit of 0 stops everyone.
    setNowForTests('2026-10-26T19:00:00Z'); // 00:30 on Tuesday in Kolkata
    expect((await polish({ lines: LINES.slice(0, 1) })).status).toBe(200);
    await setSettings({ ai_daily_limit: 0 });
    const company = await polish({ lines: LINES.slice(0, 1) });
    expect(company.status).toBe(429);
    expect(company.error.message).toBe(
      "Daybook's AI has reached today's limit. Try again tomorrow.",
    );
  });

  it('rate-limits each person, not the office network everyone shares', async () => {
    geminiAnswers({ L1: 'Fixed the login page bug' });
    for (let i = 0; i < 10; i += 1) {
      expect((await polish({ lines: LINES.slice(0, 1) })).status).toBe(200);
    }
    const stuck = await polish({ lines: LINES.slice(0, 1) });
    expect(stuck.status).toBe(429);
    expect(stuck.error.code).toBe('RATE_LIMITED');
    expect(requests).toHaveLength(10);

    // Someone else at the same address still gets an answer.
    signInAs(await createUser({ name: 'Asha Rao', email: 'asha@example.com' }));
    expect((await polish({ lines: LINES.slice(0, 1) })).status).toBe(200);
  });

  it('maps Gemini being busy or failing to AI_BUSY and AI_ERROR', async () => {
    geminiAnswers({ error: { status: 'RESOURCE_EXHAUSTED' } }, { status: 429 });
    const busy = await polish({ lines: LINES });
    expect(busy.status).toBe(503);
    expect(busy.error.code).toBe('AI_BUSY');

    geminiAnswers({ error: { status: 'INTERNAL' } }, { status: 500 });
    const failed = await polish({ lines: LINES });
    expect(failed.status).toBe(502);
    expect(failed.error.code).toBe('AI_ERROR');
  });
});

describe('usableSuggestion', () => {
  it('tidies spaces and refuses answers that would change the facts', () => {
    expect(usableSuggestion('  Fixed\nthe   login bug ', 'fixed login bug')).toBe(
      'Fixed the login bug',
    );
    expect(usableSuggestion(42, 'fixed login bug')).toBe('fixed login bug');
    // A long line may stay long, but not grow.
    const long = 'a'.repeat(200);
    expect(usableSuggestion('b'.repeat(180), long)).toBe('b'.repeat(180));
    expect(usableSuggestion('b'.repeat(201), long)).toBe(long);
    // A placeholder the AI core couldn't put back, or an email the line didn't have.
    expect(usableSuggestion('Called [phone 1]', 'called client')).toBe('called client');
    expect(usableSuggestion('Mailed a@b.co', 'mailed client')).toBe('mailed client');
    expect(usableSuggestion('Mailed A@B.co', 'mailed a@b.co')).toBe('Mailed A@B.co');
  });
});
