// The Timeline tab's chart (CONTRACT 22, timelineLayout.js). The first block is the prototype's own
// sample, so its percentages and labels are the approved design's numbers.
import { describe, expect, it } from 'vitest';
import { plannedText } from '@/app/(app)/projects/[id]/phasesView';
import { timelineLayout } from '@/app/(app)/projects/[id]/timelineLayout';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

const TODAY = '2026-10-30'; // a Friday

/** A plan with only the given phases filled in: { design: { plannedStart: ..., ... } }. */
function planOf({ currentPhase = null, deadline = null, ...dates }) {
  return {
    currentPhase,
    deadline,
    phases: PROJECT_PHASES.map(({ key, label }) => ({
      key,
      label,
      plannedStart: null,
      plannedEnd: null,
      actualStart: null,
      actualEnd: null,
      ...dates[key],
    })),
  };
}

const planned = (plannedStart, plannedEnd = plannedStart) => ({ plannedStart, plannedEnd });

const SAMPLE = planOf({
  currentPhase: 'requirement_gathering',
  deadline: '2026-12-15',
  requirement_gathering: { ...planned('2026-10-06', '2026-10-23'), actualStart: '2026-10-06' },
  design: planned('2026-10-26', '2026-11-20'),
  development: planned('2026-11-09', '2026-12-04'),
  testing: planned('2026-11-30', '2026-12-10'),
  launch: planned('2026-12-14', '2026-12-15'),
  support: planned('2026-12-16', '2027-01-15'),
});

const rowOf = (layout, key) => layout.rows.find((row) => row.key === key);

describe('timelineLayout: the prototype', () => {
  const layout = timelineLayout({ plan: SAMPLE, today: TODAY, finishOn: '2026-12-29' });

  it('runs from the Monday before the first date to the Sunday after the last', () => {
    expect(layout.start).toBe('2026-10-05');
    expect(layout.end).toBe('2027-01-17');
    expect(layout.days).toBe(105);
  });

  it('has a tick every week, numbered by the day of the month', () => {
    expect(layout.weeks).toHaveLength(15);
    expect(layout.weeks.slice(0, 5)).toEqual([
      { left: '0.000%', label: '5' },
      { left: '6.667%', label: '12' },
      { left: '13.333%', label: '19' },
      { left: '20.000%', label: '26' },
      { left: '26.667%', label: '2' },
    ]);
  });

  it('names the months, with the year on the first and on January', () => {
    expect(layout.months).toEqual([
      { left: '0.000%', label: 'Oct 2026' },
      { left: '25.714%', label: 'Nov' },
      { left: '54.286%', label: 'Dec' },
      { left: '83.810%', label: 'Jan 2027' },
    ]);
  });

  it('places today at the end of its day, with its label centred', () => {
    expect(layout.today).toEqual({ x: '24.762%', label: 'Today 30 Oct', align: 'center' });
  });

  it('puts the far deadline on the first row, its label on its left', () => {
    expect(layout.deadline).toMatchObject({
      x: 'min(68.571%, calc(100% - 2px))',
      top: 38,
      leftward: true,
      label: 'Deadline 15 Dec',
    });
  });

  it('marks the expected finish on the second row', () => {
    expect(layout.expected).toEqual({
      x: 'min(81.905%, calc(100% - 10px))',
      top: 63,
      lineTop: 22,
      label: 'Expected finish 29 Dec',
      early: false,
      leftward: true,
    });
    expect(layout.headerHeight).toBe(86);
  });

  it('draws planned, then actual up to the planned end, then the late part', () => {
    const { bars, planned: dates, late } = rowOf(layout, 'requirement_gathering');
    expect(dates).toBe('6 to 23 Oct');
    expect(late).toEqual({ text: '7 days late', tone: 'red' });
    expect(bars.planned).toEqual({ left: '0.952%', width: '17.143%' });
    expect(bars.actual).toEqual({ left: '0.952%', width: '17.143%', square: true });
    expect(bars.late).toEqual({ left: '18.095%', width: '6.667%', joined: true });
  });

  it('notes a later phase whose planned start has passed, and draws no actual bar', () => {
    const { bars, planned: dates, late } = rowOf(layout, 'design');
    expect(dates).toBe('26 Oct to 20 Nov');
    expect(late).toEqual({ text: 'Planned start was 4 days ago', tone: 'marigold' });
    expect(bars.actual).toBeNull();
    expect(bars.late).toBeNull();
  });

  it('writes the summary line from the late phases', () => {
    expect(layout.summary).toBe(
      '2 phases behind plan: Requirement gathering is 7 days late, Design should have started 4 days ago.',
    );
  });

  it('keeps a date in another year readable', () => {
    expect(rowOf(layout, 'support').planned).toBe('16 Dec to 15 Jan 2027');
  });
});

