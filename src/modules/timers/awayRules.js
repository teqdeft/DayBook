// Pure away-time rules (CONTRACT 25 A): away spans from screen time (idle or locked Idle
// Detection segments and no-data gaps), the span to ask about for one entry, what a Remove does
// to the entry and which time it loses, the "I had left" offer, and how Put back restores the
// timer. No database access here; unit tested. rules.js re-exports awaySpans and findAwaySpan.
import { dayjs, localToUtc, minutesBetween, toLocal } from '@/lib/time';

/** Pieces at most this far apart are one away span (the heartbeat's gap, CONTINUE_MS). */
export const MERGE_GAP_MS = 150_000;

const ms = (value) => dayjs(value).valueOf();
const toDate = (value) => dayjs(value).toDate();
const toSecond = (value) => Math.floor(ms(value) / 1000);
const second = (value) => dayjs(value).startOf('second').toDate();

const isSystem = (segment) => segment.source === 'system';

/**
 * Idle or locked for the whole computer. Window-only screen time (no Idle Detection) can't tell
 * being away from working in another app, so it never counts as away.
 */
const isAway = (segment) =>
  isSystem(segment) && (segment.state === 'idle' || segment.state === 'locked');

const sorted = (segments) =>
  [...(segments ?? [])].sort((a, b) => ms(a.startedAt) - ms(b.startedAt));

/**
 * No-data gaps of one work date: more than 150 s between the end of a screen-time segment and
 * the start of the next, both from Idle Detection (source 'system'; laptop asleep, browser
 * closed). A gap next to a window-only segment never counts, nor the time before the first
 * segment or after the last.
 * @param {Array<{ state: string, source: string, startedAt: Date, endedAt: Date }>} segments
 * @returns {Array<{ from: Date, to: Date }>} in time order
 */
export function noDataGaps(segments) {
  const list = sorted(segments);
  const gaps = [];
  for (let index = 1; index < list.length; index += 1) {
    const [before, after] = [list[index - 1], list[index]];
    if (!isSystem(before) || !isSystem(after)) continue;
    if (ms(after.startedAt) - ms(before.endedAt) > MERGE_GAP_MS) {
      gaps.push({ from: toDate(before.endedAt), to: toDate(after.startedAt) });
    }
  }
  return gaps;
}

/**
 * Away spans of one work date's segments, in time order. Pieces are idle or locked Idle
 * Detection segments and the no-data gaps between two of its segments (those `gapCounts`
 * accepts: the state accepts only gaps during which someone else's screen time was recorded);
 * pieces within 150 s merge, and an active or window-only segment ends a span. A span has
 * `ended` once a later segment (any state) starts after it; until then the person may still be
 * away. `kind` is 'away' with at least one idle or locked piece, else 'no_data'; `startsIdle`
 * when its first piece is an idle segment.
 * @param {Array<{ state: string, source: string, startedAt: Date, endedAt: Date }>} segments
 * @param {{ gapCounts?: (gap: { from: Date, to: Date }) => boolean }} [options] default: every
 *   gap counts
 * @returns {Array<{ from: Date, to: Date, ended: boolean, kind: 'away' | 'no_data',
 *   startsIdle: boolean }>}
 */
export function awaySpans(segments, { gapCounts = () => true } = {}) {
  const spans = [];
  let current = null;
  let previous = null;
  const close = (ended) => {
    if (current) spans.push({ ...current, ended });
    current = null;
  };
  const add = (from, to, piece) => {
    if (current && ms(from) - ms(current.to) > MERGE_GAP_MS) close(true);
    if (!current) {
      const kind = piece === 'gap' ? 'no_data' : 'away';
      current = { from: toDate(from), to: toDate(to), kind, startsIdle: piece === 'idle' };
      return;
    }
    if (ms(to) > ms(current.to)) current.to = toDate(to);
    if (piece !== 'gap') current.kind = 'away';
  };
  for (const segment of sorted(segments)) {
    const gapFrom = previous && ms(previous.endedAt);
    if (previous && isSystem(previous) && isSystem(segment)) {
      const gap = { from: toDate(gapFrom), to: toDate(segment.startedAt) };
      if (ms(gap.to) - gapFrom > MERGE_GAP_MS && gapCounts(gap)) add(gap.from, gap.to, 'gap');
    }
    if (isAway(segment)) add(segment.startedAt, segment.endedAt, segment.state);
    else close(true);
    previous = segment;
  }
  close(false);
  return spans;
}

