// Pure timer rules (CONTRACT 15): entry minutes, stop times, away spans, overlaps, the day summary
// and the input schemas.
import { describe, expect, it } from 'vitest';
import { localToUtc, roundToQuarterHour } from '@/lib/time';
import {
  awaySpans,
  countedEnd,
  entryMinutes,
  findAwaySpan,
  firstOverlap,
  sameSecond,
  stopTime,
  summarizeDay,
  wholeSecond,
} from '@/modules/timers/rules';
import {
  routeId,
  timerAwaySchema,
  timerEntryCreateSchema,
  timerEntryUpdateSchema,
  timerStartSchema,
} from '@/modules/timers/schemas';

const TZ = 'Asia/Kolkata';
const DAY = '2026-09-30';
const at = (clock, date = DAY) => localToUtc(date, clock, TZ).toDate();
const seg = (state, from, to, source = 'system') => ({
  state,
  source,
  startedAt: at(from),
  endedAt: at(to),
});

describe('entry minutes and stop times', () => {
  it('counts a running entry to now, never past the end of its work date', () => {
    const running = { workDate: DAY, startedAt: at('10:00'), endedAt: null };
    expect(entryMinutes(running, at('10:45'), TZ)).toBe(45);
    expect(countedEnd(running, at('09:00', '2026-10-01'), TZ)).toEqual(at('00:00', '2026-10-01'));
    expect(entryMinutes(running, at('09:00', '2026-10-01'), TZ)).toBe(14 * 60);
    const done = { workDate: DAY, startedAt: at('10:00'), endedAt: at('10:20') };
    expect(entryMinutes(done, at('18:00'), TZ)).toBe(20);
  });

  it('stops at the given moment, never before the start or past the work date', () => {
    const entry = { workDate: DAY, startedAt: at('10:00') };
    expect(stopTime(entry, at('11:00'), TZ)).toEqual(at('11:00'));
    expect(stopTime(entry, at('09:00'), TZ)).toEqual(at('10:00'));
    expect(stopTime(entry, at('08:00', '2026-10-01'), TZ)).toEqual(at('00:00', '2026-10-01'));
  });

  it('cuts moments to whole seconds and compares them by the second', () => {
    expect(wholeSecond(new Date('2026-09-30T05:00:01.987Z'))).toEqual(
      new Date('2026-09-30T05:00:01.000Z'),
    );
    expect(sameSecond('2026-09-30T05:00:01.000Z', new Date('2026-09-30T05:00:01.900Z'))).toBe(true);
    expect(sameSecond('2026-09-30T05:00:01.000Z', '2026-09-30T05:00:02.000Z')).toBe(false);
  });
});

describe('away spans', () => {
  it('merges idle and locked segments within 150 s; active or a longer gap ends a span', () => {
    const spans = awaySpans([
      seg('active', '10:00', '10:30'),
      seg('idle', '10:30', '10:45'),
      seg('locked', '10:47', '11:02'), // 2 min later: same span
      seg('active', '11:03', '11:10'),
      seg('idle', '11:10', '11:20'),
      seg('idle', '11:23', '11:40'), // 3 min later: a new span
    ]);
    expect(spans).toEqual([
      { from: at('10:30'), to: at('11:02'), ended: true },
      { from: at('11:10'), to: at('11:20'), ended: true },
      { from: at('11:23'), to: at('11:40'), ended: false },
    ]);
  });

  it('offers the earliest ended span that is long enough, clipped to the entry', () => {
    const segments = [
      seg('idle', '09:00', '09:50'), // before the entry: only 10 min of it count
      seg('active', '09:51', '10:20'),
      seg('locked', '10:20', '10:50'),
      seg('active', '10:51', '11:00'),
    ];
    const input = { segments, startedAt: at('09:40'), at: at('11:00'), minMinutes: 25 };
    expect(findAwaySpan(input)).toEqual({ from: at('10:20'), to: at('10:50'), minutes: 30 });
    expect(findAwaySpan({ ...input, minMinutes: 10 })).toEqual({
      from: at('09:40'),
      to: at('09:50'),
      minutes: 10,
    });
    // Already answered up to 10:50: nothing left to ask.
    expect(findAwaySpan({ ...input, checkedUntil: at('10:50') })).toBeNull();
    expect(findAwaySpan({ ...input, minMinutes: 31 })).toBeNull();
  });

  it('only Idle Detection counts as away; window-only screen time ends a span', () => {
    expect(
      awaySpans([
        seg('idle', '10:00', '10:30', 'window'),
        seg('locked', '10:30', '11:00'),
        seg('active', '11:01', '11:05', 'window'),
        seg('idle', '11:05', '11:40', 'window'),
      ]),
    ).toEqual([{ from: at('10:30'), to: at('11:00'), ended: true }]);
  });

  it('never offers a span that may still be going on, or no screen time at all', () => {
    const segments = [seg('active', '10:00', '10:20'), seg('idle', '10:20', '11:00')];
    const input = { segments, startedAt: at('10:00'), at: at('11:00'), minMinutes: 25 };
    expect(findAwaySpan(input)).toBeNull();
    expect(findAwaySpan({ ...input, segments: [] })).toBeNull();
  });
});