describe('timelineLayout: the range', () => {
  it('has no chart when no phase has a planned date', () => {
    const plan = planOf({ currentPhase: 'design', design: { actualStart: '2026-10-01' } });
    expect(timelineLayout({ plan, today: TODAY })).toBeNull();
  });

  it('draws one planned date as a one-day bar, and says which it is', () => {
    const plan = planOf({ design: { plannedStart: '2026-11-02' } });
    const layout = timelineLayout({ plan, today: TODAY });
    expect(rowOf(layout, 'design').planned).toBe('From 2 Nov');
    expect(rowOf(layout, 'design').bars.planned.width).toBe('1.786%');
    expect(rowOf(layout, 'testing').planned).toBe('No dates');
    expect(rowOf(layout, 'testing').bars.planned).toBeNull();
  });

  it('writes a phase planned for one day as that day, as the Phases tab does', () => {
    const design = planned('2026-11-11', '2026-11-11');
    const layout = timelineLayout({ plan: planOf({ design }), today: '2026-11-12' });
    expect(rowOf(layout, 'design').planned).toBe('11 Nov');
    expect(plannedText(design, '2026-11-12')).toBe('Planned 11 Nov');
  });

  it('is at least 8 weeks long', () => {
    const plan = planOf({ design: planned('2026-10-27', '2026-10-29') });
    const layout = timelineLayout({ plan, today: TODAY });
    expect(layout.start).toBe('2026-10-26');
    expect(layout.end).toBe('2026-12-20');
    expect(layout.days).toBe(56);
  });

  it('starts on the date itself when the earliest date is a Monday', () => {
    const plan = planOf({ design: planned('2026-10-05', '2026-10-09') });
    expect(timelineLayout({ plan, today: TODAY }).start).toBe('2026-10-05');
  });

  it('reaches today, the deadline, the expected finish and every actual date', () => {
    const plan = planOf({
      currentPhase: 'design',
      deadline: '2027-02-10',
      design: { ...planned('2026-11-02', '2026-11-06'), actualStart: '2026-09-29' },
    });
    const layout = timelineLayout({ plan, today: TODAY, finishOn: '2027-03-03' });
    expect(layout.start).toBe('2026-09-28');
    expect(layout.end).toBe('2027-03-07');
  });

  it('leaves out a month name that would touch the next one', () => {
    const plan = planOf({ design: planned('2026-10-27', '2026-11-20') });
    const layout = timelineLayout({ plan, today: TODAY });
    expect(layout.start).toBe('2026-10-26');
    expect(layout.months[0]).toEqual({ left: '10.714%', label: 'Nov 2026' });
    expect(layout.months[1].label).toBe('Dec');
  });

  it('keeps a month name that starts near the right edge inside the chart, year and all', () => {
    // The 8-week chart of a project planned in November: it ends on Sunday 3 January.
    const plan = planOf({
      currentPhase: 'design',
      deadline: '2026-12-18',
      design: { ...planned('2026-11-10', '2026-11-21'), actualStart: '2026-11-12' },
    });
    const layout = timelineLayout({ plan, today: '2026-11-12' });
    expect([layout.start, layout.end, layout.minWidth]).toEqual(['2026-11-09', '2027-01-03', 680]);
    expect(layout.months).toEqual([
      { left: '0.000%', label: 'Nov 2026' },
      { left: '39.286%', label: 'Dec' },
      { left: 'min(94.643%, calc(100% - 60px))', label: 'Jan 2027' },
    ]);
  });

  it('keeps a short month name inside the chart too, and leaves names with room alone', () => {
    // Ends on Sunday 3 May: May has 3 days, too few for "May" at the narrowest chart.
    const plan = planOf({ design: planned('2026-03-09', '2026-04-20') });
    const layout = timelineLayout({ plan, today: '2026-03-09' });
    expect([layout.end, layout.minWidth]).toEqual(['2026-05-03', 680]);
    expect(layout.months.map((month) => month.label)).toEqual(['Mar 2026', 'Apr', 'May']);
    expect(layout.months.at(-1).left).toBe('min(94.643%, calc(100% - 32px))');
    expect(layout.months.slice(0, -1).every((month) => month.left.endsWith('%'))).toBe(true);
  });

  it('thins the ticks on a very long chart, so it never gets absurdly wide', () => {
    const plan = planOf({ design: planned('2000-01-03', '2099-12-31') });
    const layout = timelineLayout({ plan, today: TODAY });
    expect(layout.weeks.length).toBeLessThanOrEqual(78);
    expect(layout.months.length).toBeLessThanOrEqual(30);
    expect(layout.months.every((month) => /\d{4}$/.test(month.label))).toBe(true);
    expect(layout.minWidth).toBeLessThan(2200);
  });

  it('grows wider than the design minimum only when the weeks need it', () => {
    const short = timelineLayout({ plan: SAMPLE, today: TODAY });
    expect(short.minWidth).toBe(680);
    const plan = planOf({ design: planned('2026-01-05', '2027-06-30') });
    expect(timelineLayout({ plan, today: TODAY }).minWidth).toBe(220 + 78 * 24);
  });
});