/**
 * The away time to ask about for one timer entry: the first ended span that overlaps the entry's
 * window [max(startedAt, checkedUntil), min(endedAt ?? at, at)], clipped to it. Idle Detection
 * says "idle" only `idleMinutes` after the last input, so a span that starts idle starts that
 * much earlier (never before the window's start); a locked or no-data start doesn't move. The
 * moved span must last at least `minMinutes`.
 * @param {{ segments: object[], startedAt: Date, endedAt?: Date | null,
 *   checkedUntil?: Date | null, at: Date | import('dayjs').Dayjs, minMinutes: number,
 *   idleMinutes?: number, gapCounts?: (gap: object) => boolean }} input
 * @returns {{ from: Date, to: Date, minutes: number, kind: 'away' | 'no_data' } | null}
 */
export function findAwaySpan({
  segments,
  startedAt,
  endedAt = null,
  checkedUntil = null,
  at,
  minMinutes,
  idleMinutes = 0,
  gapCounts,
}) {
  const lower = Math.max(ms(startedAt), checkedUntil ? ms(checkedUntil) : -Infinity);
  const upper = Math.min(endedAt ? ms(endedAt) : ms(at), ms(at));
  for (const span of awaySpans(segments, { gapCounts })) {
    if (!span.ended) continue;
    const start = span.startsIdle
      ? ms(span.from) - (Number(idleMinutes) || 0) * 60_000
      : ms(span.from);
    const from = Math.max(start, lower);
    const to = Math.min(ms(span.to), upper);
    if (to <= from) continue;
    const minutes = minutesBetween(from, to);
    if (minutes >= minMinutes)
      return { from: toDate(from), to: toDate(to), minutes, kind: span.kind };
  }
  return null;
}

/**
 * What "Remove, it was a break" does to an entry, and the time the timer loses (saved as the away
 * break, whole seconds). The head is kept when it has at least 1 minute before `from`; the tail
 * when the entry runs, or has at least 1 minute after `to`.
 * - split (head and tail): the entry ends at `from`, a copy runs from `to`; loses [from, to]
 * - move (no head): the entry starts at `to`; loses [startedAt, to]
 * - trim (finished, no tail): the entry ends at `from`; loses [from, endedAt]
 * - drop (finished, nothing left): the entry goes; loses [startedAt, endedAt]
 * @param {{ entry: { startedAt: Date, endedAt: Date | null }, from: Date, to: Date }} input
 * @returns {{ kind: 'split' | 'move' | 'trim' | 'drop', lost: { from: Date, to: Date } }}
 */
export function planRemoval({ entry, from, to }) {
  const head = minutesBetween(entry.startedAt, from) >= 1;
  const tail = !entry.endedAt || minutesBetween(to, entry.endedAt) >= 1;
  const [start, end] = [second(entry.startedAt), entry.endedAt ? second(entry.endedAt) : null];
  if (head && tail) return { kind: 'split', lost: { from: second(from), to: second(to) } };
  if (tail) return { kind: 'move', lost: { from: start, to: second(to) } };
  if (head) return { kind: 'trim', lost: { from: second(from), to: end } };
  return { kind: 'drop', lost: { from: start, to: end } };
}

const byStart = (a, b) => ms(a.startedAt) - ms(b.startedAt) || Number(a.id) - Number(b.id);