describe('overlaps', () => {
  it('finds the first stretch that overlaps, treating an open one as running to now', () => {
    const stretches = [
      { id: 1, startedAt: at('09:00'), endedAt: at('09:30') },
      { id: 2, startedAt: at('10:00'), endedAt: null },
    ];
    const now = at('10:30');
    expect(firstOverlap({ start: at('09:30'), end: at('10:00') }, stretches, now)).toBeNull();
    expect(firstOverlap({ start: at('09:29'), end: at('09:45') }, stretches, now)?.id).toBe(1);
    expect(firstOverlap({ start: at('10:15'), end: at('10:20') }, stretches, now)?.id).toBe(2);
  });

  it('compares to the minute, as the clocks show: seconds never make an overlap', () => {
    const sec = (clock, seconds) => new Date(at(clock).getTime() + seconds * 1000);
    const stretches = [{ id: 1, startedAt: sec('10:00', 5), endedAt: sec('10:30', 20) }];
    const now = at('12:00');
    expect(firstOverlap({ start: at('10:30'), end: at('10:45') }, stretches, now)).toBeNull();
    expect(firstOverlap({ start: at('09:45'), end: at('10:00') }, stretches, now)).toBeNull();
    expect(firstOverlap({ start: at('10:29'), end: at('10:45') }, stretches, now)?.id).toBe(1);
    // The edited entry's own seconds don't count either.
    const next = [{ id: 2, startedAt: sec('10:30', 20), endedAt: null }];
    expect(firstOverlap({ start: at('10:10'), end: sec('10:30', 20) }, next, now)).toBeNull();
  });
});

describe('day summary', () => {
  const entry = (overrides) => ({
    projectId: 1,
    projectName: 'acme-app',
    projectColor: 'blue',
    isUrgent: false,
    projectTaskId: null,
    priority: null,
    projectTaskTitle: null,
    note: null,
    minutes: 0,
    ...overrides,
  });

  it('rounds each project to the nearest 15 minutes and puts the biggest first', () => {
    expect([7, 8, 247, 248].map(roundToQuarterHour)).toEqual([0, 15, 240, 255]);
    const summary = summarizeDay([
      entry({ projectId: 1, projectName: 'acme-app', minutes: 7 }),
      entry({ projectId: 2, projectName: 'beta', minutes: 8 }),
      entry({ projectId: 3, projectName: 'gamma', minutes: 200 }),
      entry({ projectId: 3, projectName: 'gamma', minutes: 47 }),
    ]);
    expect(summary.totalMinutes).toBe(262);
    expect(summary.projects.map((p) => [p.projectName, p.minutes, p.roundedMinutes])).toEqual([
      ['gamma', 247, 240],
      ['beta', 8, 15],
      ['acme-app', 7, 0],
    ]);
  });

  it('de-duplicates task lines by priority task, else by case-insensitive note', () => {
    const task = { projectTaskId: 9, priority: 'p1', projectTaskTitle: 'Fix login timeout' };
    const [project] = summarizeDay([
      entry({ note: 'Fix login', minutes: 10 }),
      entry({ note: '  fix LOGIN ', minutes: 10 }),
      entry({ ...task, minutes: 10 }), // only a priority task: titled with it
      entry({ ...task, note: 'Again', minutes: 10 }),
      entry({ minutes: 10 }), // neither: no line
      entry({ note: 'Review', minutes: 10 }),
    ]).projects;
    expect(project.tasks).toEqual([
      { note: 'Fix login', projectTaskId: null, priority: null, projectTaskTitle: null },
      { note: 'Fix login timeout', ...task },
      { note: 'Review', projectTaskId: null, priority: null, projectTaskTitle: null },
    ]);
    expect(project.minutes).toBe(60);
  });
});

describe('schemas', () => {
  it('trims the note, turns empty values into null and checks ids', () => {
    expect(timerStartSchema.parse({ projectId: '12', note: '  hi  ' })).toEqual({
      projectId: 12,
      projectTaskId: null,
      note: 'hi',
    });
    expect(timerStartSchema.parse({ projectId: 3, projectTaskId: '', note: '   ' })).toEqual({
      projectId: 3,
      projectTaskId: null,
      note: null,
    });
    expect(timerStartSchema.safeParse({ projectId: '1e3' }).success).toBe(false);
    expect(timerStartSchema.safeParse({ projectId: 1, note: 'x'.repeat(201) }).success).toBe(false);
  });

  it('reads clocks as HH:mm and needs something to change', () => {
    const made = timerEntryCreateSchema.parse({
      projectId: 1,
      startClock: '9:05',
      endClock: '10:00',
    });
    expect(made).toMatchObject({ startClock: '09:05', endClock: '10:00' });
    const bad = timerEntryCreateSchema.safeParse({
      projectId: 1,
      startClock: '25:00',
      endClock: 'x',
    });
    expect(bad.error.issues.map((issue) => issue.path[0]).sort()).toEqual([
      'endClock',
      'startClock',
    ]);
    expect(timerEntryUpdateSchema.safeParse({}).success).toBe(false);
    expect(timerEntryUpdateSchema.parse({ note: '' })).toEqual({ note: null });
    expect(timerEntryUpdateSchema.parse({ projectTaskId: null })).toEqual({ projectTaskId: null });
  });

  it('checks the away answer and route ids', () => {
    const iso = '2026-09-30T05:00:00.000Z';
    expect(
      timerAwaySchema.safeParse({ entryId: 1, from: iso, to: iso, decision: 'keep' }).success,
    ).toBe(true);
    const bad = timerAwaySchema.safeParse({ entryId: 1, from: 'soon', to: iso, decision: 'skip' });
    expect(bad.error.issues.map((issue) => issue.path[0]).sort()).toEqual(['decision', 'from']);
    expect(routeId({ id: '42' })).toBe(42);
    expect(routeId({ id: 'abc' })).toBeNull();
    expect(routeId({ id: '007' })).toBeNull();
  });
});
