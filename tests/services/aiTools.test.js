// Ask Daybook's engine (CONTRACT 20): Gemini function calling through ai.generate({ tools,
// onToolCall }), at most 5 rounds, with a fake transport in place of Gemini.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { ai } from '@/modules/ai';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const TOOLS = [
  { name: 'list_projects', description: 'Projects the viewer can see.' },
  {
    name: 'hours_by_project',
    description: 'Hours per project between two dates.',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
];

let viewer;
let requests;

/** Gemini answers in turn (the last one repeats). */
function replyWith(...replies) {
  requests = [];
  ai.setTransportForTests(async ({ body }) => {
    requests.push(structuredClone(body));
    const next = replies.length > 1 ? replies.shift() : replies[0];
    return { status: 200, data: next };
  });
}

/** A function-call answer whose part carries a thought signature (Gemini 3). */
function callAnswer(calls) {
  const data = ai.fakeGeminiResponse({ calls });
  data.candidates[0].content.parts[0].thoughtSignature = 'c2lnbmF0dXJl';
  return data;
}

const ask = (onToolCall, extra = {}) =>
  ai.generate({
    feature: 'ask',
    userId: viewer.id,
    model: 'smart',
    system: 'Answer from the tools only.',
    prompt: 'How many hours on acme-seo this week?',
    tools: TOOLS,
    onToolCall,
    ...extra,
  });

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
}

beforeAll(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('No network in tests')));
  await resetDatabase();
  viewer = await createUser({ name: 'Priya PM', role: 'pm' });
  await setSettings({ ai_enabled: true, ai_daily_limit: 2000 });
});

beforeEach(async () => {
  setNowForTests('2026-10-26T06:00:00Z');
  await db('ai_usage').delete();
});

afterAll(() => ai.setTransportForTests(null));

