// The Gemini REST client (CONTRACT 20): request bodies, reading answers, and the fetch call —
// with global fetch stubbed, so nothing reaches Google.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import {
  buildRequestBody,
  fakeGeminiResponse,
  readResponse,
  REQUEST_TIMEOUT_MS,
  sendRequest,
  setApiKeyForTests,
  setTimeoutForTests,
  thinkingLevelFor,
} from '@/modules/ai/client';

const userTurn = [{ role: 'user', parts: [{ text: 'Hello' }] }];

describe('buildRequestBody', () => {
  it('sends the system instruction and the conversation', () => {
    expect(buildRequestBody({ system: 'Be brief.', contents: userTurn })).toEqual({
      contents: userTurn,
      systemInstruction: { parts: [{ text: 'Be brief.' }] },
    });
  });

  it('asks for JSON that follows the schema', () => {
    const schema = { type: 'object', properties: { title: { type: 'string' } } };
    expect(buildRequestBody({ contents: userTurn, json: schema }).generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
    });
  });

  it('declares tools as functions with JSON schema parameters', () => {
    const tools = [
      { name: 'list_projects', description: 'Projects' },
      {
        name: 'hours_by_project',
        description: 'Hours',
        parameters: { type: 'object', properties: { from: { type: 'string' } } },
      },
    ];
    const body = buildRequestBody({ contents: userTurn, tools });
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          { name: 'list_projects', description: 'Projects' },
          {
            name: 'hours_by_project',
            description: 'Hours',
            parametersJsonSchema: { type: 'object', properties: { from: { type: 'string' } } },
          },
        ],
      },
    ]);
    expect(body.toolConfig).toBeUndefined();
    expect(buildRequestBody({ contents: userTurn, tools, toolsOff: true }).toolConfig).toEqual({
      functionCallingConfig: { mode: 'NONE' },
    });
  });

  it('sends a thinking level only when one is given, next to the JSON settings', () => {
    expect(buildRequestBody({ contents: userTurn, thinkingLevel: 'low' }).generationConfig).toEqual(
      { thinkingConfig: { thinkingLevel: 'low' } },
    );
    const schema = { type: 'object' };
    expect(
      buildRequestBody({ contents: userTurn, json: schema, thinkingLevel: 'low' }).generationConfig,
    ).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      thinkingConfig: { thinkingLevel: 'low' },
    });
    expect(buildRequestBody({ contents: userTurn }).generationConfig).toBeUndefined();
  });
});

describe('thinkingLevelFor', () => {
  it("thinks 'low' with a Gemini 3 or later smart model, and leaves everything else alone", () => {
    expect(thinkingLevelFor('smart', 'gemini-3.5-flash')).toBe('low');
    expect(thinkingLevelFor('smart', 'gemini-3.8-flash')).toBe('low');
    expect(thinkingLevelFor('smart', 'gemini-4-argon')).toBe('low');
    expect(thinkingLevelFor('smart', 'gemini-3-flash-preview')).toBe('low');
    // 2.5 models reject a thinking level; aliases may point at either.
    expect(thinkingLevelFor('smart', 'gemini-2.5-flash')).toBeUndefined();
    expect(thinkingLevelFor('smart', 'gemini-flash-latest')).toBeUndefined();
    expect(thinkingLevelFor('fast', 'gemini-3.5-flash-lite')).toBeUndefined();
  });
});

describe('readResponse', () => {
  it('joins the text parts, leaving thoughts out, and counts thinking as output', () => {
    const reply = readResponse({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'secret plan', thought: true }, { text: 'Hello ' }, { text: 'there' }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 30 },
    });
    expect(reply.text).toBe('Hello there');
    expect(reply.calls).toEqual([]);
    expect(reply).toMatchObject({ inputTokens: 12, outputTokens: 34, finishReason: 'STOP' });
  });

  it('reads function calls with their ids', () => {
    const reply = readResponse(
      fakeGeminiResponse({ calls: [{ id: 'c1', name: 'list_people', args: { q: 'a' } }] }),
    );
    expect(reply.calls).toEqual([{ id: 'c1', name: 'list_people', args: { q: 'a' } }]);
    expect(reply.content.role).toBe('model');
  });

  it('notices a blocked prompt and a missing answer', () => {
    const blocked = readResponse({ promptFeedback: { blockReason: 'SAFETY' } });
    expect(blocked).toMatchObject({ blockReason: 'SAFETY', content: null, text: '' });
    expect(blocked.inputTokens).toBeNull();
    expect(readResponse(null).content).toBeNull();
  });
});

describe('sendRequest', () => {
  beforeEach(() => setApiKeyForTests('test-key-123'));
  afterEach(() => {
    vi.unstubAllGlobals();
    setApiKeyForTests(undefined);
    setTimeoutForTests(null);
  });

  it('posts to generateContent with the key in a header and a timeout signal', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = buildRequestBody({ contents: userTurn });
    const answer = await sendRequest({ model: env.GEMINI_MODEL, body });
    expect(answer).toEqual({ status: 200, data: { ok: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-goog-api-key': 'test-key-123',
    });
    expect(JSON.parse(init.body)).toEqual(body);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it('returns the status with a non-JSON body as null', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(sendRequest({ model: 'm', body: {} })).resolves.toEqual({
      status: 502,
      data: null,
    });
  });

  it('gives up when the timeout passes', async () => {
    setTimeoutForTests(20);
    vi.stubGlobal(
      'fetch',
      (url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        }),
    );
    await expect(sendRequest({ model: 'm', body: {} })).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });
});
