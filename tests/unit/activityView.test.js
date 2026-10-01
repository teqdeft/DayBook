// How the screens draw screen time (CONTRACT section 11): the day timeline's hour scale and
// blocks on /screen-time, and the per-day summary card on Employee detail and My log.
import { describe, expect, it } from 'vitest';
import {
  measuredText,
  minuteOfDay,
  rangeSummary,
  timelineBlocks,
  timelineScale,
} from '@/app/(app)/screen-time/screenTimeView';

const tz = 'Asia/Kolkata';
const date = '2026-09-30';
const at = (clock, day = date) => new Date(`${day}T${clock}:00+05:30`);
const labels = (scale) => scale.ticks.filter((tick) => tick.label).map((tick) => tick.label);

describe('timelineScale', () => {
  it('covers office hours with an hour either side, labelled every two hours', () => {
    const scale = timelineScale({ date, tz, officeStart: '09:30', officeEnd: '18:30' });
    expect([scale.start, scale.end]).toEqual([8 * 60, 20 * 60]);
    expect(labels(scale)).toEqual(['8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM']);
    expect(scale.ticks[0].align).toBe('start');
    expect(scale.ticks.at(-1).align).toBe('end');
  });

  it('widens to whole hours around segments outside office hours, within the day', () => {
    const early = [{ state: 'active', startedAt: at('06:40'), endedAt: at('07:10') }];
    const late = [{ state: 'active', startedAt: at('22:15'), endedAt: at('23:59') }];
    const scale = timelineScale({
      date,
      tz,
      officeStart: '09:30',
      officeEnd: '18:30',
      segmentLists: [early, late],
    });
    expect([scale.start, scale.end]).toEqual([6 * 60, 24 * 60]);
    // 18 hours: a label every three hours so they don't run together
    expect(labels(scale)[1]).toBe('9 AM');
  });
});

describe('timelineBlocks', () => {
  const scale = { start: 480, end: 1200 };

  it('places blocks by company time, merges touching ones and leaves gaps empty', () => {
    const blocks = timelineBlocks(
      [
        { state: 'idle', startedAt: at('11:00'), endedAt: at('11:30') },
        { state: 'active', startedAt: at('09:00'), endedAt: at('10:00') },
        { state: 'active', startedAt: at('10:00'), endedAt: at('11:00') },
        { state: 'active', startedAt: at('12:00'), endedAt: at('12:30') }, // after a gap
        { state: 'locked', startedAt: at('13:00'), endedAt: at('13:00') }, // a single report
      ],
      { date, tz, scale },
    );
    expect(blocks.map((block) => block.state)).toEqual(['active', 'idle', 'active']);
    expect(blocks[0].left).toBeCloseTo((60 / 720) * 100);
    expect(blocks[0].width).toBeCloseTo((120 / 720) * 100);
    expect(blocks[2].left).toBeCloseTo((240 / 720) * 100);
  });

  it('cuts blocks to the scale', () => {
    const [block] = timelineBlocks(
      [{ state: 'active', startedAt: at('07:00'), endedAt: at('09:00') }],
      { date, tz, scale },
    );
    expect(block.left).toBe(0);
    expect(block.width).toBeCloseTo((60 / 720) * 100);
  });

  it('measures minutes from local midnight of the day shown', () => {
    expect(minuteOfDay(at('00:30'), date, tz)).toBe(30);
    expect(minuteOfDay(at('23:30', '2026-09-29'), date, tz)).toBe(-30);
  });
});

describe('rangeSummary', () => {
  const week = {
    days: [{ workDate: '2026-09-29', activeMinutes: 300, idleMinutes: 30, lockedMinutes: 10 }],
    totals: { activeMinutes: 300, idleMinutes: 30, lockedMinutes: 10, daysWithData: 1 },
  };

  it('gives the four numbers and a bar per working day, days after today drawn empty', () => {
    const summary = rangeSummary({
      range: week,
      from: '2026-09-28',
      to: '2026-10-04',
      today: '2026-09-30',
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(summary.stats.map((stat) => stat.value)).toEqual(['5h', '5h', '30m', '10m']);
    expect(summary.bars.map((bar) => bar.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(summary.bars[1]).toMatchObject({ active: 300, idle: 30, locked: 10 });
    expect(summary.bars[2].today).toBe(true);
    expect(summary.bars[3].future).toBe(true);
    expect(summary.daysText).toBe('1 day with data');
  });

  it('adds a weekend day only when it has data', () => {
    const summary = rangeSummary({
      range: {
        days: [{ workDate: '2026-09-27', activeMinutes: 60, idleMinutes: 0, lockedMinutes: 0 }],
        totals: { activeMinutes: 60, idleMinutes: 0, lockedMinutes: 0, daysWithData: 1 },
      },
      from: '2026-09-26',
      to: '2026-09-29',
      today: '2026-09-30',
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(summary.bars.map((bar) => bar.key)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
  });

  it('switches to one bar per week for long ranges, and copes with no data', () => {
    const summary = rangeSummary({
      range: null,
      from: '2026-07-01',
      to: '2026-09-30',
      today: '2026-09-30',
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(summary.weekly).toBe(true);
    expect(summary.bars).toHaveLength(14);
    expect(summary.hasData).toBe(false);
    expect(summary.stats[1].value).toBe('—');
  });
});

describe('measuredText', () => {
  it('names the idle setting', () => {
    expect(measuredText(5)).toContain('in the last 5 minutes');
    expect(measuredText(1)).toContain('in the last minute');
  });
});
