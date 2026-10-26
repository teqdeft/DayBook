// AI limits (CONTRACT 20): the company's daily limit in company-time days, the per-person caps
// (polish 20, ask 30), checked before Gemini is called — also for requests sent at the same
// time — and usageToday() for Settings.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const T0 = '2026-10-26T06:00:00Z'; // 11:30 on Monday 26 October in Kolkata
let alice;
let bob;
let requests;

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
  return error;
}

/** Earlier Gemini requests: `count` rows at `at` (UTC). */
async function usage({ count, at = T0, userId = null, feature = 'polish' }) {
  const rows = Array.from({ length: count }, () => ({
    userId,
    feature,
    model: 'gemini-test',
    ok: true,
    createdAt: new Date(at),
  }));
  await db('ai_usage').insert(rows);
}

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  alice = await createUser({ name: 'Alice Mehta' });
  bob = await createUser({ name: 'Bob Iyer' });
  await setSettings({ ai_enabled: true });
});

beforeEach(async () => {
  setNowForTests(T0);
  await db('ai_usage').delete();
  await setSettings({ ai_daily_limit: 200 });
  requests = 0;
  ai.setTransportForTests(async () => {
    requests += 1;
    return { status: 200, data: ai.fakeGeminiResponse({ text: 'ok' }) };
  });
});

afterAll(() => ai.setTransportForTests(null));

describe('company daily limit', () => {
  it('counts every request of the company-time day', async () => {
    await usage({ count: 2, at: '2026-10-25T18:29:00Z' }); // 23:59 yesterday in Kolkata
    await usage({ count: 3, at: '2026-10-25T18:30:00Z' }); // 00:00 today
    await usage({ count: 1, at: '2026-10-26T18:29:00Z', feature: 'ask', userId: bob.id });
    await usage({ count: 4, at: '2026-10-26T18:30:00Z' }); // tomorrow
    await setSettings({ ai_daily_limit: 50 });
    expect(await ai.usageToday()).toEqual({ used: 4, limit: 50 });
  });

  it('answers AI_LIMIT before calling Gemini once the limit is used', async () => {
    await setSettings({ ai_daily_limit: 3 });
    await usage({ count: 2, userId: bob.id, feature: 'ask' });
    await ai.generate({ feature: 'pm_summary', prompt: 'Summarise' });
    const error = await expectAppError(
      ai.generate({ feature: 'polish', userId: alice.id, prompt: 'Fix' }),
      'AI_LIMIT',
    );
    expect(error).toMatchObject({
      status: 429,
      message: "Daybook's AI has reached today's limit. Try again tomorrow.",
    });
    expect(requests).toBe(1);
    expect(await ai.usageToday()).toEqual({ used: 3, limit: 3 });
  });

  it('starts again on the next company-time day', async () => {
    await setSettings({ ai_daily_limit: 1 });
    await usage({ count: 1, at: '2026-10-26T18:00:00Z' }); // 23:30 in Kolkata
    setNowForTests('2026-10-26T18:20:00Z');
    await expectAppError(ai.generate({ feature: 'ask', prompt: 'x' }), 'AI_LIMIT');
    setNowForTests('2026-10-26T18:31:00Z'); // 00:01 on Tuesday
    await expect(ai.generate({ feature: 'ask', prompt: 'x' })).resolves.toMatchObject({
      text: 'ok',
    });
  });

  it('allows nothing with a limit of 0', async () => {
    await setSettings({ ai_daily_limit: 0 });
    await expectAppError(ai.generate({ feature: 'hr_notes', prompt: 'x' }), 'AI_LIMIT');
    expect(requests).toBe(0);
  });
});

describe('requests at the same time', () => {
  /** Gemini takes a moment, so every request is in flight together. */
  function slowGemini() {
    ai.setTransportForTests(async () => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { status: 200, data: ai.fakeGeminiResponse({ text: 'ok' }) };
    });
  }

  it('never lets one person past their cap', async () => {
    slowGemini();
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () =>
        ai.generate({ feature: 'polish', userId: alice.id, prompt: 'Fix' }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(20);
    const refused = results.filter((result) => result.status === 'rejected');
    expect(refused).toHaveLength(20);
    expect(refused.every((result) => result.reason.code === 'AI_LIMIT')).toBe(true);
    expect(requests).toBe(20);
    const rows = await db('ai_usage').where({ userId: alice.id });
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.ok === true && row.errorCode === null)).toBe(true);
  });

  it("never lets the company past today's limit", async () => {
    await setSettings({ ai_daily_limit: 5 });
    slowGemini();
    const people = [];
    for (let i = 0; i < 15; i += 1) {
      people.push(await createUser({ name: `Parallel ${i}`, email: `parallel${i}@example.com` }));
    }
    const results = await Promise.allSettled(
      people.map((person) => ai.generate({ feature: 'polish', userId: person.id, prompt: 'Fix' })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    expect(requests).toBe(5);
    expect(await ai.usageToday()).toEqual({ used: 5, limit: 5 });
  });

  it('counts a request from the moment it is sent, before Gemini answers', async () => {
    let release;
    ai.setTransportForTests(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 200, data: ai.fakeGeminiResponse({ text: 'ok' }) });
        }),
    );
    const asking = ai.generate({ feature: 'ask', userId: bob.id, prompt: 'Hours?' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await ai.usageToday()).toMatchObject({ used: 1 });
    expect(await db('ai_usage').first()).toMatchObject({ ok: false, errorCode: 'PENDING' });
    release();
    await asking;
    expect(await db('ai_usage').first()).toMatchObject({ ok: true, errorCode: null });
  });
});

describe('per-person caps', () => {
  it('stops a person at 20 polish requests a day, not others', async () => {
    expect(ai.PERSON_DAILY_CAPS).toEqual({ polish: 20, ask: 30 });
    await usage({ count: 19, userId: alice.id, feature: 'polish' });
    await usage({ count: 5, userId: alice.id, feature: 'polish', at: '2026-10-25T10:00:00Z' });
    await ai.generate({ feature: 'polish', userId: alice.id, prompt: 'twentieth' });
    const error = await expectAppError(
      ai.generate({ feature: 'polish', userId: alice.id, prompt: 'one more' }),
      'AI_LIMIT',
    );
    expect(error.message).toBe("You've reached today's AI limit. Try again tomorrow.");
    await ai.generate({ feature: 'polish', userId: bob.id, prompt: 'Bob is fine' });
    await ai.generate({ feature: 'ask', userId: alice.id, prompt: 'Ask is separate' });
    expect(requests).toBe(3);
  });

  it('stops a person at 30 Ask requests a day', async () => {
    await usage({ count: 30, userId: bob.id, feature: 'ask' });
    await expectAppError(ai.generate({ feature: 'ask', userId: bob.id, prompt: 'x' }), 'AI_LIMIT');
    expect(requests).toBe(0);
  });

  it('has no cap for the worker features', async () => {
    await usage({ count: 40, feature: 'pm_summary' });
    await expect(ai.generate({ feature: 'pm_summary', prompt: 'x' })).resolves.toMatchObject({
      text: 'ok',
    });
  });
});
