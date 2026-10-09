// The timer clock shared by Today's Working on card and the sidebar chip (CONTRACT 15): the
// running-time format, clock skew between the browser and the server, live minutes, which state
// is newer, and the away question.
import { describe, expect, it } from 'vitest';
import {
  awayKey,
  awayQuestion,
  betterSkew,
  clockRange,
  createAwayAsks,
  elapsedSeconds,
  estimateSkew,
  formatElapsed,
  isNewerState,
  liveEntryMinutes,
  liveTotalMinutes,
} from '@/components/TimerChip.clock';

const ms = (iso) => Date.parse(iso);

describe('formatElapsed', () => {
  it('shows h:mm:ss from an hour', () => {
    expect(formatElapsed(5050)).toBe('1:24:10');
    expect(formatElapsed(3600)).toBe('1:00:00');
    expect(formatElapsed(36000 + 61)).toBe('10:01:01');
  });

  it('shows m:ss below an hour (the chip\'s "On break 12:03")', () => {
    expect(formatElapsed(723)).toBe('12:03');
    expect(formatElapsed(59)).toBe('0:59');
    expect(formatElapsed(0)).toBe('0:00');
  });

  it('never goes negative and drops fractions', () => {
    expect(formatElapsed(-20)).toBe('0:00');
    expect(formatElapsed(61.9)).toBe('1:01');
    expect(formatElapsed(undefined)).toBe('0:00');
  });
});

describe('estimateSkew', () => {
  it('takes the midpoint of the round trip, with half of it as the error', () => {
    // The browser is 5 s behind: it sent at 09:59:55.000 and got the answer 200 ms later; the
    // server read 10:00:00.100 in between.
    const sent = ms('2026-09-30T09:59:55.000Z');
    const skew = estimateSkew('2026-09-30T10:00:00.100Z', sent, sent + 200);
    expect(skew).toEqual({ skewMs: 5000, errorMs: 100 });
  });

  it('works when the browser is ahead of the server', () => {
    const sent = ms('2026-09-30T10:02:00.000Z');
    const skew = estimateSkew('2026-09-30T10:00:00.050Z', sent, sent + 100);
    expect(skew.skewMs).toBe(-120000);
  });

  it('has an unknown (infinite) error for a state rendered on the server', () => {
    const received = ms('2026-09-30T10:00:03.000Z');
    expect(estimateSkew('2026-09-30T10:00:00.000Z', null, received)).toEqual({
      skewMs: -3000,
      errorMs: Infinity,
    });
  });
});

describe('betterSkew', () => {
  const good = { skewMs: 5000, errorMs: 40 };
  const rendered = { skewMs: 2000, errorMs: Infinity };

  it('keeps the estimate with the smaller error', () => {
    expect(betterSkew(good, { skewMs: 9000, errorMs: 900 })).toBe(good);
    expect(betterSkew(rendered, good)).toBe(good);
    expect(betterSkew(good, rendered)).toBe(good);
  });

  it('takes a newer estimate that is about as good', () => {
    const newer = { skewMs: 5100, errorMs: 90 };
    expect(betterSkew(good, newer)).toBe(newer);
    expect(betterSkew(rendered, { skewMs: 1500, errorMs: Infinity }).skewMs).toBe(1500);
  });

  it('starts from the first estimate and ignores nothing', () => {
    expect(betterSkew(null, good)).toBe(good);
    expect(betterSkew(good, null)).toBe(good);
  });
});

