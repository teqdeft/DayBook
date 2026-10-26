// One Gemini request for a summary (CONTRACT 20): the fast model answers JSON { title, body }
// about people sent as tokens; the names go back in, and the text is cleaned and cut to length.
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { ai } from '@/modules/ai';
import { cleanBody, cleanTitle } from './text';

/** What Gemini answers for every summary. */
export const SUMMARY_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'A short headline for the summary, under 80 characters.',
    },
    body: {
      type: 'string',
      description: 'The summary as plain text with short "- " lists. No Markdown.',
    },
  },
  required: ['title', 'body'],
});

/**
 * Asks Gemini for one summary and puts the names back.
 * @param {{ feature: 'pm_summary' | 'hr_notes', system: string, prompt: string,
 *   names: Record<string, string>, maxLength: number, fallbackTitle: string }} input names from
 *   ai.pseudonymize(); maxLength = the longest body kept (cut at a line)
 * @returns {Promise<{ title: string, body: string }>}
 * @throws AppError AI_OFF | AI_LIMIT | AI_BUSY | AI_ERROR (also for an answer without a body)
 */
export async function writeSummary({ feature, system, prompt, names, maxLength, fallbackTitle }) {
  const { data } = await ai.generate({
    feature,
    userId: null,
    model: 'fast',
    system,
    prompt,
    json: SUMMARY_SCHEMA,
  });
  const title = typeof data?.title === 'string' ? data.title : '';
  const body = typeof data?.body === 'string' ? data.body : '';
  if (!body.trim()) throw new AppError('AI_ERROR');
  const restored = ai.restoreNames({ title, body }, names);
  return {
    title: cleanTitle(restored.title) || fallbackTitle,
    body: cleanBody(restored.body, maxLength),
  };
}

/** AI errors after which the rest of a run can't succeed today (limit used up, AI turned off). */
const ENDS_RUN = new Set(['AI_LIMIT', 'AI_OFF']);

/** True for the AI module's errors (AI_OFF, AI_LIMIT, AI_BUSY, AI_ERROR). */
export function isAiError(error) {
  return isAppError(error) && error.code.startsWith('AI_');
}

/**
 * Logs a summary that wasn't written — the error code only, never the prompt or the answer —
 * and says whether the run should stop.
 * @param {unknown} error
 * @param {{ job: string, recipientId?: number }} context
 * @returns {boolean} true when no later summary of this run can be written
 */
export function logFailure(error, context) {
  if (isAiError(error)) {
    const endsRun = ENDS_RUN.has(error.code);
    logger.warn(
      { ...context, code: error.code },
      endsRun
        ? 'AI summary not written; the rest of this run is skipped'
        : 'AI summary not written',
    );
    return endsRun;
  }
  logger.error({ ...context, err: error }, 'AI summary failed');
  return false;
}
