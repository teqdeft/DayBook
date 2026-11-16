// Reading today's to-do (CONTRACT 24) for the Today card and GET /api/me/todo. The to-do is the
// person's report for today: its projects are the groups and its task lines are the lines, so
// reading it never creates the draft.
import { logger } from '@/lib/logger';
import { dayjs, locksAtFor, now, workDate } from '@/lib/time';
import { settings } from '@/modules/settings';
import { slack } from '@/modules/slack';
import { timers } from '@/modules/timers';
import * as repo from './repo';
import { findTodoPost } from './queries';
import { listCarrySuggestions } from './suggestions';
import * as todoRepo from './todoRepo';
import { planHash, planOf, postState, todoGroups } from './todoView';
import { isEditable, loadEntriesFor } from './view';

const NOTHING_SENT = { status: 'none', at: null };

/** Carried line's source id -> the day of its report (the "From Wednesday" tag). */
async function sourceDaysOf(entries) {
  const ids = entries.flatMap((entry) =>
    entry.tasks.map((task) => Number(task.carriedFromTaskId)).filter(Boolean),
  );
  const rows = await todoRepo.listSourceLines([...new Set(ids)]);
  return new Map(rows.map((row) => [Number(row.id), row.workDate]));
}

/** The suggestions for the day, or none when they can't be read (the to-do still shows). */
async function suggestionsFor(user, day) {
  try {
    return await listCarrySuggestions({ userId: user.id, date: day });
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, 'could not read the suggestions for the to-do');
    return {};
  }
}

/** Where the to-do post stands, and whether to-dos can be posted at all. */
async function postOf(report, plan) {
  if (!report) {
    const post = postState({ todoPost: null, delivery: NOTHING_SENT, hash: '' });
    return { post, postingOn: await slack.canPostTodo() };
  }
  const [todoPost, delivery, postingOn] = await Promise.all([
    findTodoPost(report.id),
    slack.latestTodoDelivery(report.id),
    slack.canPostTodo(),
  ]);
  return { post: postState({ todoPost, delivery, hash: planHash(plan) }), postingOn };
}

/** Whether the report for the day could still be written (a day without a report yet). */
function openUntilLock(day, current) {
  return now().isBefore(dayjs(locksAtFor(day, current.reportLock, current.timezone)));
}

/** Checked in, not on a break, not checked out, timers on, and allowed to use them. */
function canStartTimer(state) {
  return Boolean(state?.canUse) && state.blocked === null && !state.onBreak;
}

/**
 * The person's to-do for a day (today unless `date` says otherwise). Never creates the draft.
 * @param {{ user: object, date?: string, timerState?: object }} input timerState: the person's
 *   timers.getState() when the caller already has it (Today reads it anyway)
 * @returns {Promise<{ workDate: string, reportId: number | null, editable: boolean,
 *   submitted: boolean, done: number, total: number,
 *   post: { state: 'none' | 'sending' | 'sent' | 'failed', at: string | null, changed: boolean,
 *     postedAt: string | null },
 *   slack: { canPost: boolean }, timer: { canStart: boolean },
 *   groups: Array<{ entryId: number, project?: { id, name, color }, request?: { id, name },
 *     minutes: number, lines: Array<{ id, title, status, done, projectTaskId, now,
 *     carriedFrom: { workDate, dayLabel } | null, canStart }> }>,
 *   suggestions: Record<string, Array<{ taskId, title, status, workDate, dayLabel }>> }>}
 *   groups in report order, lines with something written in report order; post.changed: the
 *   projects or titles changed since the last post (a tick doesn't count); slack.canPost: posting
 *   is on (Slack, a bot token and a to-do channel), the report is editable and the list has a
 *   line; timer.canStart and line.canStart: whether Play shows (line: an active project, not
 *   Done, not already timed); suggestions: listCarrySuggestions while the report takes changes,
 *   else {}
 */
export async function getTodo({ user, date, timerState } = {}) {
  const current = await settings.getAll();
  const today = workDate(current.timezone);
  const day = date ?? today;
  const report = (await repo.findByUserAndDate(user.id, day)) ?? null;
  const entries = report ? ((await loadEntriesFor([report.id])).get(report.id) ?? []) : [];
  const editable = report ? isEditable(report) : openUntilLock(day, current);
  const submitted = report?.status === 'submitted';
  const plan = planOf(entries);
  const [{ post, postingOn }, state, sourceDays, suggestions] = await Promise.all([
    postOf(report, plan),
    day === today ? (timerState ?? timers.getState({ user })) : null,
    sourceDaysOf(entries),
    editable && !submitted ? suggestionsFor(user, day) : {},
  ]);
  const canStart = canStartTimer(state);
  const groups = todoGroups(entries, {
    today: day,
    running: state?.running ?? null,
    sourceDays,
    canStart,
  });
  const lines = groups.flatMap((group) => group.lines);
  return {
    workDate: day,
    reportId: report?.id ?? null,
    editable,
    submitted,
    done: lines.filter((line) => line.done).length,
    total: lines.length,
    post,
    slack: { canPost: postingOn && editable && lines.length > 0 },
    timer: { canStart },
    groups,
    suggestions,
  };
}
