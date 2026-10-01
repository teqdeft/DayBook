// The pure screen-time rules: what a heartbeat does to the latest segment, and how segments add up.
import { describe, expect, it } from 'vitest';
import {
  currentStateOf,
  latestSegment,
  minutesFromSeconds,
  planHeartbeat,
  segmentSeconds,
  summarizeSegments,
  wholeSecond,
} from '@/modules/activity/segments';

const TZ = 'Asia/Kolkata';
const at = (iso) => new Date(iso);
const secondsAfter = (iso, seconds) => new Date(new Date(iso).getTime() + seconds * 1000);

// 10:00 IST on Wed 30 Sep 2026
const T0 = '2026-09-30T04:30:00.000Z';
const latest = (overrides = {}) => ({
  id: 7,
  workDate: '2026-09-30',
  state: 'active',
  source: 'system',
  startedAt: at('2026-09-30T04:00:00.000Z'),
  endedAt: at(T0),
  ...overrides,
});

describe('planHeartbeat', () => {
  it('starts the first segment at the server time, on the company date', () => {
    const plan = planHeartbeat({
      latest: null,
      state: 'active',
      source: 'system',
      at: at(T0),
      tz: TZ,
    });
    expect(plan).toEqual({
      action: 'insert',
      segment: {
        workDate: '2026-09-30',
        state: 'active',
        source: 'system',
        startedAt: at(T0),
        endedAt: at(T0),
      },
    });
  });

  it('extends the latest segment with the same state and source up to 150 s later', () => {
    for (const seconds of [1, 60, 149, 150]) {
      const now = secondsAfter(T0, seconds);
      const plan = planHeartbeat({
        latest: latest(),
        state: 'active',
        source: 'system',
        at: now,
        tz: TZ,
      });
      expect(plan).toEqual({ action: 'extend', id: 7, endedAt: now });
    }
  });

  it('starts a new segment after a gap longer than 150 s (the gap is not filled)', () => {
    const now = secondsAfter(T0, 151);
    const plan = planHeartbeat({
      latest: latest(),
      state: 'active',
      source: 'system',
      at: now,
      tz: TZ,
    });
    expect(plan.action).toBe('insert');
    expect(plan.close).toBeUndefined();
    expect(plan.segment.startedAt).toEqual(now);
  });

  it('starts a new segment when the state changes a minute or more after the last report', () => {
    const now = secondsAfter(T0, 60);
    const plan = planHeartbeat({
      latest: latest(),
      state: 'idle',
      source: 'system',
      at: now,
      tz: TZ,
    });
    expect(plan).toMatchObject({ action: 'insert', segment: { state: 'idle', startedAt: now } });
  });

  it('starts a new segment when only the source changes a minute or more later', () => {
    const now = secondsAfter(T0, 90);
    const plan = planHeartbeat({
      latest: latest(),
      state: 'active',
      source: 'window',
      at: now,
      tz: TZ,
    });
    expect(plan).toMatchObject({ action: 'insert', segment: { source: 'window' } });
  });

  it('keeps an active segment when another device says idle or locked within the minute', () => {
    for (const state of ['idle', 'locked']) {
      const plan = planHeartbeat({
        latest: latest(),
        state,
        source: 'system',
        at: secondsAfter(T0, 59),
        tz: TZ,
      });
      expect(plan).toEqual({ action: 'keep', id: 7, state: 'active' });
    }
  });

  it('lets active win over a recent idle or locked segment', () => {
    for (const state of ['idle', 'locked']) {
      const plan = planHeartbeat({
        latest: latest({ state }),
        state: 'active',
        source: 'system',
        at: secondsAfter(T0, 10),
        tz: TZ,
      });
      expect(plan).toMatchObject({ action: 'insert', segment: { state: 'active' } });
    }
  });

  it('prefers idle over locked within the minute, and keeps the first source', () => {
    expect(
      planHeartbeat({
        latest: latest({ state: 'idle' }),
        state: 'locked',
        source: 'system',
        at: secondsAfter(T0, 20),
        tz: TZ,
      }),
    ).toEqual({ action: 'keep', id: 7, state: 'idle' });
    expect(
      planHeartbeat({
        latest: latest(),
        state: 'active',
        source: 'window',
        at: secondsAfter(T0, 20),
        tz: TZ,
      }),
    ).toEqual({ action: 'keep', id: 7, state: 'active' });
  });

  it('splits a continuing segment at company midnight', () => {
    // 23:59:30 IST on 30 Sep, then 00:00:40 IST on 1 Oct (midnight IST = 18:30 UTC)
    const before = latest({ endedAt: at('2026-09-30T18:29:30.000Z') });
    const now = at('2026-09-30T18:30:40.000Z');
    const plan = planHeartbeat({
      latest: before,
      state: 'active',
      source: 'system',
      at: now,
      tz: TZ,
    });
    expect(plan).toEqual({
      action: 'insert',
      close: { id: 7, endedAt: at('2026-09-30T18:30:00.000Z') },
      segment: {
        workDate: '2026-10-01',
        state: 'active',
        source: 'system',
        startedAt: at('2026-09-30T18:30:00.000Z'),
        endedAt: now,
      },
    });
  });

  it('starts a plain new segment after midnight when the state changed', () => {
    const before = latest({ endedAt: at('2026-09-30T18:29:50.000Z') });
    const now = at('2026-09-30T18:30:10.000Z');
    const plan = planHeartbeat({
      latest: before,
      state: 'idle',
      source: 'system',
      at: now,
      tz: TZ,
    });
    expect(plan).toMatchObject({
      action: 'insert',
      segment: { workDate: '2026-10-01', state: 'idle', startedAt: now },
    });
    expect(plan.close).toBeUndefined();
  });

  it('starts afresh when the latest segment has a later work date (time zone changed)', () => {
    // Recorded at 00:10 IST on 1 Oct; 30 s later it is still 30 Sep in New York. Never close the
    // segment at a midnight before its start.
    const before = latest({
      workDate: '2026-10-01',
      startedAt: at('2026-09-30T18:40:00.000Z'),
      endedAt: at('2026-09-30T18:40:00.000Z'),
    });
    const now = at('2026-09-30T18:40:30.000Z');
    const plan = planHeartbeat({
      latest: before,
      state: 'active',
      source: 'system',
      at: now,
      tz: 'America/New_York',
    });
    expect(plan).toMatchObject({
      action: 'insert',
      segment: { workDate: '2026-09-30', startedAt: now },
    });
    expect(plan.close).toBeUndefined();
  });

  it('never moves the end of a segment backwards', () => {
    const ahead = latest({ endedAt: secondsAfter(T0, 300) });
    const plan = planHeartbeat({
      latest: ahead,
      state: 'active',
      source: 'system',
      at: at(T0),
      tz: TZ,
    });
    expect(plan).toEqual({ action: 'extend', id: 7, endedAt: secondsAfter(T0, 300) });
  });
});

