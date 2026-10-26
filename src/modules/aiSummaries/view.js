// What the /summaries pages show (CONTRACT 20): the person's own AI summaries, newest first, and
// one summary as blocks. Someone else's summary is NOT_FOUND (ai.getSummary), and so is one the
// person's role no longer opens: a PM's daily summary needs team.view, HR's weekly notes need
// attendance.view_all (someone moved to Employee stops seeing them).
import { can } from '@/lib/permissions';
import { dayjs, formatDay, formatDayShort } from '@/lib/time';
import { ai } from '@/modules/ai';
import { toBlocks } from './text';

/** Summaries per page on /summaries. */
export const PAGE_SIZE = 20;

const KINDS = {
  pm_daily: { label: 'Daily project summary', tone: 'primary', permission: 'team.view' },
  hr_weekly: {
    label: 'Weekly attendance notes',
    tone: 'violet',
    permission: 'attendance.view_all',
  },
};

/**
 * The summary kinds a person may read now, from their current role.
 * @param {{ role: string, status?: string }} user
 * @returns {string[]}
 */
export function readableKinds(user) {
  return Object.keys(KINDS).filter((kind) => can(user, KINDS[kind].permission));
}

/**
 * How many summaries the person can read (the "Summaries" nav item shows when there are any).
 * @param {{ id: number, role: string, status?: string }} user
 * @returns {Promise<number>}
 */
export async function countMine(user) {
  const kinds = readableKinds(user);
  return kinds.length > 0 ? ai.countSummaries(user.id, { kinds }) : 0;
}

/**
 * 'Wed, 30 Sep' for one day; 'Mon, 26 – Fri, 30 Oct' for a range in one month, else
 * 'Mon, 28 Sep – Fri, 2 Oct'.
 * @param {string} from 'YYYY-MM-DD'
 * @param {string} [to]
 */
export function periodLabel(from, to) {
  if (!to || to === from) return formatDayShort(from);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = sameMonth ? dayjs(from, 'YYYY-MM-DD').format('ddd, D') : formatDayShort(from);
  return `${start} – ${formatDayShort(to)}`;
}

function viewOf(row) {
  const kind = KINDS[row.kind] ?? { label: 'Summary', tone: 'neutral' };
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: kind.label,
    tone: kind.tone,
    title: row.title,
    periodLabel: periodLabel(row.periodFrom, row.periodTo),
    createdAt: row.createdAt,
  };
}

/**
 * One page of the person's own summaries that their role opens, newest first.
 * @param {{ user: { id: number }, page?: number }} input page from 1; past the end = the last
 * @returns {Promise<{ items: Array<{ id: number, kind: string, kindLabel: string, tone: string,
 *   title: string, periodLabel: string, excerpt: string, createdAt: Date }>, total: number,
 *   page: number, pages: number }>}
 */
export async function listMine({ user, page = 1 }) {
  const kinds = readableKinds(user);
  const total = await countMine(user);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), pages);
  const rows =
    total > 0
      ? await ai.listSummaries(user.id, {
          limit: PAGE_SIZE,
          offset: (current - 1) * PAGE_SIZE,
          kinds,
        })
      : [];
  return {
    items: rows.map((row) => ({ ...viewOf(row), excerpt: row.excerpt })),
    total,
    page: current,
    pages,
  };
}

/**
 * One of the person's summaries for its page.
 * @param {{ user: { id: number }, id: number | string }} input
 * @returns {Promise<{ id: number, kind: string, kindLabel: string, tone: string, title: string,
 *   periodLabel: string, dateLabel: string, createdAt: Date, blocks: ReturnType<typeof toBlocks>
 *   }>} dateLabel = 'Wednesday, 30 September' for a day, the period label for a week
 * @throws AppError NOT_FOUND when it is missing, someone else's or of a kind the person's role
 *   doesn't open
 */
export async function getMine({ user, id }) {
  const row = await ai.getSummary({ userId: user.id, id, kinds: readableKinds(user) });
  const view = viewOf(row);
  return {
    ...view,
    dateLabel: row.periodFrom === row.periodTo ? formatDay(row.periodFrom) : view.periodLabel,
    blocks: toBlocks(row.body),
  };
}
