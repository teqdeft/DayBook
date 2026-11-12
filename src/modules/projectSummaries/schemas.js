// Input schemas for files, notes and AI summaries (CONTRACT 22), and the shape an AI answer must have
// before anything of it is kept. Safe in the browser: the PDF reader and the note form share the
// limits. Every string of an answer is tidied and cut to length here, and stays plain text.
import { z } from 'zod';
import { PHASE_KEYS } from '@/modules/projectPlan/phases';

export const MAX_TITLE_LENGTH = 200;
export const MAX_TEXT_LENGTH = 200_000;
export const MAX_PAGES = 100;
export const MAX_DOCUMENTS = 40;

/** Longest strings kept from an answer. A task title is at most 200, so action text is too. */
export const ANSWER_CAPS = Object.freeze({ overview: 400, text: 200, when: 80, quote: 300 });
/** Points of each kind a summary keeps. */
export const MAX_POINTS = 5;

const BODY_MESSAGE = 'Send the fields as a JSON object.';
const EMPTY_MESSAGE = 'Add a title and the note text.';
const TITLE_LONG = `Keep the title to ${MAX_TITLE_LENGTH} characters or fewer.`;
const TEXT_LONG = `Keep the text to ${MAX_TEXT_LENGTH.toLocaleString('en-US')} characters or fewer.`;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g;
const EDGE_SPACES = new Set([' ', '\t', '\r', '\n', '\u{A0}']);

/**
 * Takes spaces and line breaks off both ends, but not form feeds: one there is an empty page, and
 * page numbers count it. A loop rather than a pattern, which would be slow on a long run of spaces.
 */
function trimSpaces(value) {
  let start = 0;
  let end = value.length;
  while (start < end && EDGE_SPACES.has(value[start])) start += 1;
  while (end > start && EDGE_SPACES.has(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

const titleSchema = z
  .string({ error: EMPTY_MESSAGE })
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, EMPTY_MESSAGE).max(MAX_TITLE_LENGTH, TITLE_LONG));

const textSchema = z
  .string({ error: EMPTY_MESSAGE })
  .transform((value) => trimSpaces(value.replace(CONTROL_CHARACTERS, '')))
  .pipe(
    z
      .string()
      .refine((value) => value.replace(/\f/g, '').trim() !== '', EMPTY_MESSAGE)
      .refine((value) => value.length <= MAX_TEXT_LENGTH, TEXT_LONG),
  );

const pagesSchema = z
  .number({ error: 'Pages must be a whole number.' })
  .int('Pages must be a whole number.')
  .min(1, 'Pages must be a whole number.')
  .nullish()
  .transform((value) => value ?? null);

/** POST /api/projects/:id/documents. A note has no pages. */
export const documentCreateSchema = z
  .object(
    {
      phase: z.enum(PHASE_KEYS, { error: 'Pick a phase from the list.' }),
      kind: z.enum(['file', 'note'], { error: 'Choose a file or a note.' }),
      title: titleSchema,
      text: textSchema,
      pages: pagesSchema.refine(
        (value) => value === null || value <= MAX_PAGES,
        `Daybook reads the first ${MAX_PAGES} pages at most.`,
      ),
      pagesTotal: pagesSchema,
    },
    { error: BODY_MESSAGE },
  )
  .refine(({ pages, pagesTotal }) => !pages || !pagesTotal || pagesTotal >= pages, {
    path: ['pagesTotal'],
    message: "A file can't have fewer pages than were read.",
  })
  .transform((value) =>
    value.kind === 'note' ? { ...value, pages: null, pagesTotal: null } : value,
  );

/** PATCH /api/project-documents/:id: a note's title, its text, or both. */
export const documentUpdateSchema = z
  .object({ title: titleSchema.optional(), text: textSchema.optional() }, { error: BODY_MESSAGE })
  .refine(({ title, text }) => title !== undefined || text !== undefined, EMPTY_MESSAGE);

/** POST /api/ai/projects/:id/summary/tasks */
export const summaryTaskSchema = z.object(
  {
    actionKey: z
      .string({ error: 'Pick an action item.' })
      .trim()
      .min(1, 'Pick an action item.')
      .max(64, 'Pick an action item.'),
  },
  { error: BODY_MESSAGE },
);

// ---------- the AI's answer ----------

/** Cuts text to at most `max` characters without leaving half of an emoji at the end. */
export function cutText(text, max) {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** One line of plain text, at most `max` characters. */
export function tidyAnswerText(value, max) {
  if (typeof value !== 'string') return '';
  return cutText(value.replace(/[\s\u0000-\u001F\u007F]+/g, ' ').trim(), max).trim();
}

/** A required string of an answer. Empty after tidying fails, so the point is dropped. */
const answerText = (max, min = 1) =>
  z
    .string()
    .transform((value) => tidyAnswerText(value, max))
    .pipe(z.string().min(min));

/** An optional string of an answer, such as a date as written. */
const answerWhen = z
  .string()
  .nullish()
  .transform((value) => tidyAnswerText(value, ANSWER_CAPS.when) || null);

const sourced = {
  doc: z.string().max(12),
  quote: answerText(ANSWER_CAPS.quote),
};

export const scopePointSchema = z.object({
  text: answerText(ANSWER_CAPS.text),
  notInScope: z
    .boolean()
    .nullish()
    .transform((value) => value === true),
  ...sourced,
});

export const deadlinePointSchema = z.object({
  text: answerText(ANSWER_CAPS.text),
  dateAsWritten: answerWhen,
  ...sourced,
});

export const riskPointSchema = z.object({
  text: answerText(ANSWER_CAPS.text),
  kind: z.enum(['risk', 'question']),
  ...sourced,
});

export const actionPointSchema = z.object({
  owner: z.enum(['client', 'us', 'unclear']),
  text: answerText(ANSWER_CAPS.text, 2), // it can become a task, whose title is at least 2
  dueAsWritten: answerWhen,
  ...sourced,
});

/** A suggested phase. The phase itself is checked against the list by checks.js. */
export const nextPhaseSchema = z.object({ ...sourced });
