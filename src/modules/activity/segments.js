// Screen-time rules that need no database (CONTRACT section 11): what one heartbeat does to a
// person's segments, and how segments add up to minutes. Pure functions, unit tested.
import { localToUtc, workDate } from '@/lib/time';

export const STATES = ['active', 'idle', 'locked'];
export const SOURCES = ['system', 'window'];

/** A segment keeps growing while reports arrive at most this far apart; longer gaps are "no data". */
export const CONTINUE_MS = 150_000;
/** Two reports this close together that disagree come from two devices: the busier state wins. */
export const SAME_MINUTE_MS = 60_000;

// active beats idle beats locked: someone working on one computer is working, whatever the other
// one says; an idle screen still says more than a locked one.
const RANK = { active: 3, idle: 2, locked: 1 };

const time = (value) => new Date(value).getTime();

/** A moment cut to whole seconds (DATETIME columns keep whole seconds on MySQL and MariaDB). */
export function wholeSecond(at) {
  return new Date(Math.floor(time(at) / 1000) * 1000);
}

/**
 * Decides what one heartbeat does. Rules (CONTRACT 11):
 * - same state and source as the latest segment, which ended at most 150 s ago on the same work
 *   date: extend it to `at` (never shorten it);
 * - the same, but the company date changed since: close the latest segment at company midnight and
 *   continue in a new segment from midnight (a segment never spans two work dates);
 * - a different state or source less than 60 s after the latest report, when the latest state is
 *   at least as busy (active > idle > locked): two devices disagree, so keep the latest segment
 *   and ignore this report (its end does not move, so one device going idle shows up within
 *   about a minute);
 * - anything else (no segment, a longer gap, a change of state): a new segment starting at `at`.
 *   Gaps are never filled in.
 * @param {{ latest: { id: number, workDate: string, state: string, source: string,
 *   startedAt: Date, endedAt: Date } | null | undefined, state: 'active' | 'idle' | 'locked',
 *   source: 'system' | 'window', at: Date, tz: string }} input  `at` is server time
 * @returns {{ action: 'extend', id: number, endedAt: Date }
 *   | { action: 'keep', id: number, state: string }
 *   | { action: 'insert', segment: { workDate: string, state: string, source: string,
 *       startedAt: Date, endedAt: Date }, close?: { id: number, endedAt: Date } }}
 */
export function planHeartbeat({ latest, state, source, at, tz }) {
  const date = workDate(tz, at);
  const now = new Date(at);
  const fresh = { workDate: date, state, source, startedAt: now, endedAt: now };
  if (!latest) return { action: 'insert', segment: fresh };

  // A latest end in the future (clock change, hand-made data) counts as "just now".
  const elapsed = Math.max(0, time(now) - time(latest.endedAt));
  if (elapsed > CONTINUE_MS) return { action: 'insert', segment: fresh };

  const same = latest.state === state && latest.source === source;
  if (latest.workDate !== date) {
    // A later work date than now only happens when the company time zone was changed: never move
    // that segment's end back to a midnight before its start, just start afresh.
    if (!same || latest.workDate > date) return { action: 'insert', segment: fresh };
    const midnight = localToUtc(date, '00:00', tz).toDate();
    return {
      action: 'insert',
      close: { id: latest.id, endedAt: midnight },
      segment: { ...fresh, startedAt: midnight },
    };
  }
  if (same) {
    const endedAt = time(latest.endedAt) > time(now) ? new Date(latest.endedAt) : now;
    return { action: 'extend', id: latest.id, endedAt };
  }
  if (elapsed < SAME_MINUTE_MS && RANK[latest.state] >= RANK[state]) {
    return { action: 'keep', id: latest.id, state: latest.state };
  }
  return { action: 'insert', segment: fresh };
}

/** Seconds -> whole minutes (nearest). */
export function minutesFromSeconds(seconds) {
  return Math.round(Math.max(0, Number(seconds) || 0) / 60);
}

/** Whole seconds a segment covers (0 when it is empty or reversed). */
export function segmentSeconds(segment) {
  return Math.max(0, Math.floor((time(segment.endedAt) - time(segment.startedAt)) / 1000));
}

/** The segment that ended last (the newest report), or null. */
export function latestSegment(segments) {
  let latest = null;
  for (const segment of segments) {
    if (!latest || time(segment.endedAt) >= time(latest.endedAt)) latest = segment;
  }
  return latest;
}

/**
 * Adds up one day of segments. Minutes are whole minutes from the summed segment durations per
 * state; time between segments is never counted.
 * @param {Array<{ state: string, source: string, startedAt: Date, endedAt: Date }>} segments
 * @returns {{ activeMinutes: number, idleMinutes: number, lockedMinutes: number,
 *   firstActiveAt: Date | null, lastActiveAt: Date | null, lastSeenAt: Date | null,
 *   source: 'system' | 'window' | null }} source: the source of the latest segment
 */
export function summarizeSegments(segments) {
  const seconds = { active: 0, idle: 0, locked: 0 };
  let firstActiveAt = null;
  let lastActiveAt = null;
  for (const segment of segments) {
    if (!(segment.state in seconds)) continue;
    seconds[segment.state] += segmentSeconds(segment);
    if (segment.state === 'active') {
      if (!firstActiveAt || time(segment.startedAt) < time(firstActiveAt)) {
        firstActiveAt = segment.startedAt;
      }
      if (!lastActiveAt || time(segment.endedAt) > time(lastActiveAt)) {
        lastActiveAt = segment.endedAt;
      }
    }
  }
  const latest = latestSegment(segments);
  return {
    activeMinutes: minutesFromSeconds(seconds.active),
    idleMinutes: minutesFromSeconds(seconds.idle),
    lockedMinutes: minutesFromSeconds(seconds.locked),
    firstActiveAt,
    lastActiveAt,
    lastSeenAt: latest?.endedAt ?? null,
    source: latest?.source ?? null,
  };
}

/**
 * What someone is doing right now, from their latest segment: its state while reports keep
 * coming (the last one at most 150 s ago, today), otherwise 'offline'.
 * @param {{ workDate: string, state: string, endedAt: Date } | null | undefined} latest
 * @param {{ at: Date, today: string }} now  server time and today's company date
 * @returns {'active' | 'idle' | 'locked' | 'offline'}
 */
export function currentStateOf(latest, { at, today }) {
  if (!latest || latest.workDate !== today) return 'offline';
  return time(at) - time(latest.endedAt) <= CONTINUE_MS ? latest.state : 'offline';
}
