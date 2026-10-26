// The texts the worker writes for one person (CONTRACT 20): a PM's daily project summary
// ('pm_daily') and HR's weekly attendance notes ('hr_weekly'), shown on /summaries.
import { AppError } from '@/lib/errors';
import { nowDate } from '@/lib/time';
import * as repo from './repo';

export const SUMMARY_KINDS = Object.freeze(['pm_daily', 'hr_weekly']);
const TITLE_MAX = 200;
const BODY_MAX = 20_000;
const EXCERPT_MAX = 200;

/**
 * The start of a body on one line, the way the bell shows it: list dashes dropped, lines joined
 * with " · " (a label such as "Done:" runs on into its first item), cut at a word with "…" when
 * longer than 200.
 */
export function excerptOf(body) {
  let line = '';
  for (const raw of String(body ?? '').split('\n')) {
    const part = raw.trim().replace(/^-\s+/, '').replace(/\s+/g, ' ');
    if (!part) continue;
    if (!line) line = part;
    else line += line.endsWith(':') ? ` ${part}` : ` · ${part}`;
    if (line.length > EXCERPT_MAX) break;
  }
  if (line.length <= EXCERPT_MAX) return line;
  const cut = line.slice(0, EXCERPT_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > EXCERPT_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Saves a summary for one person. The same kind, person and period start saved again replaces
 * the title and body, so a re-run never makes a second one.
 * @param {{ kind: 'pm_daily' | 'hr_weekly', recipientId: number, periodFrom: string,
 *   periodTo: string, title: string, body: string }} input dates 'YYYY-MM-DD' (company time);
 *   body = plain text with "- " lists, names already restored
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<number>} the summary id (for the bell link `/summaries/<id>`)
 */
export async function saveSummary({ kind, recipientId, periodFrom, periodTo, title, body }, trx) {
  if (!SUMMARY_KINDS.includes(kind)) throw new Error(`saveSummary: unknown kind ${kind}`);
  const row = {
    kind,
    recipientId,
    periodFrom,
    periodTo,
    title: String(title).trim().slice(0, TITLE_MAX),
    body: String(body).trim().slice(0, BODY_MAX),
    createdAt: nowDate(),
  };
  try {
    return await repo.insertSummary(row, trx);
  } catch (error) {
    if (error?.errno !== 1062) throw error;
    return repo.replaceSummary(row, trx);
  }
}

/**
 * A person's own summaries, newest first, with a one-line excerpt instead of the body.
 * @param {number} userId
 * @param {{ limit?: number, offset?: number, kinds?: string[] }} [page] limit 1-100 (default
 *   20); kinds = only these kinds (all when left out)
 * @returns {Promise<Array<{ id: number, kind: string, periodFrom: string, periodTo: string,
 *   title: string, excerpt: string, createdAt: Date }>>}
 */
export async function listSummaries(userId, { limit = 20, offset = 0, kinds } = {}) {
  const rows = await repo.listSummaries(userId, {
    limit: Math.min(100, Math.max(1, Math.trunc(limit) || 20)),
    offset: Math.max(0, Math.trunc(offset) || 0),
    kinds,
  });
  return rows.map(({ body, recipientId: _recipientId, ...row }) => ({
    ...row,
    excerpt: excerptOf(body),
  }));
}

/**
 * How many summaries a person has (for paging /summaries).
 * @param {number} userId
 * @param {{ kinds?: string[] }} [filter] only these kinds (all when left out)
 */
export function countSummaries(userId, { kinds } = {}) {
  return repo.countSummaries(userId, { kinds });
}

/**
 * Who already has a summary of a kind for the period starting on a date (the worker skips them).
 * @param {{ kind: 'pm_daily' | 'hr_weekly', periodFrom: string }} input 'YYYY-MM-DD'
 * @returns {Promise<number[]>} recipient ids
 */
export function summaryRecipients({ kind, periodFrom }) {
  return repo.listSummaryRecipients({ kind, periodFrom });
}

/**
 * One of the person's summaries.
 * @param {{ userId: number, id: number, kinds?: string[] }} input kinds = only these kinds (all
 *   when left out)
 * @returns {Promise<{ id: number, kind: string, periodFrom: string, periodTo: string,
 *   title: string, body: string, createdAt: Date }>}
 * @throws AppError NOT_FOUND when it is missing, someone else's or of another kind
 */
export async function getSummary({ userId, id, kinds }) {
  const summaryId = Number(id);
  const row =
    Number.isInteger(summaryId) && summaryId > 0 ? await repo.findSummary(summaryId) : null;
  if (!row || Number(row.recipientId) !== Number(userId)) throw new AppError('NOT_FOUND');
  if (Array.isArray(kinds) && !kinds.includes(row.kind)) throw new AppError('NOT_FOUND');
  const { recipientId: _recipientId, ...summary } = row;
  return summary;
}