/**
 * "I had left, check me out at 6:42 PM" instead of Remove, when all hold: the span starts at or
 * after the day end less the left early grace; its entry is the person's latest of today (by
 * start); no break of the day starts at or after `from`; today's row is open, or closed by the
 * person's own check-out at or after `to`.
 * @param {{ from: Date, to: Date, entry: { id: number }, entries: object[], breaks: object[],
 *   row: object | null, dayEnd: string | null, graceMinutes: number, date: string,
 *   tz: string }} input dayEnd: 'HH:mm' (PersonDay.dayEnd)
 * @returns {{ clock: string, shiftEndClock: string } | null} 'HH:mm' clocks
 */
export function leftOffer({
  from,
  to,
  entry,
  entries,
  breaks,
  row,
  dayEnd,
  graceMinutes,
  date,
  tz,
}) {
  if (!row || !dayEnd) return null;
  const grace = Number(graceMinutes) || 0;
  const offeredFrom = localToUtc(date, dayEnd, tz).subtract(grace, 'minute');
  if (ms(from) < offeredFrom.valueOf()) return null;
  const latest = [...(entries ?? [])].sort(byStart).at(-1);
  if (!latest || Number(latest.id) !== Number(entry.id)) return null;
  if ((breaks ?? []).some((item) => ms(item.startedAt) >= ms(from))) return null;
  const open = !row.checkOutAt && row.checkoutStatus === 'open';
  const ownLater =
    row.checkoutStatus === 'checked_out' && row.checkOutAt && ms(row.checkOutAt) >= ms(to);
  if (!open && !ownLater) return null;
  return { clock: toLocal(from, tz).format('HH:mm'), shiftEndClock: dayEnd };
}

/** True when [a, b) of two stretches share a second; an open one lasts until `at`. */
function overlapsSpan(entry, span, at) {
  const end = entry.endedAt ?? at;
  return toSecond(entry.startedAt) < toSecond(span.to) && toSecond(span.from) < toSecond(end);
}

/**
 * How Put back restores the timer for an away break: E = the break's entry (away_entry_id).
 * - E ends at the break's start (split or trim): the entry of E's project starting at the break's
 *   end (the tail) starts at the break's start instead; with no tail, E ends at the break's end
 *   again (away_checked_until = the end);
 * - E starts at the break's end (move): E starts at the break's start again;
 * - otherwise (E gone or changed by hand), or when another entry overlaps the break: nothing.
 * @param {{ item: { startedAt: Date, endedAt: Date, awayEntryId: number | null },
 *   entries: object[], at: Date | import('dayjs').Dayjs }} input entries: the day's, bare
 * @returns {{ entryId: number, changes: object } | null} null: the timer is not changed
 */
export function putBackPlan({ item, entries, at }) {
  const own = (entries ?? []).find((entry) => Number(entry.id) === Number(item.awayEntryId));
  if (!own) return null;
  const [start, end] = [toSecond(item.startedAt), toSecond(item.endedAt)];
  let plan = null;
  let kept = [Number(own.id)];
  if (own.endedAt && toSecond(own.endedAt) === start) {
    const tail = entries.find(
      (entry) =>
        Number(entry.id) !== Number(own.id) &&
        Number(entry.projectId) === Number(own.projectId) &&
        toSecond(entry.startedAt) === end,
    );
    if (tail) kept = [...kept, Number(tail.id)];
    plan = tail
      ? { entryId: Number(tail.id), changes: { startedAt: second(item.startedAt) } }
      : {
          entryId: Number(own.id),
          changes: { endedAt: second(item.endedAt), awayCheckedUntil: second(item.endedAt) },
        };
  } else if (toSecond(own.startedAt) === end) {
    plan = { entryId: Number(own.id), changes: { startedAt: second(item.startedAt) } };
  }
  if (!plan) return null;
  const span = { from: item.startedAt, to: item.endedAt };
  const clash = entries.some(
    (entry) => !kept.includes(Number(entry.id)) && overlapsSpan(entry, span, at),
  );
  return clash ? null : plan;
}
