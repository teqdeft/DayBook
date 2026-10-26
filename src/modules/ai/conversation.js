// One generate() call: a Gemini request, and with tools up to 5 rounds of function calls. Each
// HTTP request writes one ai_usage row before it goes out: the first one only once the daily
// limits allow it, later tool rounds always (the answer may finish). Logs carry the feature,
// model, status and reason only — never the prompt, a tool result or the answer.
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { buildRequestBody, readResponse, sendRequest } from './client';
import { createRedactor } from './privacy';
import { finishUsage, reserveUsage } from './usage';

/** Rounds of function calls before Gemini must answer in text (CONTRACT 20). */
export const MAX_TOOL_ROUNDS = 5;
/** Calls run per round; more in one answer get an error result instead. */
export const MAX_CALLS_PER_ROUND = 10;

function failure(errorCode, reason, extra = {}) {
  return { ok: false, errorCode, reason, ...extra };
}

/**
 * What one HTTP answer means: { ok: true, reply } or { ok: false, errorCode, reason }. Gemini's 429
 * (rate limit) and 503 ("high demand", common on the free tier) are AI_BUSY.
 */
function judge({ status, data }, reply, { json, toolsAllowed }) {
  if (status === 429) return failure('AI_BUSY', 'rate_limited', { status });
  if (status === 503) {
    return failure('AI_BUSY', 'overloaded', { status, googleStatus: data?.error?.status });
  }
  if (!(status >= 200 && status < 300)) {
    return failure('AI_ERROR', 'http_error', { status, googleStatus: data?.error?.status });
  }
  if (reply.blockReason) return failure('AI_ERROR', 'blocked', { detail: reply.blockReason });
  if (!reply.content) return failure('AI_ERROR', 'no_answer', { detail: reply.finishReason });
  if (reply.calls.length > 0) {
    return toolsAllowed ? { ok: true, reply } : failure('AI_ERROR', 'unexpected_tool_call');
  }
  if (!reply.text.trim()) {
    return failure('AI_ERROR', 'empty_answer', { detail: reply.finishReason });
  }
  if (!json) return { ok: true, reply };
  try {
    return { ok: true, reply: { ...reply, data: parseJsonAnswer(reply.text) } };
  } catch {
    return failure('AI_ERROR', 'bad_json', { detail: reply.finishReason });
  }
}

/** Gemini's JSON text (tolerating a ```json fence) → a value. Throws when it isn't JSON. */
function parseJsonAnswer(text) {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : text);
}

/**
 * Reserves one request against the limits (`check`), sends it, records how it went and returns
 * the reply, or throws AI_LIMIT / AI_BUSY / AI_ERROR. No answer within the timeout is AI_BUSY.
 * When Gemini was busy on the first request of a conversation, the error has
 * `firstRequestBusy: true` (generate() may then try another model).
 */
async function request({ feature, userId, model, values, check, body, json, toolsAllowed }) {
  const usageId = await reserveUsage({ feature, userId, model, values, check });
  let outcome;
  let tokens = {};
  try {
    const answer = await sendRequest({ model, body });
    const reply = readResponse(answer?.data);
    tokens = { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens };
    outcome = judge(answer ?? {}, reply, { json, toolsAllowed });
  } catch (error) {
    outcome =
      error?.name === 'TimeoutError'
        ? failure('AI_BUSY', 'timeout', { detail: error.name })
        : failure('AI_ERROR', 'network', { detail: error?.name });
  }
  await finishUsage(usageId, { ok: outcome.ok, errorCode: outcome.errorCode, ...tokens });
  if (outcome.ok) return outcome.reply;
  const { errorCode, reason, status, googleStatus, detail } = outcome;
  logger.warn(
    { feature, model, errorCode, reason, status, googleStatus, detail },
    'Gemini request failed',
  );
  const error = new AppError(errorCode);
  if (check && errorCode === 'AI_BUSY') error.firstRequestBusy = true;
  throw error;
}

/** A tool result as Gemini's functionResponse.response (always a JSON object). */
function asResponseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return { result: value ?? null };
}

/**
 * Runs one tool with its arguments (placeholders put back). A person-facing AppError (4xx) goes
 * back to Gemini; anything else stops the answer.
 */
async function runTool(onToolCall, call, redactor) {
  try {
    return await onToolCall(call.name, redactor.restore(call.args));
  } catch (error) {
    if (isAppError(error) && error.status < 500) return { error: error.message };
    logger.error({ err: error, tool: call.name }, 'AI tool failed');
    throw new AppError('AI_ERROR', { cause: error });
  }
}

/** The functionResponse parts for one round of calls, in the order Gemini asked. */
async function answerCalls(calls, { tools, onToolCall, redactor }) {
  const known = new Set(tools.map((tool) => tool.name));
  const parts = [];
  for (const [index, call] of calls.entries()) {
    let result;
    if (index >= MAX_CALLS_PER_ROUND) result = { error: 'Too many calls at once.' };
    else if (!known.has(call.name)) result = { error: 'Unknown tool.' };
    else result = await runTool(onToolCall, call, redactor);
    parts.push({
      functionResponse: {
        ...(call.id ? { id: call.id } : {}),
        name: call.name,
        response: asResponseObject(redactor.redactDeep(result)),
      },
    });
  }
  return parts;
}

/**
 * Runs the conversation for generate(): one request, or with tools a request per round until
 * Gemini answers in text (the request after the 5th round has tools switched off). The first
 * request checks the daily limits; later rounds are saved without the check. Contact details in
 * the system text, prompt and tool results go out as placeholders and come back in the answer.
 * @param {{ feature: string, userId: number | null, model: string, thinkingLevel?: string,
 *   values: object, system?: string, prompt: string, json?: object, tools?: object[],
 *   onToolCall?: Function }} input model = the Gemini model name; values = settings.getAll()
 *   (for the limits)
 * @returns {Promise<{ text: string, data: any }>}
 * @throws AppError AI_LIMIT | AI_BUSY | AI_ERROR
 */
export async function converse({
  feature,
  userId,
  model,
  thinkingLevel,
  values,
  system,
  prompt,
  json,
  tools,
  onToolCall,
}) {
  const hasTools = Boolean(tools?.length);
  const redactor = createRedactor();
  const contents = [{ role: 'user', parts: [{ text: redactor.redact(prompt) }] }];
  const systemText = system ? redactor.redact(system) : undefined;
  for (let round = 0; ; round += 1) {
    const toolsAllowed = hasTools && round < MAX_TOOL_ROUNDS;
    const body = buildRequestBody({
      system: systemText,
      contents: [...contents],
      json,
      tools,
      toolsOff: hasTools && !toolsAllowed,
      thinkingLevel,
    });
    const reply = await request({
      feature,
      userId,
      model,
      values,
      check: round === 0,
      body,
      json,
      toolsAllowed,
    });
    if (reply.calls.length === 0) {
      return redactor.restore({ text: reply.text, data: json ? reply.data : null });
    }
    // The model's turn goes back unchanged (Gemini 3 checks its thought signatures).
    contents.push(reply.content);
    const parts = await answerCalls(reply.calls, { tools, onToolCall, redactor });
    contents.push({ role: 'user', parts });
  }
}