describe('elapsed and live minutes', () => {
  const startedAt = '2026-09-30T08:00:00.000Z';

  it('counts whole seconds on the server clock', () => {
    expect(elapsedSeconds(startedAt, ms('2026-09-30T09:24:10.900Z'))).toBe(5050);
    expect(elapsedSeconds(startedAt, ms('2026-09-30T07:59:00.000Z'))).toBe(0);
    expect(elapsedSeconds(null, ms(startedAt))).toBe(0);
  });

  it('counts a running entry up and keeps a finished one', () => {
    const running = { minutes: 3, startedAt, endedAt: null };
    expect(liveEntryMinutes(running, ms('2026-09-30T08:45:59.000Z'))).toBe(45);
    expect(liveEntryMinutes(running, null)).toBe(3);
    const done = { minutes: 30, startedAt, endedAt: '2026-09-30T08:30:00.000Z' };
    expect(liveEntryMinutes(done, ms('2026-09-30T12:00:00.000Z'))).toBe(30);
  });

  it('moves "Tracked today" on with the running timer only', () => {
    // 2h finished + a timer that had 10 min when the server answered.
    const state = { totalMinutes: 130, running: { minutes: 10, startedAt, endedAt: null } };
    expect(liveTotalMinutes(state, ms('2026-09-30T08:25:30.000Z'))).toBe(145);
    expect(liveTotalMinutes(state, null)).toBe(130);
    expect(liveTotalMinutes({ totalMinutes: 90, running: null }, ms(startedAt))).toBe(90);
    expect(liveTotalMinutes(null, ms(startedAt))).toBe(0);
  });
});

describe('isNewerState', () => {
  const older = { serverNow: '2026-09-30T08:00:00.000Z' };
  const newer = { serverNow: '2026-09-30T08:00:01.000Z' };

  it('lets a later state replace an earlier one, never the other way round', () => {
    expect(isNewerState(newer, older)).toBe(true);
    expect(isNewerState(older, newer)).toBe(false);
    expect(isNewerState(older, { ...older })).toBe(true);
    expect(isNewerState(newer, null)).toBe(true);
    expect(isNewerState(null, older)).toBe(false);
  });
});

describe('the away question', () => {
  const away = {
    entryId: 12,
    from: '2026-09-30T07:40:00.000Z',
    to: '2026-09-30T08:12:00.000Z',
    minutes: 32,
    fromClock: '13:10',
    toClock: '13:42',
    projectName: 'acme-app',
  };

  it('reads as CONTRACT 15 writes it', () => {
    expect(awayQuestion(away)).toBe(
      'You were away 32 min (1:10–1:42 PM) while your acme-app timer ran. Keep this time or remove it?',
    );
  });

  it('names both halves of the day when the span crosses noon', () => {
    expect(clockRange('11:50', '12:20')).toBe('11:50 AM–12:20 PM');
    expect(clockRange('09:05', '09:40')).toBe('9:05–9:40 AM');
  });

  it('has one key per span', () => {
    expect(awayKey(away)).toBe('12|2026-09-30T07:40:00.000Z|2026-09-30T08:12:00.000Z');
    expect(awayKey({ ...away, to: '2026-09-30T08:20:00.000Z' })).not.toBe(awayKey(away));
    expect(awayKey(null)).toBeNull();
  });
});

describe('which away spans the chip asks about', () => {
  const span = (from, to) => ({
    entryId: 12,
    from: `2026-09-30T${from}:00.000Z`,
    to: `2026-09-30T${to}:00.000Z`,
    minutes: 30,
  });
  const a = span('07:40', '08:12');
  const b = span('08:20', '09:00');

  it('asks about each span once', () => {
    const asks = createAwayAsks();
    expect(asks.shouldAsk(a)).toBe(true);
    expect(asks.shouldAsk(a)).toBe(false);
    expect(asks.shouldAsk(null)).toBe(false);
  });

  it('asks about the next span that comes with an answer', () => {
    const asks = createAwayAsks();
    asks.shouldAsk(a);
    // Kept or removed: the answer's state offers the next span, which is new.
    expect(asks.shouldAsk(b)).toBe(true);
  });

  it('asks again about a span put away unanswered once the page is shown again', () => {
    const asks = createAwayAsks();
    asks.shouldAsk(a);
    asks.dismiss(a);
    // The poll keeps offering it (the server only offers the earliest unanswered span).
    expect(asks.shouldAsk(a)).toBe(false);
    asks.wake();
    expect(asks.shouldAsk(a)).toBe(true);
    // Answered this time: waking again doesn't bring it back.
    asks.wake();
    expect(asks.shouldAsk(a)).toBe(false);
  });

  it('asks again when an answer did not go through', () => {
    const asks = createAwayAsks();
    asks.shouldAsk(a);
    asks.retry(a);
    expect(asks.shouldAsk(a)).toBe(true);
  });
});
