// What Daybook keeps of an AI answer (CONTRACT 22). A point stays only when its quote is really in
// the document it names, as that document was sent. Daybook works out the page itself, from where
// it finds the quote: the AI's word is never taken for it. Points that fail are dropped and counted,
// and nothing here runs or renders anything from the answer: it only ever becomes plain strings.
import crypto from 'node:crypto';
import { isPhase } from '@/modules/projectPlan/phases';
import {
  actionPointSchema,
  ANSWER_CAPS,
  cutText,
  deadlinePointSchema,
  MAX_POINTS,
  nextPhaseSchema,
  riskPointSchema,
  scopePointSchema,
  tidyAnswerText,
} from './schemas';

/** A quote shorter than this says nothing, wherever it is found. */
const MIN_QUOTE_LENGTH = 3;
/** Room for the spaces and hyphens that joining pages adds or takes away. */
const SPAN_SLACK = 8;

const INVISIBLE = /[\u{200B}-\u{200D}\u{AD}]/gu;
const SINGLE_QUOTES = /[\u{2018}\u{2019}\u{201A}\u{201B}\u{2032}\u{60}]/gu;
const DOUBLE_QUOTES = /[\u{201C}\u{201D}\u{201E}\u{201F}\u{AB}\u{BB}]/gu;
// A word broken by a hyphen, at a line or page end or as a PDF reader leaves it ("imple- mentation").
// Every hyphen between letters goes, on both sides, so "well-\nknown" and "well-known" also match.
const WORD_HYPHEN = /(?<=[\p{L}\p{M}])[-\u{2010}]\s*(?=[\p{L}\p{M}])/gu;
const EDGE_QUOTE_MARKS = /^["']+|["']+$/g;

/**
 * The form both a quote and a document take before they are compared: NFKC, no invisible characters
 * (U+200B to U+200D, U+00AD), words hyphenated across lines joined, single spaces, one kind of quote
 * mark, case-folded.
 * @param {string} text
 * @returns {string}
 */
export function normalizeForMatch(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(WORD_HYPHEN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .toLowerCase();
}

/** A quote as it is searched for, without the quote marks a model tends to wrap it in. */
function normalizeQuote(quote) {
  return normalizeForMatch(quote).replace(EDGE_QUOTE_MARKS, '').trim();
}

/** A document as sent, ready to search: its whole text and each page between form feeds. */
function indexDocument(document) {
  const pages = document.text.split('\f');
  return {
    document,
    whole: normalizeForMatch(document.text),
    pages: pages.map(normalizeForMatch),
    rawPages: pages,
  };
}

/** Whether the pages `from` to `to` (0-based, both in), joined as sent, hold the quote. */
function spans(entry, from, to, quote) {
  return normalizeForMatch(entry.rawPages.slice(from, to + 1).join('\f')).includes(quote);
}

/**
 * The last page (0-based) of the first run of pages from `start` that holds the quote, or -1. It
 * stops once the pages after `start` hold more than the quote: one starting on `start` ends before.
 */
function spanEnd(entry, start, quote) {
  let after = 0;
  for (let end = start + 1; end < entry.pages.length; end += 1) {
    if (spans(entry, start, end, quote)) return end;
    after += entry.pages[end].length;
    if (after > quote.length + SPAN_SLACK) return -1;
  }
  return -1;
}

/**
 * The page (1, 2, …) a quote is on. A quote across page breaks is on the page it starts on, also
 * when it goes on after a blank page (or one with only a picture).
 */
function pageOf(entry, quote) {
  const single = entry.pages.findIndex((page) => page.includes(quote));
  if (single !== -1) return single + 1;
  for (let start = 0; start < entry.pages.length - 1; start += 1) {
    const end = spanEnd(entry, start, quote);
    // Held by the pages after `start` alone, it starts on a later page.
    if (end !== -1 && !spans(entry, start + 1, end, quote)) return start + 1;
  }
  return null;
}

/**
 * Looks for a quote in one document.
 * @param {{ text: string }} document text = the document's text as it was sent (pages joined by \f)
 * @param {string} quote
 * @returns {{ found: boolean, page: number | null }} page = where Daybook found it
 */
export function findQuote(document, quote) {
  return locate(indexDocument(document), quote);
}

function locate(entry, quote) {
  const wanted = normalizeQuote(quote);
  if (wanted.length < MIN_QUOTE_LENGTH || !entry.whole.includes(wanted)) {
    return { found: false, page: null };
  }
  return { found: true, page: pageOf(entry, wanted) };
}

/**
 * Where a point came from, as the page shows it: "SOW-Acme-v3.pdf, page 3". A note is just its title,
 * and so is a file without pages (.txt, .md).
 * @param {{ kind: 'file' | 'note', title: string, pages?: number | null }} document
 * @param {number | null} page
 * @returns {string}
 */
export function sourceLabel(document, page) {
  if (document.kind !== 'file' || !document.pages || !page) return document.title;
  return `${document.title}, page ${page}`;
}

/**
 * The stable key of an action item: a hash of its normalised owner and text. It is made from the
 * text after the names are back, because tokens change from one answer to the next.
 * @param {string} owner
 * @param {string} text
 * @returns {string} 32 hex characters
 */
export function actionKey(owner, text) {
  const value = `${normalizeForMatch(owner)}\n${normalizeForMatch(text)}`;
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/** Checks one point: its shape, its document and its quote. Returns what to keep, or null. */
function checkPoint(item, schema, context) {
  const parsed = schema.safeParse(item);
  if (!parsed.success) return null;
  const { doc, quote, ...fields } = parsed.data;
  const entry = context.index.get(doc);
  if (!entry) return null;
  const { found, page } = locate(entry, quote);
  if (!found) return null;
  const { finish } = context;
  const kept = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'string' ? tidyAnswerText(finish(value), capFor(key)) : value,
    ]),
  );
  return {
    ...kept,
    documentId: entry.document.id,
    page,
    source: finish(sourceLabel(entry.document, page)),
    quote: cutText(finish(quote), ANSWER_CAPS.quote),
  };
}

