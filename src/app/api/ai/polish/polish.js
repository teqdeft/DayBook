// "Polish my tasks" (CONTRACT 20): the fast model rewrites the daily report's task lines as clear,
// short lines in the same language, with the same meaning and no new facts. The lines go to
// Gemini as "L1", "L2", … (never the browser's keys) and come back as JSON keyed by those ids.
// Every key sent comes back once, in order: with Gemini's line, or with its own title when Gemini
// skipped it, changed nothing or answered something that can't be used. Anything else is dropped.
import { z } from 'zod';
import { ai } from '@/modules/ai';

/** Lines one request may polish, and the longest title it takes (a report task's limit). */
export const MAX_POLISH_LINES = 60;
export const MAX_POLISH_TITLE = 500;
/** The length the prompt asks for; a longer answer is kept only when the line was longer. */
export const POLISHED_LENGTH = 120;

const lineSchema = z.object({
  key: z
    .string({ error: 'Each task needs a key.' })
    .trim()
    .min(1, 'Each task needs a key.')
    .max(64, 'Task keys are 64 characters or fewer.'),
  title: z
    .string({ error: 'Write the task as text.' })
    .trim()
    .min(1, 'Write the task first.')
    .max(MAX_POLISH_TITLE, `Keep the task under ${MAX_POLISH_TITLE} characters.`),
  projectName: z
    .string({ error: 'The project name must be text.' })
    .trim()
    .max(200, 'The project name is too long.')
    .nullish()
    .transform((value) => value ?? ''),
});

/** POST /api/ai/polish: 1-60 task lines, each with its own key. */
export const polishBodySchema = z.object({
  lines: z
    .array(lineSchema, { error: 'Send the tasks to polish.' })
    .min(1, 'There are no tasks to polish.')
    .max(MAX_POLISH_LINES, `Polish up to ${MAX_POLISH_LINES} tasks at a time.`)
    .superRefine((lines, context) => {
      const seen = new Set();
      lines.forEach((line, index) => {
        if (seen.has(line.key)) {
          context.addIssue({
            code: 'custom',
            path: [index, 'key'],
            message: 'Each task needs its own key.',
          });
        }
        seen.add(line.key);
      });
    }),
});

const SYSTEM = [
  "You tidy up the task lines of an employee's daily work report.",
  `Rewrite each line as one clear, short line of at most ${POLISHED_LENGTH} characters.`,
  'Keep the language the line is written in, and keep its meaning.',
  'Fix spelling, grammar and capital letters and drop filler words. No full stop at the end.',
  'Never add facts, numbers, people, dates or reasons that are not in the line, and never drop any that are.',
  'Keep product names, project names, client names, ticket numbers, code, file names, links and placeholders such as [email 1] exactly as they are written.',
  'If a line already reads well, or you are not sure what it means, return it exactly as it is.',
  "Answer with a JSON object: each line's id as a key and the rewritten line as its value, for every id and nothing else.",
].join('\n');

/** The answer's JSON schema: one string per line id, all of them required. */
function answerSchema(ids) {
  return {
    type: 'object',
    properties: Object.fromEntries(ids.map((id) => [id, { type: 'string' }])),
    required: ids,
  };
}

// A placeholder the AI core couldn't put back, and emails (a line must not gain one).
const PLACEHOLDER = /\[(?:email|phone|ip|slack id)(?: \d{1,4})?\]/i;
const EMAIL = /[\p{L}\p{M}\p{N}_.%+-]+@[\p{L}\p{M}\p{N}-]+(?:\.[\p{L}\p{M}\p{N}-]+)+/gu;

/** Emails in a suggestion that the original line doesn't have. */
function gainsEmail(text, original) {
  const known = new Set((original.match(EMAIL) ?? []).map((email) => email.toLowerCase()));
  return (text.match(EMAIL) ?? []).some((email) => !known.has(email.toLowerCase()));
}

/**
 * Gemini's line for one task, or the task's own title when the answer can't be used: not text,
 * empty, longer than asked (and than the line), a placeholder left in it, or a new email.
 * Whitespace and line breaks become single spaces.
 * @param {unknown} value the answer's value for this line's id
 * @param {string} original the task's title (trimmed)
 * @returns {string}
 */
export function usableSuggestion(value, original) {
  if (typeof value !== 'string') return original;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return original;
  if (text.length > Math.max(POLISHED_LENGTH, original.length)) return original;
  if (PLACEHOLDER.test(text) && !PLACEHOLDER.test(original)) return original;
  if (gainsEmail(text, original)) return original;
  return text;
}

/**
 * Suggests clearer wording for the daily report's task lines (CONTRACT 20, "Polish my tasks"):
 * one request to the fast model, counted against the company's daily limit and the person's 20
 * polish requests a day. Project names go with the lines as context; nothing else about the
 * person or the report is sent.
 * @param {{ user: { id: number }, lines: Array<{ key: string, title: string,
 *   projectName?: string }> }} input lines as polishBodySchema parsed them (unique keys)
 * @returns {Promise<{ lines: Array<{ key: string, title: string }> }>} every key sent, in the
 *   same order, once; title is the suggestion, or the line's own title when it stays as it is
 * @throws AppError AI_OFF (409) | AI_LIMIT (429) | AI_BUSY (503) | AI_ERROR (502), from
 *   ai.generate
 */
export async function polishLines({ user, lines }) {
  const ids = lines.map((_, index) => `L${index + 1}`);
  const sent = lines.map((line, index) => ({
    id: ids[index],
    project: line.projectName || null,
    line: line.title,
  }));
  const { data } = await ai.generate({
    feature: 'polish',
    userId: user.id,
    model: 'fast',
    system: SYSTEM,
    prompt: `Task lines to rewrite (id, project, line):\n${JSON.stringify(sent, null, 1)}`,
    json: answerSchema(ids),
  });
  const answers = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    lines: lines.map((line, index) => ({
      key: line.key,
      title: usableSuggestion(
        Object.hasOwn(answers, ids[index]) ? answers[ids[index]] : undefined,
        line.title,
      ),
    })),
  };
}
