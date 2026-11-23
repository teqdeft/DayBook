// Away time (CONTRACT 25 A, replacing CONTRACT 15 "Away time"): idle or locked Idle Detection
// screen time, or a no-data gap during which someone else's screen time was recorded, of at
// least timerAwayMinutes inside one of today's timer entries is asked about once: "Keep, I was
// working" or "Remove, it was a break" (or "I had left" after the day end). One screen-time read
// per call; the answers are in awayAnswer.js, Put back in awayPutBack.js.
import { logger } from '@/lib/logger';
import { dayjs } from '@/lib/time';
import { activity } from '@/modules/activity';
import { attendance } from '@/modules/attendance';
import { findAwaySpan, leftOffer, noDataGaps } from './awayRules';
import { clockOf } from './shared';

const ms = (value) => dayjs(value).valueOf();

/** The stretch of an entry the question may cover, as ms: [max(start, checked), min(end, at)]. */
function windowOf(entry, at) {
  const from = Math.max(
    ms(entry.startedAt),
    entry.awayCheckedUntil ? ms(entry.awayCheckedUntil) : -Infinity,
  );
  return { from, to: Math.min(entry.endedAt ? ms(entry.endedAt) : ms(at), ms(at)) };
}

/**
 * Which no-data gaps count: those inside an entry's window during which someone else's screen
 * time was recorded more than 150 s from its edges (activity.anyoneSeenBetween, one query per such
 * gap). While Daybook is down nobody reports, so such a gap is never asked about.
 */
async function gapsSeen({ segments, windows, userId, workDate }) {
  const seen = new Set();
  for (const gap of noDataGaps(segments)) {
    if (!windows.some((window) => ms(gap.from) < window.to && ms(gap.to) > window.from)) continue;
    const found = await activity.anyoneSeenBetween({
      workDate,
      from: gap.from,
      to: gap.to,
      exceptUserId: userId,
    });
    if (found) seen.add(ms(gap.from));
  }
  return (gap) => seen.has(ms(gap.from));
}

/**
 * The first away span among some of the person's timer entries of one work date (oldest first:
 * one question at a time), or null (screen time off, nothing long enough that has ended).
 * @param {{ entries: object[], userId: number, workDate: string,
 *   settings: { activityTrackingEnabled: boolean, timerAwayMinutes: number,
 *   activityIdleMinutes: number }, at: Date | import('dayjs').Dayjs }} input entries: bare or
 *   joined time_entries rows, source 'timer'
 * @returns {Promise<{ entry: object, span: { from: Date, to: Date, minutes: number,
 *   kind: 'away' | 'no_data' } } | null>}
 */
export async function findAway({ entries, userId, workDate, settings, at }) {
  if (!settings.activityTrackingEnabled || entries.length === 0) return null;
  const { segments } = await activity.getDay(userId, workDate);
  const windows = entries.map((entry) => windowOf(entry, at));
  const gapCounts = await gapsSeen({ segments, windows, userId, workDate });
  for (const entry of entries) {
    const span = findAwaySpan({
      segments,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      checkedUntil: entry.awayCheckedUntil,
      at,
      minMinutes: settings.timerAwayMinutes,
      idleMinutes: settings.activityIdleMinutes,
      gapCounts,
    });
    if (span) return { entry, span };
  }
  return null;
}

/**
 * The "I had left" offer for a found span (CONTRACT 25 A), or null. Reads the person's day (its
 * day end) and today's breaks, only once a span was found.
 * @param {{ found: { entry: object, span: object }, entries: object[], user: object,
 *   ctx: { date: string, tz: string, row: object | null, settings: object } }} input entries:
 *   all of today's entries (manual too)
 * @returns {Promise<{ clock: string, shiftEndClock: string } | null>}
 */
export async function leftFor({ found, entries, user, ctx }) {
  if (!ctx.row) return null;
  const [day, breaks] = await Promise.all([
    attendance.getDay({ person: user, date: ctx.date }),
    attendance.listBreaks(user.id, ctx.date),
  ]);
  return leftOffer({
    from: found.span.from,
    to: found.span.to,
    entry: found.entry,
    entries,
    breaks,
    row: ctx.row,
    dayEnd: day?.dayEnd ?? null,
    graceMinutes: ctx.settings.leftEarlyGraceMinutes,
    date: ctx.date,
    tz: ctx.tz,
  });
}

/**
 * The state's `away`: { entryId, from, to, minutes, fromClock, toClock, projectName, kind,
 * running, left } (ISO times, 'HH:mm' clocks).
 */
export function awayView({ entry, span }, { tz, left, projectName }) {
  return {
    entryId: Number(entry.id),
    from: dayjs(span.from).toISOString(),
    to: dayjs(span.to).toISOString(),
    minutes: span.minutes,
    fromClock: clockOf(span.from, tz),
    toClock: clockOf(span.to, tz),
    projectName: projectName ?? entry.projectName ?? null,
    kind: span.kind,
    running: !entry.endedAt,
    left: left ?? null,
  };
}

/**
 * The away question for the state: the first span of today's timer entries with its Left offer.
 * A failure only logs a warning (the state never fails because of screen time).
 * @param {{ user: object, ctx: object, entries: object[], candidates: object[],
 *   at: import('dayjs').Dayjs }} input candidates: the entries that may be asked about
 * @returns {Promise<object | null>} see awayView
 */
export async function awayForState({ user, ctx, entries, candidates, at }) {
  try {
    const found = await findAway({
      entries: candidates,
      userId: user.id,
      workDate: ctx.date,
      settings: ctx.settings,
      at,
    });
    if (!found) return null;
    const left = await leftFor({ found, entries, user, ctx });
    return awayView(found, { tz: ctx.tz, left });
  } catch (error) {
    logger.warn({ err: error, userId: user.id }, 'away time could not be worked out');
    return null;
  }
}