function capFor(key) {
  return key === 'dateAsWritten' || key === 'dueAsWritten' ? ANSWER_CAPS.when : ANSWER_CAPS.text;
}

/** The points of one list that pass, at most MAX_POINTS. Everything else counts as dropped. */
function checkList(list, schema, context) {
  const items = Array.isArray(list) ? list : [];
  const kept = [];
  for (const item of items) {
    const point = kept.length < MAX_POINTS ? checkPoint(item, schema, context) : null;
    if (point) kept.push(point);
    else context.dropped += 1;
  }
  return kept;
}

/** Action items with their keys; the same item twice is dropped. */
function checkActions(list, context) {
  const seen = new Set();
  const actions = [];
  for (const point of checkList(list, actionPointSchema, context)) {
    const key = actionKey(point.owner, point.text);
    if (seen.has(key)) {
      context.dropped += 1;
      continue;
    }
    seen.add(key);
    actions.push({ key, ...point, taskId: null });
  }
  return actions;
}

/** The suggested phase, or null: unknown phases go, and a known one still needs a found quote. */
function checkNextPhase(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.phase === null || value.phase === undefined) return null;
  const point = isPhase(value.phase) ? checkPoint(value, nextPhaseSchema, context) : null;
  if (point) return { phase: value.phase, ...point };
  context.dropped += 1;
  return null;
}

/**
 * Turns an AI answer into what is stored. Only the fields below survive; strings are capped, and a
 * point stays only when its quote is found in the document it names.
 * @param {unknown} answer the parsed JSON from the AI
 * @param {Array<{ ref: string, id: number, kind: 'file' | 'note', title: string,
 *   pages?: number | null, text: string }>} documents what was sent; ref = 'D1', 'D2', …
 * @param {{ finish?: (text: string) => string }} [options] finish runs on every kept string once the
 *   quote is checked (names back, contact details masked)
 * @returns {{ body: { overview: string, scope: object[], deadlines: object[], risks: object[],
 *   actions: object[], nextPhase: object | null }, droppedCount: number } | null} null when the
 *   answer isn't an object or holds nothing to show
 */
export function checkAnswer(answer, documents, { finish = (text) => text } = {}) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const context = {
    index: new Map(documents.map((document) => [document.ref, indexDocument(document)])),
    finish,
    dropped: 0,
  };
  const cap = ANSWER_CAPS.overview;
  const body = {
    overview: tidyAnswerText(finish(tidyAnswerText(answer.overview, cap)), cap),
    scope: checkList(answer.scope, scopePointSchema, context),
    deadlines: checkList(answer.deadlines, deadlinePointSchema, context),
    risks: checkList(answer.risks, riskPointSchema, context),
    actions: checkActions(answer.actions, context),
    nextPhase: checkNextPhase(answer.nextPhase, context),
  };
  const empty =
    !body.overview &&
    [body.scope, body.deadlines, body.risks, body.actions].every((list) => list.length === 0);
  return empty ? null : { body, droppedCount: context.dropped };
}

/**
 * A rewrite keeps the task of an item with the same key.
 * @param {Array<{ key: string, taskId: number | null }>} actions the new answer's items
 * @param {Array<{ key: string, taskId?: number | null }>} [previous] the stored summary's items
 * @returns {Array<object>} the items with their taskId
 */
export function keepTaskIds(actions, previous = []) {
  const tasks = new Map(previous.map((action) => [action.key, action.taskId ?? null]));
  return actions.map((action) => ({ ...action, taskId: tasks.get(action.key) ?? null }));
}