describe('summarizeSegments', () => {
  const segment = (state, from, to, source = 'system') => ({
    state,
    source,
    startedAt: at(`2026-09-30T${from}.000Z`),
    endedAt: at(`2026-09-30T${to}.000Z`),
  });

  it('adds whole minutes per state and never counts the gaps between segments', () => {
    const summary = summarizeSegments([
      segment('active', '04:00:00', '04:30:00'),
      segment('idle', '04:30:00', '04:42:00'),
      // 04:42 - 05:00 is a gap (no data)
      segment('active', '05:00:00', '05:45:30'),
      segment('locked', '05:45:30', '06:30:00', 'window'),
    ]);
    expect(summary).toEqual({
      activeMinutes: 76, // 30 + 45.5, rounded
      idleMinutes: 12,
      lockedMinutes: 45, // 44.5, rounded
      firstActiveAt: at('2026-09-30T04:00:00.000Z'),
      lastActiveAt: at('2026-09-30T05:45:30.000Z'),
      lastSeenAt: at('2026-09-30T06:30:00.000Z'),
      source: 'window',
    });
  });

  it('is all zeros and nulls without segments', () => {
    expect(summarizeSegments([])).toEqual({
      activeMinutes: 0,
      idleMinutes: 0,
      lockedMinutes: 0,
      firstActiveAt: null,
      lastActiveAt: null,
      lastSeenAt: null,
      source: null,
    });
  });

  it('picks the segment that ended last as the latest', () => {
    const a = segment('active', '04:00:00', '05:00:00');
    const b = segment('idle', '05:00:00', '05:10:00');
    expect(latestSegment([b, a])).toBe(b);
    expect(latestSegment([])).toBeNull();
  });
});

describe('helpers', () => {
  it('rounds seconds to whole minutes and never goes negative', () => {
    expect(minutesFromSeconds(89)).toBe(1);
    expect(minutesFromSeconds(90)).toBe(2);
    expect(minutesFromSeconds(-30)).toBe(0);
    expect(minutesFromSeconds(null)).toBe(0);
  });

  it('measures a segment in whole seconds, 0 when reversed', () => {
    expect(segmentSeconds({ startedAt: at(T0), endedAt: secondsAfter(T0, 61.9) })).toBe(61);
    expect(segmentSeconds({ startedAt: secondsAfter(T0, 5), endedAt: at(T0) })).toBe(0);
  });

  it('cuts a moment to whole seconds', () => {
    expect(wholeSecond(at('2026-09-30T04:30:00.987Z'))).toEqual(at('2026-09-30T04:30:00.000Z'));
  });

  it('is offline when the last report is older than 150 s or from another day', () => {
    const last = { workDate: '2026-09-30', state: 'idle', endedAt: at(T0) };
    const today = '2026-09-30';
    expect(currentStateOf(last, { at: secondsAfter(T0, 150), today })).toBe('idle');
    expect(currentStateOf(last, { at: secondsAfter(T0, 151), today })).toBe('offline');
    expect(currentStateOf(last, { at: secondsAfter(T0, 10), today: '2026-10-01' })).toBe('offline');
    expect(currentStateOf(null, { at: at(T0), today })).toBe('offline');
  });
});
