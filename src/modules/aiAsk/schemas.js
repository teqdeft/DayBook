// Input checks for Ask Daybook: the POST /api/ai/ask body (zod) and the arguments Gemini sends
// to a tool (dates, range length), whose problems go back to Gemini as { error } words.
import { z } from 'zod';
import { dayjs } from '@/lib/time';

export const QUESTION_MIN = 2;
export const QUESTION_MAX = 500;
export const HISTORY_MAX = 4;
/** Earlier answers sent back as context are cut to this many characters. */
export const ANSWER_MAX = 4000;
/** Longest date range a tool reads, in days (both ends included). */
export const MAX_RANGE_DAYS = 366;
/** Rows a tool returns at most. */
export const MAX_ROWS = 200;

const question = z
  .string({ error: 'Type a question.' })
  .trim()
  .min(QUESTION_MIN, 'Type a question.')
  .max(QUESTION_MAX, `Keep the question to ${QUESTION_MAX} characters or fewer.`);

const turn = z.object({
  question: z.string().trim().max(QUESTION_MAX).default(''),
  answer: z
    .string()
    .trim()
    .transform((value) => value.slice(0, ANSWER_MAX))
    .default(''),
});

/** POST /api/ai/ask { question, history? } — history = this visit's earlier turns, oldest first. */
export const askBodySchema = z.object(
  {
    question,
    history: z
      .array(turn, { error: 'History must be a list of earlier questions.' })
      .max(HISTORY_MAX, `Send at most ${HISTORY_MAX} earlier questions.`)
      .default([])
      .transform((list) => list.filter((item) => item.question && item.answer)),
  },
  { error: 'Send the question as a JSON object.' },
);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real 'YYYY-MM-DD' date, or null. */
function dateOf(value) {
  if (typeof value !== 'string' || !DATE.test(value.trim())) return null;
  const parsed = dayjs(value.trim(), 'YYYY-MM-DD', true);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}

/**
 * Checks a tool's from/to.
 * @param {{ from?: unknown, to?: unknown }} args
 * @returns {{ from: string, to: string } | { error: string }}
 */
export function parseRange(args) {
  const from = dateOf(args?.from);
  const to = dateOf(args?.to);
  if (!from || !to) return { error: 'Give from and to as dates like 2026-10-26.' };
  if (from > to) return { error: 'The from date must be on or before the to date.' };
  const days = dayjs.utc(to).diff(dayjs.utc(from), 'day') + 1;
  if (days > MAX_RANGE_DAYS) {
    return {
      error: `The date range can be at most ${MAX_RANGE_DAYS} days. Ask for a shorter period.`,
    };
  }
  return { from, to };
}

/** An optional name argument: trimmed text, or null when missing or blank. */
export function optionalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, 200) : null;
}

/**
 * Caps a list at MAX_ROWS.
 * @template T
 * @param {T[]} rows
 * @returns {{ rows: T[], truncated?: { shown: number, total: number } }}
 */
export function capRows(rows) {
  if (rows.length <= MAX_ROWS) return { rows };
  return { rows: rows.slice(0, MAX_ROWS), truncated: { shown: MAX_ROWS, total: rows.length } };
}
