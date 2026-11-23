// Pure away-time rules (CONTRACT 25 A): no-data gaps, away spans and their kind, the idle
// accuracy rule, what a Remove does and the time it loses, the "I had left" offer and Put back.
import { describe, expect, it } from 'vitest';
import { localToUtc } from '@/lib/time';
import {
  awaySpans,
  findAwaySpan,
  leftOffer,
  noDataGaps,
  planRemoval,
  putBackPlan,
} from '@/modules/timers/awayRules';

const TZ = 'Asia/Kolkata';
const DAY = '2026-11-19';
const at = (clock) =>
  localToUtc(DAY, clock.slice(0, 5), TZ)
    .add(Number(clock.slice(6)) || 0, 's')
    .toDate();
const seg = (state, from, to, source = 'system') => ({
  state,
  source,
  startedAt: at(from),
  endedAt: at(to),
});

describe('no-data gaps', () => {
  it('a system gap over 150 s is a piece, 150 s or less is not', () => {
    const segments = [
      seg('active', '10:00', '10:30'),
      seg('active', '10:32:30', '10:40'), // 150 s: not a gap
      seg('active', '10:42:31', '11:00'), // 151 s: a gap
    ];
    expect(noDataGaps(segments)).toEqual([{ from: at('10:40'), to: at('10:42:31') }]);
  });

  it('a gap next to a window segment never counts, nor before the first or after the last', () => {
    const segments = [
      seg('active', '10:00', '10:30', 'window'),
      seg('active', '11:00', '11:10'),
      seg('active', '11:40', '11:50', 'window'),
    ];
    expect(noDataGaps(segments)).toEqual([]);
  });
});

describe('away spans', () => {
  it('merges a gap with idle and locked neighbours into one span (kind away)', () => {
    const spans = awaySpans([
      seg('active', '10:00', '10:30'),
      seg('idle', '10:30', '10:35'),
      seg('locked', '11:20', '11:30'),
      seg('active', '11:31', '11:40'),
    ]);
    expect(spans).toEqual([
      { from: at('10:30'), to: at('11:30'), ended: true, kind: 'away', startsIdle: true },
    ]);
  });

  it('a gap alone is no_data; it counts only when gapCounts says so', () => {
    const segments = [seg('active', '10:00', '10:30'), seg('active', '11:10', '11:20')];
    expect(awaySpans(segments)).toEqual([
      { from: at('10:30'), to: at('11:10'), ended: true, kind: 'no_data', startsIdle: false },
    ]);
    expect(awaySpans(segments, { gapCounts: () => false })).toEqual([]);
  });

  it('has ended only once a later segment starts after it', () => {
    expect(awaySpans([seg('active', '10:00', '10:30'), seg('locked', '10:30', '11:00')])).toEqual([
      { from: at('10:30'), to: at('11:00'), ended: false, kind: 'away', startsIdle: false },
    ]);
  });
});

describe('findAwaySpan', () => {
  const input = (segments, extra = {}) => ({
    segments,
    startedAt: at('09:30'),
    at: at('12:00'),
    minMinutes: 25,
    idleMinutes: 5,
    ...extra,
  });

  it('moves an idle start back by the idle minutes (21 min idle + 5 asks at 25)', () => {
    const segments = [
      seg('active', '09:30', '10:05'),
      seg('idle', '10:05', '10:26'),
      seg('active', '10:27', '11:00'),
    ];
    expect(findAwaySpan(input(segments))).toEqual({
      from: at('10:00'),
      to: at('10:26'),
      minutes: 26,
      kind: 'away',
    });
    expect(findAwaySpan(input(segments, { idleMinutes: 0 }))).toBeNull();
  });

  it('never before the entry start or the answered part; never for locked or gap starts', () => {
    const idle = [seg('idle', '10:02', '10:40'), seg('active', '10:41', '11:00')];
    expect(findAwaySpan(input(idle, { startedAt: at('10:00') })).from).toEqual(at('10:00'));
    const answered = input(idle, { checkedUntil: at('10:01') });
    expect(findAwaySpan(answered).from).toEqual(at('10:01'));
    const locked = [seg('locked', '10:02', '10:40'), seg('active', '10:41', '11:00')];
    expect(findAwaySpan(input(locked)).from).toEqual(at('10:02'));
    const gap = [seg('active', '09:30', '10:02'), seg('active', '10:40', '11:00')];
    expect(findAwaySpan(input(gap))).toMatchObject({ from: at('10:02'), kind: 'no_data' });
  });

  it("a finished entry's window ends at its end", () => {
    const segments = [seg('locked', '10:00', '10:50'), seg('active', '10:51', '11:00')];
    const span = findAwaySpan(input(segments, { endedAt: at('10:40') }));
    expect(span).toEqual({ from: at('10:00'), to: at('10:40'), minutes: 40, kind: 'away' });
    expect(findAwaySpan(input(segments, { endedAt: at('10:20') }))).toBeNull();
  });
});

