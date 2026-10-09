// What a person's timers look like now (Today's Working on card and the sidebar chip) and a day's
// timer summary for the daily report.
import { dayjs, now } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { settings } from '@/modules/settings';
import { awayForState } from './away';
import * as repo from './repo';
import { summarizeDay } from './rules';
import { canUse, loadToday, toEntryView } from './shared';

/** Why the person can't start a timer now (timers are on), or null. */
function blockedFor(ctx, allowed) {
  if (!allowed) return 'not_allowed';
  if (!ctx.row) return 'not_checked_in';
  if (!ctx.open) return 'checked_out';
  return null;
}

/** The state with nothing in it: no timer, break, entries or away time. */
function emptyState({ mode, allowed, blocked, at }) {
  return {
    mode,
    canUse: allowed,
    blocked,
    running: null,
    onBreak: false,
    breakStartedAt: null,
    entries: [],
    totalMinutes: 0,
    byProject: [],
    away: null,
    serverNow: at.toISOString(),
  };
}

/**
 * The state while timers are off: blocked, and only a timer left running from before is read, so
 * the chip can still show it with Stop. No entries, break, away time or summary.
 */
async function offState({ user, allowed, tz, at }) {
  const state = emptyState({ mode: 'off', allowed, blocked: 'off', at });
  if (!allowed) return state;
  const runningRow = await repo.findRunning(user.id);
  return { ...state, running: runningRow ? toEntryView(runningRow, tz, at) : null };
}

/**
 * The person's timer state. Never throws for a signed-in person: anything that stops them from
 * starting a timer is in `blocked`. Entries are today's (after check-out too, to read). While
 * timers are off it only reads a running timer (the rest stays empty).
 * @param {{ user: object }} input the session user
 * @returns {Promise<{ mode: 'off' | 'optional' | 'required', canUse: boolean,
 *   blocked: null | 'off' | 'not_checked_in' | 'checked_out' | 'not_allowed',
 *   running: object | null, onBreak: boolean, breakStartedAt: string | null,
 *   entries: object[], totalMinutes: number,
 *   byProject: Array<{ projectId, projectName, projectColor, minutes }>,
 *   away: { entryId, from, to, minutes, fromClock, toClock, projectName } | null,
 *   serverNow: string }>} running and entries are EntryViews (entries oldest first); canUse:
 *   the person may use timers at all (active, tracked, checks in and writes reports); away only
 *   while a timer runs and nothing blocks
 */
export async function getState({ user }) {
  const at = now();
  const allowed = canUse(user);
  const current = await settings.getAll();
  if (current.timersMode === 'off') return offState({ user, allowed, tz: current.timezone, at });
  const ctx = await loadToday(user.id, current);
  const blocked = blockedFor(ctx, allowed);
  const state = emptyState({ mode: ctx.settings.timersMode, allowed, blocked, at });
  if (!allowed) return state;
  const [rows, runningRow, openBreak] = await Promise.all([
    repo.listForUserDate(user.id, ctx.date),
    repo.findRunning(user.id),
    attendance.getOpenBreak(user.id),
  ]);
  const entries = rows.map((row) => toEntryView(row, ctx.tz, at));
  const summary = summarizeDay(entries);
  // A break left open from an earlier day (until the midnight job closes it) is not today's.
  const onBreak = openBreak?.workDate === ctx.date ? openBreak : null;
  return {
    ...state,
    running: runningRow ? toEntryView(runningRow, ctx.tz, at) : null,
    onBreak: Boolean(onBreak),
    breakStartedAt: onBreak ? dayjs(onBreak.startedAt).toISOString() : null,
    entries,
    totalMinutes: summary.totalMinutes,
    byProject: summary.projects.map(({ projectId, projectName, projectColor, minutes }) => ({
      projectId,
      projectName,
      projectColor,
      minutes,
    })),
    // A timer left running from an earlier day (until it is closed) is never asked about.
    away:
      blocked === null && runningRow?.workDate === ctx.date
        ? await awayForState(runningRow, ctx, at)
        : null,
  };
}

/**
 * An entry whose priority task is no longer open, as a plain note line: its note, else the task's
 * title, without the link. A report line can't newly link a task that is done, so "Fill report
 * from timers" must not add one.
 */
function withOpenTaskOnly(row, entry) {
  if (!entry.projectTaskId || row.projectTaskStatus === 'open') return entry;
  return {
    ...entry,
    note: entry.note?.trim() || entry.projectTaskTitle,
    projectTaskId: null,
    priority: null,
    projectTaskTitle: null,
  };
}

/**
 * One person's timer time on one day, as the daily report uses it ("From your timers", Fill
 * report from timers, required mode). A running entry counts up to now.
 * @param {number} userId
 * @param {string} workDate 'YYYY-MM-DD'
 * @returns {Promise<{ totalMinutes: number, projects: Array<{ projectId, projectName,
 *   projectColor, isUrgent, minutes, roundedMinutes, tasks: Array<{ note, projectTaskId,
 *   priority, projectTaskTitle }> }> }>} biggest project first; roundedMinutes to the nearest
 *   15; tasks de-duplicated by priority task, else by case-insensitive note (an entry with only
 *   a priority task gives a line titled with the task); only open priority tasks are linked: a
 *   task that is done since gives a plain line (its note, else its title)
 */
export async function getDaySummary(userId, workDate) {
  const current = await settings.getAll();
  const at = now();
  const rows = await repo.listForUserDate(userId, workDate);
  return summarizeDay(
    rows.map((row) => withOpenTaskOnly(row, toEntryView(row, current.timezone, at))),
  );
}
