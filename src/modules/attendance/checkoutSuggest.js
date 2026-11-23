// Suggested check-out times for missing check-outs (CONTRACT 25, items B and 7): Today's pop-up
// and HR's list both ask this, so they always show the same time. Per row one activity.getDay
// read (the read auto check-out uses, never getTeamDay) and that day's breaks; per date one
// timers.lastRanByUser (finished entries only, so a timer still running from a past date gives
// no sign). A past day's suggestion doesn't change, so it is kept per process by attendance id
// (at most 1,000, the oldest dropped first); a break fix of that row forgets it. `activity` and
// `timers` are only used inside functions (they import attendance too).
import { on } from '@/lib/events';
import { dayjs } from '@/lib/time';
import { activity } from '@/modules/activity';
import { settings } from '@/modules/settings';
import { timers } from '@/modules/timers';
import { suggestedCheckoutAt } from './missingRules';
import * as repo from './repo';
import { todayFor } from './rules';

const MAX_KEPT = 1000;
const kept = globalThis.__daybookCheckoutSuggestions ?? new Map();
globalThis.__daybookCheckoutSuggestions = kept;

const checkInMs = (row) => dayjs(row.checkInAt).valueOf();

function remember(id, entry) {
  if (kept.has(id)) kept.delete(id);
  else if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value);
  kept.set(id, entry);
}

/**
 * Forgets the kept suggestion of one row (a break fix of that row changes it).
 * @param {number} attendanceId
 */
export function forgetSuggestion(attendanceId) {
  kept.delete(Number(attendanceId));
}

/** Forgets every kept suggestion in this process (tests). */
export function clearSuggestions() {
  kept.clear();
}

// HR's break change or delete (breakFixes.js emits this after commit) moves the row's suggestion.
// One listener per process, however often this module is loaded (dev reloads it).
globalThis.__daybookSuggestionListener ??= on('attendance.break_fixed', ({ attendanceId }) =>
  forgetSuggestion(attendanceId),
);

/** The end of each row's last finished timer entry, one lastRanByUser query per date. */
async function timerSignsOf(rows) {
  const byDate = new Map();
  for (const row of rows) byDate.set(row.workDate, [...(byDate.get(row.workDate) ?? []), row]);
  const signs = new Map();
  await Promise.all(
    [...byDate].map(async ([workDate, dayRows]) => {
      const userIds = dayRows.map((row) => Number(row.userId));
      const ran = await timers.lastRanByUser({ workDate, userIds });
      for (const row of dayRows) signs.set(Number(row.id), ran.get(Number(row.userId)) ?? null);
    }),
  );
  return signs;
}

/**
 * The suggested check-out time of each row (suggestedCheckoutAt()), null when Daybook saw no
 * work after the check-in.
 * @param {Array<{ id: number, userId: number, workDate: string, checkInAt: Date }>} rows
 *   AttendanceRows (missing check-outs)
 * @returns {Promise<Map<number, Date | null>>} by attendance id
 */
export async function suggestCheckoutTimes(rows) {
  const result = new Map();
  const list = (rows ?? []).filter((row) => row?.id && row.checkInAt && row.workDate);
  if (list.length === 0) return result;
  const toRead = [];
  for (const row of list) {
    const hit = kept.get(Number(row.id));
    if (hit && hit.checkInMs === checkInMs(row)) result.set(Number(row.id), hit.value);
    else toRead.push(row);
  }
  if (toRead.length === 0) return result;
  const current = await settings.getAll();
  const today = todayFor(current);
  const signs = await timerSignsOf(toRead);
  await Promise.all(
    toRead.map(async (row) => {
      const [day, breaks] = await Promise.all([
        activity.getDay(row.userId, row.workDate),
        repo.listBreaksByUserDate(row.userId, row.workDate),
      ]);
      const value = suggestedCheckoutAt({
        row,
        segments: day?.segments ?? [],
        timerAt: signs.get(Number(row.id)) ?? null,
        breaks,
        tz: current.timezone,
      });
      result.set(Number(row.id), value);
      if (row.workDate < today) remember(Number(row.id), { checkInMs: checkInMs(row), value });
    }),
  );
  return result;
}