describe('function calling', () => {
  it('runs the calls, sends the results back and returns the final answer', async () => {
    const first = callAnswer([
      { id: 'call-1', name: 'hours_by_project', args: { from: '2026-10-26' } },
    ]);
    replyWith(first, ai.fakeGeminiResponse({ text: 'acme-seo: 12h 30m this week.' }));
    const onToolCall = vi.fn(async () => [{ projectName: 'acme-seo', minutes: 750 }]);
    const result = await ask(onToolCall);

    expect(result).toEqual({ text: 'acme-seo: 12h 30m this week.', data: null });
    expect(onToolCall).toHaveBeenCalledWith('hours_by_project', { from: '2026-10-26' });
    expect(requests).toHaveLength(2);
    expect(requests[0].tools[0].functionDeclarations.map((tool) => tool.name)).toEqual([
      'list_projects',
      'hours_by_project',
    ]);
    expect(requests[0].toolConfig).toBeUndefined();
    const [question, modelTurn, results] = requests[1].contents;
    expect(question.parts[0].text).toBe('How many hours on acme-seo this week?');
    // The model's turn goes back unchanged, thought signature included.
    expect(modelTurn).toEqual(first.candidates[0].content);
    expect(modelTurn.parts[0]).toMatchObject({
      functionCall: { name: 'hours_by_project', id: 'call-1' },
      thoughtSignature: 'c2lnbmF0dXJl',
    });
    expect(results).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'call-1',
            name: 'hours_by_project',
            response: { result: [{ projectName: 'acme-seo', minutes: 750 }] },
          },
        },
      ],
    });
    const rows = await db('ai_usage').orderBy('id');
    expect(rows.map((row) => [row.feature, row.userId, row.ok])).toEqual([
      ['ask', viewer.id, true],
      ['ask', viewer.id, true],
    ]);
  });

  it('answers several calls of one round in order, refusing unknown tools', async () => {
    replyWith(
      callAnswer([
        { name: 'list_projects' },
        { name: 'drop_tables', args: {} },
        { name: 'hours_by_project', args: { from: 'x', to: 'y' } },
      ]),
      ai.fakeGeminiResponse({ text: 'Done' }),
    );
    const onToolCall = vi.fn(async (name) =>
      name === 'list_projects' ? { error: 'not allowed' } : { minutes: 0 },
    );
    await ask(onToolCall);
    expect(onToolCall.mock.calls.map(([name]) => name)).toEqual([
      'list_projects',
      'hours_by_project',
    ]);
    expect(requests[1].contents[2].parts.map((part) => part.functionResponse)).toEqual([
      { name: 'list_projects', response: { error: 'not allowed' } },
      { name: 'drop_tables', response: { error: 'Unknown tool.' } },
      { name: 'hours_by_project', response: { minutes: 0 } },
    ]);
  });

  it('stops after 5 rounds: the 6th request turns tools off', async () => {
    replyWith(
      callAnswer([{ name: 'list_projects' }]),
      callAnswer([{ name: 'list_projects' }]),
      callAnswer([{ name: 'list_projects' }]),
      callAnswer([{ name: 'list_projects' }]),
      callAnswer([{ name: 'list_projects' }]),
      ai.fakeGeminiResponse({ text: "I don't have that." }),
    );
    const onToolCall = vi.fn(async () => []);
    const result = await ask(onToolCall);
    expect(result.text).toBe("I don't have that.");
    expect(ai.MAX_TOOL_ROUNDS).toBe(5);
    expect(onToolCall).toHaveBeenCalledTimes(5);
    expect(requests).toHaveLength(6);
    expect(requests.slice(0, 5).every((body) => body.toolConfig === undefined)).toBe(true);
    expect(requests[5].toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } });
    expect(await db('ai_usage').count({ count: '*' }).first()).toEqual({ count: 6 });
  });

  it('answers AI_ERROR when Gemini still calls a tool after 5 rounds', async () => {
    replyWith(callAnswer([{ name: 'list_projects' }]));
    const onToolCall = vi.fn(async () => []);
    await expectAppError(ask(onToolCall), 'AI_ERROR');
    expect(onToolCall).toHaveBeenCalledTimes(5);
    const rows = await db('ai_usage').orderBy('id');
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)).toMatchObject({ ok: false, errorCode: 'AI_ERROR' });
  });

  it('sends a 4xx AppError back to Gemini, but stops on any other error', async () => {
    replyWith(
      callAnswer([{ name: 'hours_by_project', args: { from: '2020-01-01', to: '2026-10-26' } }]),
      ai.fakeGeminiResponse({ text: 'Try a shorter range.' }),
    );
    await ask(async () => {
      throw new AppError('VALIDATION_FAILED', { message: 'Use at most 366 days.' });
    });
    expect(requests[1].contents[2].parts[0].functionResponse.response).toEqual({
      error: 'Use at most 366 days.',
    });

    replyWith(callAnswer([{ name: 'list_projects' }]));
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await expectAppError(
      ask(async () => {
        throw new Error('database is down');
      }),
      'AI_ERROR',
    );
    expect(logged).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    logged.mockRestore();
  });

  it('scrubs contact details from tool results and restores them in arguments', async () => {
    replyWith(
      callAnswer([{ name: 'list_projects' }]),
      callAnswer([{ name: 'hours_by_project', args: { from: '[email 1]', to: 'x' } }]),
      ai.fakeGeminiResponse({ text: 'Ask [email 1].' }),
    );
    const onToolCall = vi.fn(async () => [{ name: 'acme-seo', note: 'client: sam@acme.com' }]);
    const result = await ask(onToolCall);
    expect(requests[1].contents[2].parts[0].functionResponse.response).toEqual({
      result: [{ name: 'acme-seo', note: 'client: [email 1]' }],
    });
    expect(onToolCall).toHaveBeenLastCalledWith('hours_by_project', {
      from: 'sam@acme.com',
      to: 'x',
    });
    expect(result.text).toBe('Ask sam@acme.com.');
  });

  it('can ask for JSON while using tools', async () => {
    replyWith(
      callAnswer([{ name: 'list_projects' }]),
      ai.fakeGeminiResponse({ data: { answer: 'Two projects.' } }),
    );
    const schema = { type: 'object', properties: { answer: { type: 'string' } } };
    const result = await ask(async () => [], { json: schema });
    expect(result.data).toEqual({ answer: 'Two projects.' });
    expect(requests[0].generationConfig.responseJsonSchema).toEqual(schema);
  });
});
