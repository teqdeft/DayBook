// Daily limits and the ai_usage rows (CONTRACT 20). Every Gemini request is one row — tool rounds
// included — and the limits count those rows within the company-time day. The row is written
// before the request goes out (reserveUsage, under a lock), so requests running at the same time
// count each other; finishUsage fills in how it went.
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { addDays, localToUtc, nowDate, workDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import * as repo from './repo';

/** Gemini requests one person may make per day, per feature (features not listed: no cap). */
export const PERSON_DAILY_CAPS = Object.freeze({ polish: 40, ask: 30 });
/** error_code of a request on its way to Gemini (it counts towards the limits already). */
export const PENDING_CODE = 'PENDING';
/** How long a request waits while others check the limits, before giving up with AI_BUSY. */
const LOCK_WAIT_SECONDS = 5;

/** UTC bounds of today in the company time zone: { from, to } (to excluded). */
export function todayBounds(timezone) {
  const today = workDate(timezone);
  return {
    from: localToUtc(today, '00:00', timezone).toDate(),
    to: localToUtc(addDays(today, 1), '00:00', timezone).toDate(),
  };
}

/**
 * Throws AI_LIMIT when the company has used today's `aiDailyLimit`, or when this person has used
 * their cap for this feature (polish 40, ask 30). Requests without a person only count towards
 * the company limit.
 * @param {{ feature: string, userId?: number | null, values: { timezone: string,
 *   aiDailyLimit: number } }} input values = settings.getAll()
 * @param {Function} [trx] where to count (reserveUsage's locked connection)
 * @throws AppError AI_LIMIT
 */
export async function checkLimits({ feature, userId, values }, trx) {
  const day = todayBounds(values.timezone);
  const used = await repo.countUsage(day, trx);
  if (used >= values.aiDailyLimit) throw new AppError('AI_LIMIT');
  const cap = PERSON_DAILY_CAPS[feature];
  if (cap === undefined || userId === undefined || userId === null) return;
  const mine = await repo.countUsage({ ...day, userId, feature }, trx);
  if (mine >= cap) {
    throw new AppError('AI_LIMIT', {
      message: "You've reached today's AI limit. Try again tomorrow.",
    });
  }
}

/**
 * Saves one Gemini request before it is sent, as pending. Under a MySQL named lock that every
 * web and worker process shares, it first checks the limits (checkLimits), so requests running
 * at the same time count each other and can't all pass at the old count. `check: false` is for a
 * later tool round of an answer already under way: its row is saved, but the answer may finish.
 * Never saves the prompt or the answer.
 * @param {{ feature: string, userId?: number | null, model: string, values: object,
 *   check?: boolean }} input values = settings.getAll(); model = the Gemini model name
 * @returns {Promise<number>} the row's id, for finishUsage()
 * @throws AppError AI_LIMIT | AI_BUSY (the limits were being checked by others for 5 s)
 */
export async function reserveUsage({ feature, userId, model, values, check = true }) {
  const outcome = await repo.withLimitsLock(
    async (on) => {
      if (check) await checkLimits({ feature, userId, values }, on);
      return repo.insertUsage(
        {
          userId: userId ?? null,
          feature,
          model: String(model).slice(0, 80),
          ok: false,
          errorCode: PENDING_CODE,
          inputTokens: null,
          outputTokens: null,
          createdAt: nowDate(),
        },
        on,
      );
    },
    { waitSeconds: LOCK_WAIT_SECONDS },
  );
  if (!outcome.locked) {
    logger.warn({ feature }, 'AI limits were busy; the Gemini request was not sent');
    throw new AppError('AI_BUSY');
  }
  return outcome.value;
}

/**
 * Records how a reserved request went.
 * @param {number} id from reserveUsage()
 * @param {{ ok: boolean, errorCode?: string | null, inputTokens?: number | null,
 *   outputTokens?: number | null }} outcome
 */
export function finishUsage(id, { ok, errorCode, inputTokens, outputTokens }) {
  return repo.updateUsage(id, {
    ok,
    errorCode: ok ? null : (errorCode ?? 'AI_ERROR'),
    inputTokens: inputTokens ?? null,
    outputTokens: outputTokens ?? null,
  });
}

/**
 * Today's Gemini requests for the whole company (company-time day), for Settings → AI.
 * @returns {Promise<{ used: number, limit: number }>}
 */
export async function usageToday() {
  const values = await settings.getAll();
  const used = await repo.countUsage(todayBounds(values.timezone));
  return { used, limit: values.aiDailyLimit };
}
