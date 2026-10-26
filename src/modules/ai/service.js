// AI with Gemini (CONTRACT 20). Features import `ai` from '@/modules/ai' and use:
// - ai.isAvailable(feature) before showing a button or running a job;
// - ai.generate({ feature, userId, model, system, prompt, json?, tools?, onToolCall? });
// - ai.pseudonymize / ai.restoreNames for people in the PM summary and HR notes;
// - ai.saveSummary / listSummaries / getSummary for the worker's texts;
// - ai.setTransportForTests(fn) + ai.fakeGeminiResponse(...) in tests (never the real API).
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { settings } from '@/modules/settings';
import { apiKey, modelName, thinkingLevelFor } from './client';
import { converse } from './conversation';

export { usageToday, PERSON_DAILY_CAPS } from './usage';
export { MAX_TOOL_ROUNDS } from './conversation';
export { pseudonymize, restoreNames, redactContacts, PEOPLE_TOKEN_NOTE } from './privacy';
export {
  saveSummary,
  listSummaries,
  countSummaries,
  getSummary,
  summaryRecipients,
  SUMMARY_KINDS,
} from './summaries';
export {
  setTransportForTests,
  setApiKeyForTests,
  setTimeoutForTests,
  fakeGeminiResponse,
} from './client';

/** The AI features and the setting that switches each one on. */
const FEATURE_SWITCHES = Object.freeze({
  polish: 'aiPolishEnabled',
  pm_summary: 'aiPmSummaryEnabled',
  hr_notes: 'aiHrNotesEnabled',
  ask: 'aiAskEnabled',
});
export const AI_FEATURES = Object.freeze(Object.keys(FEATURE_SWITCHES));
const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

function availableWith(values, feature) {
  const key = FEATURE_SWITCHES[feature];
  return Boolean(key && apiKey() && values.aiEnabled && values[key]);
}

/**
 * Whether a feature can run now: GEMINI_API_KEY is set, Settings → AI is on and the feature's own
 * switch is on. Unknown features are never available.
 * @param {'polish' | 'pm_summary' | 'hr_notes' | 'ask'} feature
 * @returns {Promise<boolean>}
 */
export async function isAvailable(feature) {
  if (!FEATURE_SWITCHES[feature] || !apiKey()) return false;
  return availableWith(await settings.getAll(), feature);
}

/** Programming mistakes in a generate() call (never shown to people). */
function checkInput({ feature, model, prompt, json, tools, onToolCall }) {
  const problem = (text) => new TypeError(`ai.generate: ${text}`);
  if (!FEATURE_SWITCHES[feature]) throw problem(`unknown feature "${feature}"`);
  if (model !== 'fast' && model !== 'smart') throw problem('model must be "fast" or "smart"');
  if (typeof prompt !== 'string' || !prompt.trim()) throw problem('prompt is required');
  if (json !== undefined && (json === null || typeof json !== 'object')) {
    throw problem('json must be a JSON schema object');
  }
  if (tools === undefined) return;
  if (!Array.isArray(tools)) throw problem('tools must be an array');
  for (const tool of tools) {
    if (!TOOL_NAME.test(tool?.name ?? '') || typeof tool.description !== 'string') {
      throw problem('each tool needs a name and a description');
    }
  }
  if (tools.length > 0 && typeof onToolCall !== 'function') throw problem('onToolCall is required');
}

/**
 * Asks Gemini. Checks, in order: the feature is available (AI_OFF), the company's daily limit
 * (`aiDailyLimit` requests per company-time day) and the person's cap for polish (20) and ask
 * (30) (AI_LIMIT). Every HTTP request — each tool round too — writes one ai_usage row before it
 * is sent and counts towards the limits; the limits are checked under a lock that every process
 * shares, so requests at the same time can't overrun them. An answer that has started may finish
 * its tool rounds.
 *
 * Every text sent (system, prompt, tool results) has emails, phone numbers, IPs and Slack ids
 * replaced by placeholders ("[email 1]"), which are put back in the answer and in tool arguments,
 * so they never reach Gemini. Send people as pseudonymize() tokens where CONTRACT 20 says so and
 * restoreNames() the answer.
 *
 * @param {{
 *   feature: 'polish' | 'pm_summary' | 'hr_notes' | 'ask',
 *   userId?: number | null,
 *   model?: 'fast' | 'smart',
 *   system?: string,
 *   prompt: string,
 *   json?: object,
 *   tools?: Array<{ name: string, description: string, parameters?: object }>,
 *   onToolCall?: (name: string, args: object) => unknown | Promise<unknown>,
 * }} input userId = the person asking (null for the worker); model 'fast' = GEMINI_MODEL
 *   (default), 'smart' = GEMINI_SMART_MODEL (thinking 'low'; when Gemini is busy or doesn't
 *   answer the first request in time, the question goes to the fast model instead, once — a new
 *   request that counts like any other); json = a JSON schema (type, properties, required,
 *   items, enum, …): Gemini answers in JSON and the parsed value comes back in `data`; tools =
 *   function declarations whose `parameters` is a JSON schema. Gemini may call them for up to 5
 *   rounds; each call runs `onToolCall(name, args)`, whose return value (an object, or anything
 *   JSON, sent as `{ result }`) goes back to Gemini. Return `{ error: 'not allowed' }` for a tool
 *   the viewer can't use; a thrown AppError with a 4xx status is sent back as `{ error: message }`,
 *   any other error stops the answer with AI_ERROR.
 * @returns {Promise<{ text: string, data: any }>} text = the answer (the JSON text with `json`);
 *   data = the parsed JSON, or null without `json`
 * @throws AppError AI_OFF (409) | AI_LIMIT (429) | AI_BUSY (503: Gemini answered 429 or 503, no
 *   answer within 30 s, or the limits stayed locked by other requests for 5 s) |
 *   AI_ERROR (502: any other failure — HTTP error, network, blocked or empty answer, JSON that
 *   doesn't parse, a tool call after the 5th round)
 */
export async function generate(input) {
  const {
    feature,
    userId = null,
    model = 'fast',
    system,
    prompt,
    json,
    tools,
    onToolCall,
  } = input ?? {};
  checkInput({ feature, model, prompt, json, tools, onToolCall });
  const values = await settings.getAll();
  if (!availableWith(values, feature)) throw new AppError('AI_OFF');
  const run = (kind) =>
    converse({
      feature,
      userId,
      model: modelName(kind),
      thinkingLevel: thinkingLevelFor(kind, modelName(kind)),
      values,
      system,
      prompt,
      json,
      tools: tools?.length ? tools : undefined,
      onToolCall,
    });
  try {
    return await run(model);
  } catch (error) {
    const fallback = model === 'smart' && modelName('fast') !== modelName('smart');
    if (!fallback || !error?.firstRequestBusy) throw error;
    logger.warn({ feature, model: modelName('smart') }, 'Gemini busy, using the fast model');
    return run('fast');
  }
}
