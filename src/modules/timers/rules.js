// Pure timer rules (CONTRACT 15): entry minutes, away spans from screen time, overlaps, and the
// day summary that fills the daily report. No database access here; unit tested.
import { addDays, dayjs, localToUtc, minutesBetween, now, roundToQuarterHour } from '@/lib/time';

/** Idle or locked stretches at most this far apart are one away span (the heartbeat's gap). */
export const MERGE_GAP_MS = 150_000;

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

/**
 * Idle or locked for the whole computer. Window-only screen time (no Idle Detection) can't tell
 * being away from working in another app, so it never counts as away.
 */
function isAway(segment) {
  return segment.source === 'system' && (segment.state === 'idle' || segment.state === 'locked');
}

/**
 * Idle and locked screen-time segments (Idle Detection only, source 'system') as away spans:
 * segments that follow each other within 150 s are merged; an active segment, or a window-only
 * one, ends a span. A span has `ended` only when a later segment (any state) starts after it;
 * until then the person may still be away.
 * @param {Array<{ state: string, source: string, startedAt: Date, endedAt: Date }>} segments one
 *   work date
 * @returns {Array<{ from: Date, to: Date, ended: boolean }>} in time order
 */
export function awaySpans(segments) {
  const sorted = [...(segments ?? [])].sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
  const spans = [];
  let current = null;
  for (const segment of sorted) {
    const away = isAway(segment);
    const apart = current && ms(segment.startedAt) - ms(current.to) > MERGE_GAP_MS;
    if (current && (!away || apart)) {
      spans.push({ ...current, ended: true });
      current = null;
    }
    if (!away) continue;
    if (!current) {
      current = { from: toDate(segment.startedAt), to: toDate(segment.endedAt) };
    } else if (ms(segment.endedAt) > ms(current.to)) {
      current.to = toDate(segment.endedAt);
    }
  }
  if (current) spans.push({ ...current, ended: false });
  return spans;
}

/**
 * The away time to ask about for a running entry: the earliest ended span, clipped to
 * [max(startedAt, checkedUntil), at], that lasts at least `minMinutes`.
 * @param {{ segments: Array<{ state: string, startedAt: Date, endedAt: Date }>, startedAt: Date,
 *   checkedUntil?: Date | null, at: Date | import('dayjs').Dayjs, minMinutes: number }} input
 * @returns {{ from: Date, to: Date, minutes: number } | null}
 */
export function findAwaySpan({ segments, startedAt, checkedUntil, at, minMinutes }) {
  const lower = Math.max(ms(startedAt), checkedUntil ? ms(checkedUntil) : -Infinity);
  const upper = ms(at);
  for (const span of awaySpans(segments)) {
    if (!span.ended) continue;
    const from = Math.max(ms(span.from), lower);
    const to = Math.min(ms(span.to), upper);
    if (to <= from) continue;
    const minutes = minutesBetween(from, to);
    if (minutes >= minMinutes) return { from: toDate(from), to: toDate(to), minutes };
  }
  return null;
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
 * A day's entries as the daily report's projects: minutes per project (and rounded to the nearest
 * 15), biggest first, with task lines de-duplicated by priority task, else by case-insensitive
 * note. An entry with only a priority task gives a line titled with the task.
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
    .map((project) => ({ ...project, roundedMinutes: roundToQuarterHour(project.minutes) }))
    .sort(
      (a, b) => b.minutes - a.minutes || String(a.projectName).localeCompare(String(b.projectName)),
    );
  return { totalMinutes, projects };
}