describe('planRemoval and the time each change loses', () => {
  const entry = { startedAt: at('10:00'), endedAt: at('12:00') };

  it('split keeps the head and the tail and loses [from, to]', () => {
    expect(planRemoval({ entry, from: at('10:01'), to: at('11:59') })).toEqual({
      kind: 'split',
      lost: { from: at('10:01'), to: at('11:59') },
    });
  });

  it('move (head under a minute) loses [startedAt, to]', () => {
    expect(planRemoval({ entry, from: at('10:00:59'), to: at('11:00') })).toEqual({
      kind: 'move',
      lost: { from: at('10:00'), to: at('11:00') },
    });
    const running = { startedAt: at('10:00'), endedAt: null };
    expect(planRemoval({ entry: running, from: at('10:00'), to: at('11:59:30') }).kind).toBe(
      'move',
    );
  });

  it('trim (tail under a minute) loses [from, endedAt]', () => {
    expect(planRemoval({ entry, from: at('11:00'), to: at('11:59:01') })).toEqual({
      kind: 'trim',
      lost: { from: at('11:00'), to: at('12:00') },
    });
  });

  it('drop (nothing left) loses the whole entry', () => {
    expect(planRemoval({ entry, from: at('10:00:30'), to: at('11:59:30') })).toEqual({
      kind: 'drop',
      lost: { from: at('10:00'), to: at('12:00') },
    });
  });
});

describe('leftOffer', () => {
  const entry = { id: 1, startedAt: at('09:30') };
  const base = {
    from: at('18:42'),
    to: at('20:52'),
    entry,
    entries: [entry],
    breaks: [{ startedAt: at('13:00') }],
    row: { checkOutAt: null, checkoutStatus: 'open' },
    dayEnd: '18:30',
    graceMinutes: 15,
    date: DAY,
    tz: TZ,
  };

  it('offers from the day end less the grace: 6:28 PM yes, 6:14 PM no', () => {
    expect(leftOffer(base)).toEqual({ clock: '18:42', shiftEndClock: '18:30' });
    expect(leftOffer({ ...base, from: at('18:30') })).toMatchObject({ clock: '18:30' });
    expect(leftOffer({ ...base, from: at('18:28') })).toMatchObject({ clock: '18:28' });
    expect(leftOffer({ ...base, from: at('18:14') })).toBeNull();
  });

  it("follows the person's own day end: a later shift end, or the split on second-half leave", () => {
    expect(leftOffer({ ...base, dayEnd: '19:00' })).toBeNull();
    expect(leftOffer({ ...base, from: at('14:10'), dayEnd: '14:00' })).toEqual({
      clock: '14:10',
      shiftEndClock: '14:00',
    });
  });

  it('not with a later entry, a later break or a row someone else closed', () => {
    const later = { id: 2, startedAt: at('20:53') };
    expect(leftOffer({ ...base, entries: [entry, later] })).toBeNull();
    expect(leftOffer({ ...base, breaks: [{ startedAt: at('19:00') }] })).toBeNull();
    const corrected = { checkOutAt: at('21:00'), checkoutStatus: 'corrected' };
    expect(leftOffer({ ...base, row: corrected })).toBeNull();
    const own = { checkOutAt: at('20:55'), checkoutStatus: 'checked_out' };
    expect(leftOffer({ ...base, row: own })).not.toBeNull();
    expect(leftOffer({ ...base, row: { ...own, checkOutAt: at('20:50') } })).toBeNull();
  });
});

describe('putBackPlan', () => {
  const item = { startedAt: at('13:00'), endedAt: at('13:45'), awayEntryId: 1 };
  const head = { id: 1, projectId: 7, startedAt: at('09:30'), endedAt: at('13:00') };
  const now = at('15:00');

  it('split: the tail starts at the break start again', () => {
    const tail = { id: 2, projectId: 7, startedAt: at('13:45'), endedAt: null };
    expect(putBackPlan({ item, entries: [head, tail], at: now })).toEqual({
      entryId: 2,
      changes: { startedAt: at('13:00') },
    });
  });

  it('trim (no tail): the entry ends at the break end again', () => {
    expect(putBackPlan({ item, entries: [head], at: now })).toEqual({
      entryId: 1,
      changes: { endedAt: at('13:45'), awayCheckedUntil: at('13:45') },
    });
  });

  it('move: the entry starts at the break start again', () => {
    const moved = { id: 1, projectId: 7, startedAt: at('13:45'), endedAt: null };
    expect(putBackPlan({ item, entries: [moved], at: now })).toEqual({
      entryId: 1,
      changes: { startedAt: at('13:00') },
    });
  });

  it('nothing when the entry is gone, changed by hand, or another entry overlaps', () => {
    expect(putBackPlan({ item, entries: [], at: now })).toBeNull();
    const edited = { ...head, endedAt: at('12:50') };
    expect(putBackPlan({ item, entries: [edited], at: now })).toBeNull();
    const manual = { id: 3, projectId: 8, startedAt: at('13:10'), endedAt: at('13:20') };
    expect(putBackPlan({ item, entries: [head, manual], at: now })).toBeNull();
  });
});
