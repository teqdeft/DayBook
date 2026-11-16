// Today's to-do as the dashboards show it (CONTRACT 24): the Team board's "To-do: 2 of 5 done"
// popover and the Employee detail's "Today's to-do" card. A to-do line is a line of the person's
// report for today, so whoever sees reports sees it (PMs and Admins, never HR). Pure functions
// over todoRepo rows, and the Employee detail's read (todoToday).
import { can } from '@/lib/permissions';
import { formatTimeAmPm } from '@/lib/time';
import { dayLabel, normalizeTitle } from '@/modules/reports/todoText';
import { slack } from '@/modules/slack';
import * as repo from './repo';
import { isoOrNull } from './shared';
import { listReportLines, listTodoPostedAt } from './todoRepo';

/**
 * Whether someone writes daily reports, so has a to-do: `report.self` (an active person), except
 * an Admin who doesn't track attendance (the rule that hides Today and My log from them).
 * @param {{ role: string, status?: string, tracksAttendance?: boolean }} person
 */
export function writesReports(person) {
  if (!can(person, 'report.self')) return false;
  return !(person.role === 'admin' && !person.tracksAttendance);
}

/**
 * Whether to-dos are posted to Slack at all: Slack is on, the server has a bot token and an Admin
 * picked a to-do channel in Settings (there is no fallback to the report channel), the same rule
 * as the Today card's "Post to Slack" button (slack.canPostTodo). Only then do the dashboards say
 * "Posted to Slack at 9:41 AM" or "Not posted to Slack".
 * @param {{ slackEnabled?: boolean, slackTodoChannelId?: string|null }} settings
 * @param {boolean} [configured] whether a bot token is set (slack.isConfigured())
 */
export function todoPostingOn(settings, configured = slack.isConfigured()) {
  return Boolean(settings?.slackEnabled && settings?.slackTodoChannelId && configured);
}

/**
 * "Now": the person's running timer is on the line's project and its note, normalised, is the
 * line's timer note or its title.
 * @param {{ title: string, timerNote?: string|null }} line
 * @param {number|null} projectId the line's project (a project request never has a timer)
 * @param {{ projectId: number, note: string|null } | null} timer
 */
export function isNowLine(line, projectId, timer) {
  if (!timer || !projectId || Number(timer.projectId) !== Number(projectId)) return false;
  const note = normalizeTitle(timer.note ?? '');
  if (!note) return false;
  return note === normalizeTitle(line.timerNote ?? '') || note === normalizeTitle(line.title);
}

function groupOf(row) {
  if (row.projectId) {
    return {
      entryId: row.entryId,
      project: { id: row.projectId, name: row.projectName, color: row.projectColor ?? null },
      lines: [],
    };
  }
  return { entryId: row.entryId, request: { id: row.requestId, name: row.requestName }, lines: [] };
}

function lineOf(row, { today, timer }) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    done: row.status === 'done',
    now: isNowLine(row, row.projectId, timer),
    carriedFrom: row.carriedFromDate
      ? { workDate: row.carriedFromDate, dayLabel: dayLabel(row.carriedFromDate, today) }
      : null,
  };
}

/**
 * One person's to-do for today from their report's lines.
 * @param {object[]} rows listReportLines rows of one report, in report order
 * @param {{ today: string, tz: string, timer?: { projectId: number, note: string|null } | null,
 *   posting: boolean, postedAt?: Date|null }} options timer: the person's running timer; posting:
 *   todoPostingOn(settings); postedAt: daily_reports.todo_posted_at
 * @returns {{ total: number, done: number, post: { postedAt: string|null, at: string|null } | null,
 *   groups: ({ entryId: number, project: { id, name, color } } | { entryId: number,
 *   request: { id, name } }) & { lines: { id, title, status, done, now, carriedFrom:
 *   { workDate, dayLabel } | null }[] }[] } | null} null when the report has no lines; `post` is
 *   null while posting is off, else postedAt (ISO) and at ('9:41 AM'), both null until posted
 */
export function todoOf(rows, { today, tz, timer = null, posting, postedAt = null }) {
  const groups = new Map();
  for (const row of rows) {
    if (!String(row.title ?? '').trim()) continue;
    if (!groups.has(row.entryId)) groups.set(row.entryId, groupOf(row));
    groups.get(row.entryId).lines.push(lineOf(row, { today, timer }));
  }
  const list = [...groups.values()];
  const lines = list.flatMap((group) => group.lines);
  if (lines.length === 0) return null;
  return {
    total: lines.length,
    done: lines.filter((line) => line.done).length,
    post: posting
      ? { postedAt: isoOrNull(postedAt), at: postedAt ? formatTimeAmPm(postedAt, tz) : null }
      : null,
    groups: list,
  };
}

/** listReportLines rows by report id, each list in report order. */
export function linesByReport(rows) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.reportId) ?? [];
    list.push(row);
    map.set(row.reportId, list);
  }
  return map;
}

/**
 * Today's to-do of someone who writes reports (CONTRACT 24), read-only: { total, done, post,
 * groups } as on the Team board, with total 0 and no groups before the first line. Null for
 * someone who doesn't write reports (a PM, an Admin who doesn't check in, a deactivated person),
 * whose page has no to-do card.
 * @param {{ id: number, role: string, status: string, tracksAttendance: boolean }} person
 * @param {{ settings: object, today: string, tz: string }} ctx loadContext()
 */
export async function todoToday(person, ctx) {
  if (!writesReports(person)) return null;
  const posting = todoPostingOn(ctx.settings);
  const at = { date: ctx.today, userId: person.id };
  const [rows, postedAt, timers] = await Promise.all([
    listReportLines(at),
    posting ? listTodoPostedAt(at) : new Map(),
    ctx.settings.timersMode === 'off'
      ? []
      : repo.listRunningTimers(ctx.today, { userId: person.id }),
  ]);
  const todo = todoOf(rows, {
    today: ctx.today,
    tz: ctx.tz,
    timer: timers[0] ?? null,
    posting,
    postedAt: rows.length ? (postedAt.get(rows[0].reportId) ?? null) : null,
  });
  if (todo) return todo;
  return { total: 0, done: 0, post: posting ? { postedAt: null, at: null } : null, groups: [] };
}
