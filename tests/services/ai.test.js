// AI core (CONTRACT 20): availability, ai.generate() answers and failures, and the ai_usage row
// each Gemini request writes. A fake transport stands in for Gemini; fetch is blocked.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const T0 = '2026-10-26T06:00:00Z'; // 11:30 in Kolkata
let alice;
let requests;

/** Gemini answers in turn (the last one repeats): { status, data }, an Error, or a function. */
function replyWith(...replies) {
  requests = [];
  ai.setTransportForTests(async (request) => {
    requests.push(structuredClone({ model: request.model, body: request.body }));
    const next = replies.length > 1 ? replies.shift() : replies[0];
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(request) : next;
  });
}

const ok = (reply) => ({ status: 200, data: ai.fakeGeminiResponse(reply) });

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
  return error;
}

const usageRows = () => db('ai_usage').orderBy('id');

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  alice = await createUser({ name: 'Alice Mehta' });
});

beforeEach(async () => {
  setNowForTests(T0);
  await db('ai_usage').delete();
  await setSettings({
    ai_enabled: true,
    ai_daily_limit: 200,
    ai_polish_enabled: true,
    ai_pm_summary_enabled: true,
    ai_hr_notes_enabled: true,
    ai_ask_enabled: true,
  });
  replyWith(ok({ text: 'Hello' }));
});

afterEach(() => {
  ai.setTransportForTests(null);
  ai.setApiKeyForTests(undefined);
  ai.setTimeoutForTests(null);
  vi.restoreAllMocks();
});

describe('isAvailable', () => {
  it('is on when the key is set, AI is on and the feature is on', async () => {
    for (const feature of ['polish', 'pm_summary', 'hr_notes', 'ask']) {
      expect(await ai.isAvailable(feature)).toBe(true);
    }
    expect(await ai.isAvailable('poetry')).toBe(false);
  });

  it('follows the AI switch and each feature switch', async () => {
    await setSettings({ ai_ask_enabled: false });
    expect(await ai.isAvailable('ask')).toBe(false);
    expect(await ai.isAvailable('polish')).toBe(true);
    await setSettings({ ai_enabled: false });
    expect(await ai.isAvailable('polish')).toBe(false);
  });

  it('is off without an API key, and generate answers AI_OFF without calling Gemini', async () => {
    ai.setApiKeyForTests('');
    expect(await ai.isAvailable('polish')).toBe(false);
    await expectAppError(ai.generate({ feature: 'polish', prompt: 'Fix this' }), 'AI_OFF');
    expect(requests).toHaveLength(0);
    expect(await usageRows()).toHaveLength(0);
  });

  it('answers AI_OFF when the feature is switched off', async () => {
    await setSettings({ ai_polish_enabled: false });
    const error = await expectAppError(
      ai.generate({ feature: 'polish', userId: alice.id, prompt: 'Fix this' }),
      'AI_OFF',
    );
    expect(error).toMatchObject({ status: 409, message: 'AI is turned off.' });
    expect(requests).toHaveLength(0);
  });
});

