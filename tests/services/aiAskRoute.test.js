// POST /api/ai/ask (CONTRACT 20): who may ask, the body checks, AI_OFF, and the answer's shape;
// plus the "Ask Daybook" nav item, shown only to Admin, PM and HR while it is available.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationFor } from '@/config/navigation';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { answer, enableAsk, NOW, requests, script } from './aiAskKit.js';

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
const { ai } = await import('@/modules/ai');
const askRoute = await import('@/app/api/ai/ask/route.js');

const EXPIRES = new Date('2026-10-29T04:00:00Z');
let pm;
let hr;
let employee;

function signInAs(user) {
  sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
  jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
}

async function ask(body) {
  const request = new Request(`${env.appOrigin}/api/ai/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: env.appOrigin },
    body: JSON.stringify(body),
  });
  const response = await askRoute.POST(request, { params: Promise.resolve({}) });
  return { status: response.status, json: await response.json() };
}

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  pm = await createUser({ name: 'Priya Sharma', role: 'pm', tracksAttendance: false });
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  employee = await createUser({ name: 'Vishal Saini' });
  await enableAsk();
});

beforeEach(async () => {
  setNowForTests(NOW);
  resetRateLimitsForTests();
  await db('ai_usage').delete();
  script(answer('Nobody was late this week.'));
});

afterAll(() => ai.setTransportForTests(null));

describe('POST /api/ai/ask rate limit', () => {
  it('counts each person, so one person asking quickly never blocks the office', async () => {
    signInAs(pm);
    for (let i = 0; i < 12; i += 1) {
      expect((await ask({ question: `Hours this week? ${i}` })).status).toBe(200);
    }
    const thirteenth = await ask({ question: 'Hours this week?' });
    expect(thirteenth.status).toBe(429);
    expect(thirteenth.json.error.code).toBe('RATE_LIMITED');

    // HR on the same network asks their first question.
    signInAs(hr);
    expect((await ask({ question: 'Who was late this week?' })).status).toBe(200);
  });
});

describe('POST /api/ai/ask', () => {
  it('answers a PM or HR person', async () => {
    signInAs(hr);
    const response = await ask({ question: '  Who was late this week?  ', history: [] });
    expect(response).toEqual({
      status: 200,
      json: { data: { answer: 'Nobody was late this week.' } },
    });
    expect(requests[0].contents[0].parts[0].text).toBe('Who was late this week?');
    signInAs(pm);
    expect((await ask({ question: 'Hours this week?' })).status).toBe(200);
  });

  it('is forbidden to people without team.view or attendance.view_all', async () => {
    signInAs(employee);
    const response = await ask({ question: 'Who was late?' });
    expect(response.status).toBe(403);
    expect(response.json.error.code).toBe('FORBIDDEN');
    expect(requests).toHaveLength(0);
  });

  it('checks the question and the history', async () => {
    signInAs(pm);
    const short = await ask({ question: 'a' });
    expect(short.status).toBe(400);
    expect(short.json.error.fields).toEqual({ question: 'Type a question.' });
    const long = await ask({ question: 'x'.repeat(501) });
    expect(long.json.error.fields.question).toBe('Keep the question to 500 characters or fewer.');
    const turn = { question: 'Hours?', answer: '2h' };
    const history = await ask({ question: 'And today?', history: Array(5).fill(turn) });
    expect(history.status).toBe(400);
    expect(history.json.error.fields.history).toBe('Send at most 4 earlier questions.');
    expect(requests).toHaveLength(0);
  });

  it('answers AI_OFF while AI is off', async () => {
    await setSettings({ ai_enabled: false });
    try {
      signInAs(hr);
      const response = await ask({ question: 'Who was late?' });
      expect(response.status).toBe(409);
      expect(response.json.error).toEqual({ code: 'AI_OFF', message: 'AI is turned off.' });
    } finally {
      await enableAsk();
    }
  });
});

describe('the Ask Daybook nav item', () => {
  const user = (role, tracksAttendance = true) => ({ role, status: 'active', tracksAttendance });
  const keys = (who, features) => navigationFor(who, {}, features).map((item) => item.key);

  it('shows for Admin, PM and HR only while Ask Daybook is available', () => {
    expect(keys(user('pm', false), { ask: true })).toEqual([
      'projects',
      'team',
      'screenTime',
      'attendance',
      'requests',
      'ask',
    ]);
    expect(keys(user('hr'), { ask: true })).toEqual([
      'today',
      'log',
      'attendance',
      'ask',
      'people',
    ]);
    expect(keys(user('admin', false), { ask: true })).toContain('ask');
    expect(keys(user('employee'), { ask: true })).not.toContain('ask');
    expect(keys(user('pm', false))).not.toContain('ask');
    expect(keys(user('hr'), { ask: false })).not.toContain('ask');
  });

  it('links to /ask with the Sparkles icon', () => {
    const item = navigationFor(user('hr'), {}, { ask: true }).find((entry) => entry.key === 'ask');
    expect(item).toMatchObject({ label: 'Ask Daybook', href: '/ask', icon: 'Sparkles', badge: 0 });
  });
});
