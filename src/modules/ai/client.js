// The one place that talks to Gemini: one REST generateContent request per call, with the API key
// in a header and a 30 s timeout. No SDK. Tests swap the network for a fake transport with
// setTransportForTests() (or stub global fetch), and never reach Google.
import { env } from '@/lib/env';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Each Gemini request gives up after this long (CONTRACT 20). */
export const REQUEST_TIMEOUT_MS = 30_000;

let testTransport = null;
let testApiKey; // undefined = env (or a placeholder while a test transport is set)
let timeoutMs = REQUEST_TIMEOUT_MS;

/**
 * @typedef {{ url: string, model: string, headers: Record<string, string>, body: object,
 *   signal: AbortSignal }} TransportRequest
 * @typedef {(request: TransportRequest) => Promise<{ status: number, data: any }>} Transport
 */

/**
 * Tests only: replace the network. `fn({ url, model, headers, body, signal })` resolves to
 * `{ status, data }` (data = Gemini's JSON answer, see fakeGeminiResponse) or throws like fetch
 * does. While a transport is set, the API key counts as set. null restores fetch.
 * @param {Transport | null} fn
 */
export function setTransportForTests(fn) {
  testTransport = fn;
}

/** Tests only: the API key to use ('' = no key); undefined goes back to GEMINI_API_KEY. */
export function setApiKeyForTests(key) {
  testApiKey = key;
}

/** Tests only: the request timeout in ms; null restores 30 s. */
export function setTimeoutForTests(ms) {
  timeoutMs = ms ?? REQUEST_TIMEOUT_MS;
}

/** The Gemini API key in use ('' when AI can't run). */
export function apiKey() {
  if (testApiKey !== undefined) return testApiKey ?? '';
  if (testTransport) return env.GEMINI_API_KEY || 'test-key';
  return env.GEMINI_API_KEY;
}

/** The model name for 'fast' (everyday) or 'smart' (Ask Daybook). */
export function modelName(model) {
  return model === 'smart' ? env.GEMINI_SMART_MODEL : env.GEMINI_MODEL;
}

/**
 * The thinking level for a request, or undefined for the model's own default. The smart model
 * thinks 'low': at its default (high) a Gemini 3 Flash takes 15 s and more for a short answer on
 * the free tier. Only Gemini 3 and later take a thinking level (2.5 answers it with a 400), and
 * the fast model (Flash-Lite) doesn't think by default.
 * @param {'fast' | 'smart'} model
 * @param {string} name the Gemini model name
 * @returns {'low' | undefined}
 */
export function thinkingLevelFor(model, name) {
  const major = Number(/^gemini-(\d+)(?:[.-]|$)/.exec(name)?.[1]);
  return model === 'smart' && major >= 3 ? 'low' : undefined;
}

/** The real transport: fetch, reading the body as JSON when it is JSON. */
async function fetchTransport({ url, headers, body, signal }) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

/**
 * Sends one generateContent request.
 * @param {{ model: string, body: object }} input model = the Gemini model name
 * @returns {Promise<{ status: number, data: any }>}
 * @throws the transport's error (network failure, or a TimeoutError after 30 s)
 */
export function sendRequest({ model, body }) {
  const transport = testTransport ?? fetchTransport;
  return transport({
    url: `${BASE_URL}/${encodeURIComponent(model)}:generateContent`,
    model,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Builds a generateContent body.
 * @param {{ system?: string, contents: object[], json?: object, tools?: Array<{ name: string,
 *   description: string, parameters?: object }>, toolsOff?: boolean, thinkingLevel?: string }}
 *   input json = a JSON schema for the answer; tools = function declarations (parameters as JSON
 *   schema); toolsOff keeps the tools declared but tells Gemini to answer in text (the last tool
 *   round); thinkingLevel = see thinkingLevelFor
 */
export function buildRequestBody({
  system,
  contents,
  json,
  tools,
  toolsOff = false,
  thinkingLevel,
}) {
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const config = {};
  if (json)
    Object.assign(config, { responseMimeType: 'application/json', responseJsonSchema: json });
  if (thinkingLevel) config.thinkingConfig = { thinkingLevel };
  if (Object.keys(config).length > 0) body.generationConfig = config;
  if (tools?.length) {
    body.tools = [
      {
        functionDeclarations: tools.map(({ name, description, parameters }) => ({
          name,
          description,
          ...(parameters ? { parametersJsonSchema: parameters } : {}),
        })),
      },
    ];
    if (toolsOff) body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
  }
  return body;
}

const tokenCount = (...values) => {
  const numbers = values.map(Number).filter((value) => Number.isFinite(value) && value >= 0);
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null;
};

/**
 * Reads a generateContent answer.
 * @returns {{ content: object | null, text: string, calls: Array<{ id?: string, name: string,
 *   args: object }>, finishReason: string | null, blockReason: string | null,
 *   inputTokens: number | null, outputTokens: number | null }} content = the model's turn as
 *   received (sent back unchanged in the next tool round, thought signatures included); text
 *   leaves thoughts out; output tokens include thinking.
 */
export function readResponse(data) {
  const candidate = data?.candidates?.[0];
  const content =
    candidate?.content && Array.isArray(candidate.content.parts) ? candidate.content : null;
  const parts = content?.parts ?? [];
  const usage = data?.usageMetadata ?? {};
  return {
    content,
    text: parts
      .filter((part) => typeof part.text === 'string' && !part.thought)
      .map((part) => part.text)
      .join(''),
    calls: parts
      .filter((part) => part.functionCall?.name)
      .map(({ functionCall }) => ({
        ...(functionCall.id ? { id: functionCall.id } : {}),
        name: String(functionCall.name),
        args: functionCall.args && typeof functionCall.args === 'object' ? functionCall.args : {},
      })),
    finishReason: candidate?.finishReason ?? null,
    blockReason: data?.promptFeedback?.blockReason ?? null,
    inputTokens: tokenCount(usage.promptTokenCount, usage.toolUsePromptTokenCount),
    outputTokens: tokenCount(usage.candidatesTokenCount, usage.thoughtsTokenCount),
  };
}

/**
 * Tests: a Gemini-shaped answer for a fake transport. Pass `text`, `data` (sent as JSON text) or
 * `calls` ([{ name, args, id? }]); usage defaults to 10 input and 5 output tokens.
 */
export function fakeGeminiResponse({ text, data, calls, usage, finishReason = 'STOP' } = {}) {
  const parts = [];
  if (data !== undefined) parts.push({ text: JSON.stringify(data) });
  else if (text !== undefined) parts.push({ text });
  for (const call of calls ?? []) {
    parts.push({ functionCall: { name: call.name, args: call.args ?? {}, id: call.id } });
  }
  return {
    candidates: [{ content: { role: 'model', parts }, finishReason, index: 0 }],
    usageMetadata: {
      promptTokenCount: usage?.input ?? 10,
      candidatesTokenCount: usage?.output ?? 5,
      totalTokenCount: (usage?.input ?? 10) + (usage?.output ?? 5),
    },
  };
}