describe('timelineLayout: bars', () => {
  const inChart = { plannedStart: '2026-10-05', plannedEnd: '2026-10-11' };

  it('rounds a finished phase that ended on time, with no late part', () => {
    const plan = planOf({
      currentPhase: 'design',
      requirement_gathering: { ...inChart, actualStart: '2026-10-05', actualEnd: '2026-10-11' },
    });
    const { bars, late } = rowOf(timelineLayout({ plan, today: TODAY }), 'requirement_gathering');
    expect(bars.actual.square).toBe(false);
    expect(bars.late).toBeNull();
    expect(late).toBeNull();
  });

  it('splits a phase that ended late, and says so in the summary', () => {
    const plan = planOf({
      currentPhase: 'design',
      requirement_gathering: { ...inChart, actualStart: '2026-10-05', actualEnd: '2026-10-14' },
    });
    const layout = timelineLayout({ plan, today: TODAY });
    const { bars, late } = rowOf(layout, 'requirement_gathering');
    expect(bars.actual.square).toBe(true);
    expect(bars.late.joined).toBe(true);
    expect(late).toEqual({ text: 'Ended 3 days late', tone: 'red' });
    expect(layout.summary).toBe('1 phase late so far: Requirement gathering ended 3 days late.');
  });

  it('draws only the red part when the phase started after its planned end', () => {
    const plan = planOf({
      currentPhase: 'requirement_gathering',
      requirement_gathering: { ...inChart, actualStart: '2026-10-20' },
    });
    const { bars } = rowOf(timelineLayout({ plan, today: TODAY }), 'requirement_gathering');
    expect(bars.actual).toBeNull();
    expect(bars.late.joined).toBe(false);
  });

  it('squares an open phase that is not late yet', () => {
    const plan = planOf({
      currentPhase: 'design',
      design: { ...planned('2026-10-26', '2026-11-20'), actualStart: '2026-10-26' },
    });
    const { bars, late } = rowOf(timelineLayout({ plan, today: TODAY }), 'design');
    expect(bars.actual.square).toBe(true);
    expect(bars.late).toBeNull();
    expect(late).toBeNull();
  });

  it('never calls a phase with no planned end late', () => {
    const plan = planOf({
      currentPhase: 'requirement_gathering',
      requirement_gathering: { actualStart: '2026-10-05' },
      design: planned('2026-11-02', '2026-11-20'),
    });
    const { bars, late } = rowOf(timelineLayout({ plan, today: TODAY }), 'requirement_gathering');
    expect(bars.actual.width).not.toBe('0.000%');
    expect(bars.late).toBeNull();
    expect(late).toBeNull();
  });

  it('never draws a late part for a phase with a planned start and no planned end', () => {
    const plan = planOf({
      currentPhase: 'development',
      design: { plannedStart: '2026-10-05', actualStart: '2026-10-05', actualEnd: '2026-10-23' },
      development: { plannedStart: '2026-10-26', actualStart: '2026-10-26' },
    });
    const layout = timelineLayout({ plan, today: '2026-11-12' });
    const done = rowOf(layout, 'design');
    const open = rowOf(layout, 'development');
    // The one-day planned bar stays; the whole actual bar is blue.
    expect(done.bars.planned).toEqual({ left: '0.000%', width: '1.786%' });
    expect(done.bars.actual).toEqual({ left: '0.000%', width: '33.929%', square: false });
    expect(done.bars.late).toBeNull();
    expect(open.bars.actual).toEqual({ left: '37.500%', width: '32.143%', square: true });
    expect(open.bars.late).toBeNull();
    expect([done.late, layout.summary]).toEqual([null, null]);
  });

  it('notes a started-late phase in marigold, and calls that late so far', () => {
    const plan = planOf({
      currentPhase: 'design',
      design: { ...planned('2026-10-20', '2026-11-20'), actualStart: '2026-10-23' },
    });
    const layout = timelineLayout({ plan, today: TODAY });
    expect(rowOf(layout, 'design').late).toEqual({ text: 'Started 3 days late', tone: 'marigold' });
    expect(layout.summary).toBe('1 phase late so far: Design started 3 days late.');
  });

  it('shows a jumped-over phase as Skipped, which is not late', () => {
    const plan = planOf({
      currentPhase: 'design',
      requirement_gathering: inChart,
      design: { ...planned('2026-10-26', '2026-11-20'), actualStart: '2026-10-26' },
    });
    const layout = timelineLayout({ plan, today: TODAY });
    expect(rowOf(layout, 'requirement_gathering').late).toEqual({
      text: 'Skipped',
      tone: 'muted',
    });
    expect(layout.summary).toBeNull();
  });

  it('treats every phase as later with no phase yet', () => {
    const plan = planOf({ requirement_gathering: inChart });
    const layout = timelineLayout({ plan, today: TODAY });
    expect(rowOf(layout, 'requirement_gathering').late.text).toBe('Planned start was 25 days ago');
    expect(layout.summary).toBe(
      '1 phase behind plan: Requirement gathering should have started 25 days ago.',
    );
  });

  it('has no summary line when nothing is late', () => {
    const plan = planOf({ design: planned('2026-11-02', '2026-11-20') });
    expect(timelineLayout({ plan, today: TODAY }).summary).toBeNull();
  });
});