describe('generate', () => {
  it('returns the text and writes one usage row without the prompt or answer', async () => {
    const result = await ai.generate({
      feature: 'polish',
      userId: alice.id,
      system: 'Rewrite task lines.',
      prompt: 'fixd the login bug',
    });
    expect(result).toEqual({ text: 'Hello', data: null });
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe(env.GEMINI_MODEL);
    expect(requests[0].body).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'fixd the login bug' }] }],
      systemInstruction: { parts: [{ text: 'Rewrite task lines.' }] },
    });
    const rows = await usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: alice.id,
      feature: 'polish',
      model: env.GEMINI_MODEL,
      ok: true,
      errorCode: null,
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(rows[0].createdAt.toISOString()).toBe('2026-10-26T06:00:00.000Z');
  });

  it('uses the smart model for Ask and no person for worker requests', async () => {
    await ai.generate({ feature: 'ask', userId: alice.id, model: 'smart', prompt: 'Hours?' });
    await ai.generate({ feature: 'pm_summary', prompt: 'Summarise' });
    expect(requests.map((request) => request.model)).toEqual([
      env.GEMINI_SMART_MODEL,
      env.GEMINI_MODEL,
    ]);
    const rows = await usageRows();
    expect(rows.map((row) => [row.feature, row.userId, row.model])).toEqual([
      ['ask', alice.id, env.GEMINI_SMART_MODEL],
      ['pm_summary', null, env.GEMINI_MODEL],
    ]);
    // Only the smart model is told to think 'low' (a Gemini 3 Flash by default).
    expect(requests[0].body.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'low' } });
    expect(requests[1].body.generationConfig).toBeUndefined();
  });

  describe('when the smart model is busy', () => {
    const busy503 = { status: 503, data: { error: { code: 503, status: 'UNAVAILABLE' } } };
    const ask = (input = {}) =>
      ai.generate({ feature: 'ask', userId: alice.id, model: 'smart', prompt: 'Hours?', ...input });

    it('asks the fast model once instead, and records both requests', async () => {
      replyWith(busy503, ok({ text: 'Acme: 2h 15m' }));
      expect(await ask()).toEqual({ text: 'Acme: 2h 15m', data: null });
      expect(requests.map((request) => request.model)).toEqual([
        env.GEMINI_SMART_MODEL,
        env.GEMINI_MODEL,
      ]);
      // The fast model gets no thinking level.
      expect(requests[1].body.generationConfig).toBeUndefined();
      const rows = await usageRows();
      expect(rows.map((row) => [row.model, row.ok, row.errorCode])).toEqual([
        [env.GEMINI_SMART_MODEL, false, 'AI_BUSY'],
        [env.GEMINI_MODEL, true, null],
      ]);
    });

    it('falls back after a timeout or a 429 too, but not after other failures', async () => {
      ai.setTimeoutForTests(20);
      const hang = ({ signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        });
      replyWith(hang, ok({ text: 'From the fast model' }));
      expect((await ask()).text).toBe('From the fast model');

      replyWith({ status: 429, data: null }, ok({ text: 'Also fast' }));
      expect((await ask()).text).toBe('Also fast');

      replyWith({ status: 500, data: null }, ok({ text: 'Never asked' }));
      await expectAppError(ask(), 'AI_ERROR');
      expect(requests).toHaveLength(1);
    });

    it('answers AI_BUSY when the fast model is busy as well, without a third try', async () => {
      replyWith(busy503);
      await expectAppError(ask(), 'AI_BUSY');
      expect(requests.map((request) => request.model)).toEqual([
        env.GEMINI_SMART_MODEL,
        env.GEMINI_MODEL,
      ]);
    });

    it('never falls back for the fast model or after a tool round has run', async () => {
      replyWith(busy503);
      await expectAppError(ai.generate({ feature: 'polish', prompt: 'fixd it' }), 'AI_BUSY');
      expect(requests).toHaveLength(1);

      const onToolCall = vi.fn(() => ({ rows: [] }));
      const tools = [{ name: 'list_projects', description: 'Projects' }];
      replyWith(ok({ calls: [{ name: 'list_projects' }] }), busy503);
      await expectAppError(ask({ tools, onToolCall }), 'AI_BUSY');
      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(requests.map((request) => request.model)).toEqual([
        env.GEMINI_SMART_MODEL,
        env.GEMINI_SMART_MODEL,
      ]);
    });

    it('counts the fallback against the daily limit', async () => {
      await setSettings({ ai_daily_limit: 1 });
      replyWith(busy503, ok({ text: 'Never asked' }));
      await expectAppError(ask(), 'AI_LIMIT');
      expect(requests).toHaveLength(1);
    });
  });

  it('asks for JSON with the schema and returns the parsed object', async () => {
    const schema = {
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
      required: ['title', 'body'],
    };
    replyWith(ok({ data: { title: 'Today', body: '- Done: 3 tasks' } }));
    const result = await ai.generate({ feature: 'pm_summary', prompt: 'Summarise', json: schema });
    expect(result.data).toEqual({ title: 'Today', body: '- Done: 3 tasks' });
    expect(requests[0].body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
    });
  });

  it('answers AI_ERROR when the JSON does not parse, and records the failed request', async () => {
    replyWith(ok({ text: '{"title": "Tod' }));
    await expectAppError(
      ai.generate({ feature: 'pm_summary', prompt: 'Summarise', json: { type: 'object' } }),
      'AI_ERROR',
    );
    expect(await usageRows()).toMatchObject([
      { ok: false, errorCode: 'AI_ERROR', inputTokens: 10, outputTokens: 5 },
    ]);
  });

  it('maps HTTP 429 and 503 to AI_BUSY and other failures to AI_ERROR', async () => {
    replyWith(
      { status: 429, data: { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } } },
      { status: 503, data: { error: { code: 503, status: 'UNAVAILABLE' } } },
      { status: 500, data: { error: { code: 500, status: 'INTERNAL' } } },
      new TypeError('fetch failed'),
      ok({ text: '   ' }),
      { status: 200, data: { promptFeedback: { blockReason: 'SAFETY' } } },
    );
    const busy = await expectAppError(ai.generate({ feature: 'ask', prompt: 'a' }), 'AI_BUSY');
    expect(busy).toMatchObject({ status: 503, message: 'Gemini is busy. Try again in a minute.' });
    await expectAppError(ai.generate({ feature: 'ask', prompt: 'b' }), 'AI_BUSY');
    const failed = await expectAppError(ai.generate({ feature: 'ask', prompt: 'c' }), 'AI_ERROR');
    expect(failed.status).toBe(502);
    await expectAppError(ai.generate({ feature: 'ask', prompt: 'd' }), 'AI_ERROR');
    await expectAppError(ai.generate({ feature: 'ask', prompt: 'e' }), 'AI_ERROR');
    await expectAppError(ai.generate({ feature: 'ask', prompt: 'f' }), 'AI_ERROR');
    const rows = await usageRows();
    expect(rows.map((row) => [row.ok, row.errorCode])).toEqual([
      [false, 'AI_BUSY'],
      [false, 'AI_BUSY'],
      [false, 'AI_ERROR'],
      [false, 'AI_ERROR'],
      [false, 'AI_ERROR'],
      [false, 'AI_ERROR'],
    ]);
  });

  it('gives up after the timeout with AI_BUSY', async () => {
    ai.setTimeoutForTests(20);
    replyWith(
      ({ signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    await expectAppError(ai.generate({ feature: 'polish', prompt: 'slow' }), 'AI_BUSY');
    expect(await usageRows()).toMatchObject([{ ok: false, errorCode: 'AI_BUSY' }]);
  });

  it('answers AI_ERROR when Gemini calls a function nobody offered', async () => {
    replyWith(ok({ calls: [{ name: 'list_people' }] }));
    await expectAppError(ai.generate({ feature: 'ask', prompt: 'Who?' }), 'AI_ERROR');
  });

  it('never sends emails, phone numbers or IPs, and never logs the prompt', async () => {
    const warn = vi.spyOn(logger, 'warn');
    replyWith(ok({ text: 'Call [phone 1] about the invoice ([email 1])' }), {
      status: 500,
      data: null,
    });
    const result = await ai.generate({
      feature: 'polish',
      system: 'Owner: ops@acme.com',
      prompt: 'Called +91 98765 43210 from 10.0.0.12 about the Acme invoice',
    });
    expect(requests[0].body.systemInstruction.parts[0].text).toBe('Owner: [email 1]');
    expect(requests[0].body.contents[0].parts[0].text).toBe(
      'Called [phone 1] from [ip 1] about the Acme invoice',
    );
    // The details come back in the answer, which stays in Daybook.
    expect(result.text).toBe('Call +91 98765 43210 about the invoice (ops@acme.com)');
    await expectAppError(
      ai.generate({ feature: 'polish', prompt: 'Secret roadmap for Acme' }),
      'AI_ERROR',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Secret roadmap');
  });

  it('refuses a malformed call (a programming mistake)', async () => {
    await expect(ai.generate({ feature: 'poetry', prompt: 'x' })).rejects.toThrow(TypeError);
    await expect(ai.generate({ feature: 'polish', prompt: ' ' })).rejects.toThrow(/prompt/);
    await expect(ai.generate({ feature: 'polish', model: 'big', prompt: 'x' })).rejects.toThrow(
      /model/,
    );
    await expect(
      ai.generate({ feature: 'ask', prompt: 'x', tools: [{ name: 'a', description: 'b' }] }),
    ).rejects.toThrow(/onToolCall/);
    expect(requests).toHaveLength(0);
  });
});
