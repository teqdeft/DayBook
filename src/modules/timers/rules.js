// Pure timer rules (CONTRACT 15): entry minutes, overlaps, and the day summary that fills the
// daily report. No database access here; unit tested. The away-time rules live in awayRules.js
// (CONTRACT 25 A); awaySpans, findAwaySpan and MERGE_GAP_MS are re-exported here so every import
// keeps working.
import { addDays, dayjs, localToUtc, minutesBetween, now } from '@/lib/time';

export { awaySpans, findAwaySpan, MERGE_GAP_MS } from './awayRules';

const ms = (value) => dayjs(value).valueOf();
const toDate = (value) => dayjs(value).toDate();

/** A moment cut to whole seconds (DATETIME columns keep whole seconds). */
export function wholeSecond(at) {
  return dayjs(at).startOf('second').toDate();
}

/** The first moment after a work date (company midnight), as a Date. */
export function endOfWorkDate(date, tz) {
  return localToUtc(addDays(date, 1), '00:00', tz).toDate();
}

/**
 * Where an entry ends for counting: its end, or `at` while it runs, never past the end of its work
 * date (a timer forgotten overnight counts up to midnight until the midnight job closes it).
 * @param {{ workDate: string, endedAt: Date | null }} entry
 * @param {Date | import('dayjs').Dayjs} at
 * @param {string} tz
 * @returns {Date}
 */
export function countedEnd(entry, at, tz) {
  if (entry.endedAt) return toDate(entry.endedAt);
  const dayEnd = endOfWorkDate(entry.workDate, tz);
  return ms(at) > ms(dayEnd) ? dayEnd : toDate(at);
}

/** Whole minutes of an entry (CONTRACT 15: minutesBetween(startedAt, endedAt ?? now)). */
export function entryMinutes(entry, at, tz) {
  return minutesBetween(entry.startedAt, countedEnd(entry, at ?? now(), tz));
}

/**
 * When a running entry stops at `at`: never before its start, never past the end of its work date.
 * @returns {Date}
 */
export function stopTime(entry, at, tz) {
  const start = ms(entry.startedAt);
  const dayEnd = ms(endOfWorkDate(entry.workDate, tz));
  return toDate(Math.min(Math.max(ms(at), start), Math.max(dayEnd, start)));
}

/** Same moment to the second. */
export function sameSecond(a, b) {
  return Math.floor(ms(a) / 1000) === Math.floor(ms(b) / 1000);
}

/** A moment as whole minutes since the epoch (seconds dropped), as people see clocks. */
export function minuteOf(value) {
  return Math.floor(ms(value) / 60_000);
}

/**
 * The first stretch that overlaps [start, end), or null. A stretch without an end (a running
 * timer, a break still on) lasts until `at`. Compared to the minute, as the 'HH:mm' clocks show
 * them: time from 10:30 fits after a timer that stopped at 10:30:20.
 * @template {{ startedAt: Date, endedAt?: Date | null }} T
 * @param {{ start: Date, end: Date }} span
 * @param {T[]} stretches
 * @param {Date | import('dayjs').Dayjs} at
 * @returns {T | null}
 */
export function firstOverlap({ start, end }, stretches, at) {
  const [from, to] = [minuteOf(start), minuteOf(end)];
  return (
    stretches.find(
      (item) => from < minuteOf(item.endedAt ?? at) && to > minuteOf(item.startedAt),
    ) ?? null
  );
}

/** The report task line an entry gives, with its de-duplication key, or null. */
function taskLine(entry) {
  const note = entry.note?.trim() || null;
  if (entry.projectTaskId) {
    return {
      key: `task:${entry.projectTaskId}`,
      task: {
        note: note ?? entry.projectTaskTitle ?? null,
        projectTaskId: entry.projectTaskId,
        priority: entry.priority ?? null,
        projectTaskTitle: entry.projectTaskTitle ?? null,
      },
    };
  }
  if (!note) return null;
  return {
    key: `note:${note.toLowerCase()}`,
    task: { note, projectTaskId: null, priority: null, projectTaskTitle: null },
  };
}

/**
 * A day's entries as the daily report's projects: minutes per project, biggest first, with task
 * lines de-duplicated by priority task, else by case-insensitive note. An entry with only a
 * priority task gives a line titled with the task. `roundedMinutes` (the minutes the report takes)
 * is the whole-minute total: no 15-minute rounding since the company asked for exact minutes, so
 * a 2h 5m timer fills 2h 5m.
 * @param {Array<{ projectId: number, projectName: string, projectColor: string,
 *   isUrgent: boolean, projectTaskId: number | null, priority: string | null,
 *   projectTaskTitle: string | null, note: string | null, minutes: number }>} entries oldest
 *   first
 * @returns {{ totalMinutes: number, projects: Array<{ projectId, projectName, projectColor,
 *   isUrgent, minutes, roundedMinutes, tasks: Array<{ note, projectTaskId, priority,
 *   projectTaskTitle }> }> }}
 */
export function summarizeDay(entries) {
  const byProject = new Map();
  const seen = new Set();
  let totalMinutes = 0;
  for (const entry of entries) {
    totalMinutes += entry.minutes;
    let project = byProject.get(entry.projectId);
    if (!project) {
      project = {
        projectId: entry.projectId,
        projectName: entry.projectName,
        projectColor: entry.projectColor,
        isUrgent: Boolean(entry.isUrgent),
        minutes: 0,
        roundedMinutes: 0,
        tasks: [],
      };
      byProject.set(entry.projectId, project);
    }
    project.minutes += entry.minutes;
    const line = taskLine(entry);
    const key = line && `${entry.projectId}|${line.key}`;
    if (line && !seen.has(key)) {
      seen.add(key);
      project.tasks.push(line.task);
    }
  }
  const projects = [...byProject.values()]
    .map((project) => ({ ...project, roundedMinutes: Math.round(project.minutes) }))
    .sort(
      (a, b) => b.minutes - a.minutes || String(a.projectName).localeCompare(String(b.projectName)),
    );
  return { totalMinutes, projects };
}