describe('timelineLayout: markers', () => {
  const dates = { design: planned('2026-10-05', '2027-01-15') };
  const plan = (deadline) => planOf({ currentPhase: null, deadline, ...dates });

  it('has no deadline or expected finish marker without a deadline', () => {
    const layout = timelineLayout({ plan: plan(null), today: TODAY, finishOn: '2026-12-01' });
    expect(layout.deadline).toBeNull();
    expect(layout.expected).toBeNull();
  });

  it('takes a past deadline to the second row, label on its right', () => {
    const { deadline } = timelineLayout({ plan: plan('2026-10-20'), today: TODAY });
    expect(deadline).toMatchObject({ top: 63, leftward: false });
  });

  it('takes a deadline close to today to the second row, label on its left', () => {
    const { deadline } = timelineLayout({ plan: plan('2026-11-02'), today: TODAY });
    expect(deadline).toMatchObject({ top: 63, leftward: true });
  });

  it('keeps a deadline further off on the first row, label on its right', () => {
    const { deadline } = timelineLayout({ plan: plan('2026-11-20'), today: TODAY });
    expect(deadline).toMatchObject({ top: 38, leftward: false });
  });

  it('flips the label of a deadline close to the right edge so it stays on the chart', () => {
    const today = '2026-12-10';
    const { deadline } = timelineLayout({ plan: plan('2027-01-10'), today });
    expect(deadline.leftward).toBe(true);
  });

  it('pins a deadline before the chart to its left edge, with the real date', () => {
    const { deadline } = timelineLayout({ plan: plan('2026-01-10'), today: TODAY });
    expect(deadline.x).toBe('min(0.000%, calc(100% - 2px))');
    expect(deadline.label).toBe('Deadline 10 Jan');
  });

  it('colours an early finish green and a late one red', () => {
    const early = timelineLayout({
      plan: plan('2027-01-05'),
      today: TODAY,
      finishOn: '2026-12-01',
    });
    expect(early.expected.early).toBe(true);
    expect(early.expected.leftward).toBe(true);
    const soon = timelineLayout({ plan: plan('2027-01-05'), today: TODAY, finishOn: '2026-11-02' });
    expect(soon.expected.leftward).toBe(false);
    const late = timelineLayout({ plan: plan('2026-11-20'), today: TODAY, finishOn: '2026-12-10' });
    expect(late.expected.early).toBe(false);
    expect(late.expected.leftward).toBe(false);
  });

  it('has no expected marker when the work ends on the deadline, or nothing is left', () => {
    const same = timelineLayout({ plan: plan('2026-12-15'), today: TODAY, finishOn: '2026-12-15' });
    expect(same.expected).toBeNull();
    const none = timelineLayout({ plan: plan('2026-12-15'), today: TODAY, finishOn: null });
    expect(none.expected).toBeNull();
  });

  it('adds a row when the deadline and expected finish labels would touch', () => {
    const layout = timelineLayout({
      plan: plan('2026-10-28'),
      today: TODAY,
      finishOn: '2026-11-04',
    });
    expect(layout.deadline.top).toBe(63);
    expect(layout.expected.top).toBe(88);
    expect(layout.expected.lineTop).toBe(47);
    expect(layout.headerHeight).toBe(111);
  });

  it('keeps the Today label on the chart at either edge', () => {
    const late = planOf({ design: planned('2026-09-07', '2026-09-11') });
    expect(timelineLayout({ plan: late, today: '2026-11-01' }).today.align).toBe('end');
    const early = planOf({ design: planned('2026-10-05', '2027-01-15') });
    expect(timelineLayout({ plan: early, today: '2026-10-06' }).today.align).toBe('start');
  });
});
