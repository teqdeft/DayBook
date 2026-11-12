// The Timeline tab's chart (CONTRACT 22), ported from the prototype: turns a project's dates into
// percentages across the chart, week and month ticks, the planned, actual and late part of each bar,
// the Today, Deadline and Expected finish markers, and the summary line. Pure: no I/O, no hooks.
import { addDays, dayjs, weekRange } from '@/lib/time';
import {
  dayCount,
  daysBetween,
  lateNote,
  phaseStatus,
  plannedRange,
  shortDate,
} from './planFormat';

const MIN_WEEKS = 8;
/** A chart longer than this labels every nth week, so it never gets wider than a screen or two. */
const MAX_WEEK_TICKS = 78;
const MAX_MONTH_TICKS = 30;
/** A month that only just shows at the chart's left edge has no room for its name. */
const MIN_DAYS_FOR_FIRST_MONTH = 14;
const LABEL_COLUMN_PX = 220;
const MIN_CHART_PX = 680;
const PX_PER_WEEK_TICK = 24;
/** At most how wide a month name is ("Sep 2027" or "Sep" in 12 px semibold), with a little spare. */
const MONTH_LABEL_PX = Object.freeze({ withYear: 60, short: 32 });

// Where the marker labels go, as shares of the chart (the prototype's 11 and 35 days of 105).
const NEAR_TODAY = 11 / 105;
const FAR_FROM_TODAY = 1 / 3;
const NEAR_RIGHT_EDGE = 0.8;
const TODAY_EDGE = 0.09;
const EARLY_FINISH_FLIPS_AT = 0.34;
const LATE_FINISH_FLIPS_AT = 0.69;
/** Two labels on one row closer than this would touch. */
const LABELS_TOUCH = 0.22;

// The label rows under the month and week numbers.
const ROW_ONE_TOP = 38;
const ROW_TWO_TOP = 63;
const ROW_THREE_TOP = 88;
const HEADER_HEIGHT = 86;
const ROW_HEIGHT = 25;
/** The Expected finish line starts behind its label; lines are placed from 50 px down the chart. */
const EXPECTED_LINE_OFFSET = 41;

const planDatesOf = ({ plannedStart, plannedEnd, actualStart, actualEnd }) =>
  [plannedStart, plannedEnd, actualStart, actualEnd].filter(Boolean);

/**
 * The chart's first and last day: the Monday before the earliest date (planned, actual or today) to
 * the Sunday after the latest (planned, actual, deadline, expected finish or today), at least 8
 * weeks.
 * @returns {{ start: string, end: string, days: number }} `days` counts both ends
 */
function chartRange({ plan, today, finishOn }) {
  const dates = plan.phases.flatMap(planDatesOf);
  const earliest = [today, ...dates].sort()[0];
  const latest = [today, plan.deadline, finishOn, ...dates].filter(Boolean).sort().at(-1);
  const start = weekRange(earliest).from;
  const shortest = addDays(start, MIN_WEEKS * 7 - 1);
  const lastDay = weekRange(latest).to;
  const end = lastDay < shortest ? shortest : lastDay;
  return { start, end, days: daysBetween(start, end) + 1 };
}

/** '68.571%': a day's place on the chart. Markers past the edge stay pinned to it. */
function percent(offset, days) {
  return `${((Math.max(0, Math.min(days, offset)) / days) * 100).toFixed(3)}%`;
}

function weekTicks({ start, days }) {
  const weeks = days / 7;
  const every = Math.ceil(weeks / MAX_WEEK_TICKS);
  const ticks = [];
  for (let week = 0; week < weeks; week += every) {
    const offset = week * 7;
    ticks.push({
      left: percent(offset, days),
      label: String(dayjs.utc(start).add(offset, 'day').date()),
    });
  }
  return ticks;
}

/**
 * Where a month name starts. One that could run past the chart's right edge, at the narrowest the
 * chart gets (`track` px), is kept inside it, so its year is never cut off and the chart doesn't
 * scroll sideways for it.
 */
function monthLeft(offset, { days, track, width }) {
  const left = percent(offset, days);
  const room = ((days - offset) / days) * track;
  return room < width ? `min(${left}, calc(100% - ${width}px))` : left;
}

/**
 * 'Oct 2026', 'Nov', 'Dec', 'Jan 2027': the first label and every January carry the year.
 * @param {{ start: string, end: string, days: number }} range
 * @param {number} track the chart's narrowest width without the names column, in px
 */
function monthTicks({ start, end, days }, track) {
  const firsts = [];
  let first = dayjs.utc(start).startOf('month').add(1, 'month');
  while (first.format('YYYY-MM-DD') <= end) {
    firsts.push(first.format('YYYY-MM-DD'));
    first = first.add(1, 'month');
  }
  const room = firsts.length === 0 || daysBetween(start, firsts[0]) >= MIN_DAYS_FOR_FIRST_MONTH;
  const dates = room ? [start, ...firsts] : firsts;
  const every = Math.ceil(dates.length / MAX_MONTH_TICKS);
  return dates
    .filter((_, index) => index % every === 0)
    .map((date, index) => {
      const withYear = index === 0 || every > 1 || date.slice(5, 7) === '01';
      const width = withYear ? MONTH_LABEL_PX.withYear : MONTH_LABEL_PX.short;
      return {
        left: monthLeft(daysBetween(start, date), { days, track, width }),
        label: dayjs.utc(date).format(withYear ? 'MMM YYYY' : 'MMM'),
      };
    });
}

/**
 * A phase's bars. Planned is drawn from its dates (one date alone is a one-day bar). Actual runs from
 * the start to the end, or to today while it is open: the part up to the planned end is blue, the
 * part after it red. With no planned end nothing can be late, a planned start alone included.
 */
function phaseBars(phase, { start, days, today }) {
  const offset = (date) => (date ? daysBetween(start, date) : null);
  const plannedFrom = offset(phase.plannedStart ?? phase.plannedEnd);
  const plannedTo = offset(phase.plannedEnd ?? phase.plannedStart);
  const planned =
    plannedFrom === null
      ? null
      : {
          left: percent(plannedFrom, days),
          width: percent(plannedTo + 1 - plannedFrom, days),
        };

  const from = offset(phase.actualStart);
  if (from === null) return { planned, actual: null, late: null };
  // The first late day: the one after the planned end.
  const lateFrom = phase.plannedEnd ? offset(phase.plannedEnd) + 1 : Infinity;
  const open = !phase.actualEnd;
  const to = (open ? offset(today) : offset(phase.actualEnd)) + 1;
  const hasBlue = from < lateFrom;
  const hasRed = to > lateFrom;
  const redFrom = Math.max(from, lateFrom);
  return {
    planned,
    actual: hasBlue
      ? {
          left: percent(from, days),
          width: percent(Math.min(to, lateFrom) - from, days),
          square: hasRed || open,
        }
      : null,
    late: hasRed
      ? { left: percent(redFrom, days), width: percent(to - redFrom, days), joined: hasBlue }
      : null,
  };
}

/** A phase's part of the summary line, or null when it isn't late. */
function lateBit(status, phase, today) {
  const { label, plannedStart, plannedEnd, actualStart, actualEnd } = phase;
  if (status === 'done') {
    const late = actualEnd && plannedEnd ? daysBetween(plannedEnd, actualEnd) : 0;
    return late > 0 ? { text: `${label} ended ${dayCount(late)} late`, behind: false } : null;
  }
  if (status === 'later') {
    const ago = plannedStart ? daysBetween(plannedStart, today) : 0;
    const text = `${label} should have started ${dayCount(ago)} ago`;
    return ago > 0 ? { text, behind: true } : null;
  }
  if (status !== 'current') return null;
  const overdue = plannedEnd ? daysBetween(plannedEnd, today) : 0;
  if (overdue > 0) return { text: `${label} is ${dayCount(overdue)} late`, behind: true };
  const started = actualStart && plannedStart ? daysBetween(plannedStart, actualStart) : 0;
  return started > 0 ? { text: `${label} started ${dayCount(started)} late`, behind: false } : null;
}

/** "2 phases behind plan: Design is 7 days late, Testing should have started 3 days ago." */
function summaryLine(bits) {
  if (bits.length === 0) return null;
  const count = bits.length === 1 ? '1 phase' : `${bits.length} phases`;
  const state = bits.some((bit) => bit.behind) ? 'behind plan' : 'late so far';
  return `${count} ${state}: ${bits.map((bit) => bit.text).join(', ')}.`;
}

function todayMarker(today, { start, days }) {
  const place = daysBetween(start, today) + 1;
  const share = place / days;
  let align = 'center';
  if (share < TODAY_EDGE) align = 'start';
  else if (share > 1 - TODAY_EDGE) align = 'end';
  return { x: percent(place, days), label: `Today ${shortDate(today, today)}`, align };
}

/**
 * A past deadline, or one close to today, takes the second row so it never covers the Today label.
 * A deadline far to the right has its label on its left, so the label stays on the chart.
 */
function deadlineMarker(deadline, today, { start, days }) {
  if (!deadline) return null;
  const place = daysBetween(start, deadline) + 1;
  const gap = daysBetween(today, deadline) / days;
  const near = gap < NEAR_TODAY;
  const leftward = gap >= FAR_FROM_TODAY || place / days > NEAR_RIGHT_EDGE || (gap >= 0 && near);
  return {
    x: `min(${percent(place, days)}, calc(100% - 2px))`,
    share: place / days,
    top: near || (leftward && gap < FAR_FROM_TODAY) ? ROW_TWO_TOP : ROW_ONE_TOP,
    label: `Deadline ${shortDate(deadline, today)}`,
    leftward,
  };
}

/** Shown only when the work is expected to end on another day than the deadline. */
function expectedMarker({ finishOn, deadline, today }, marker, { start, days }) {
  if (!finishOn || !deadline || finishOn === deadline) return null;
  const place = daysBetween(start, finishOn) + 1;
  const early = finishOn < deadline;
  const touching =
    marker.top === ROW_TWO_TOP && Math.abs(marker.share - place / days) < LABELS_TOUCH;
  const top = touching ? ROW_THREE_TOP : ROW_TWO_TOP;
  return {
    x: `min(${percent(place, days)}, calc(100% - 10px))`,
    top,
    lineTop: top - EXPECTED_LINE_OFFSET,
    label: `Expected finish ${shortDate(finishOn, today)}`,
    early,
    leftward: place / days > (early ? EARLY_FINISH_FLIPS_AT : LATE_FINISH_FLIPS_AT),
  };
}

/**
 * The whole chart.
 * @param {{ plan: { currentPhase: string | null, deadline: string | null,
 *   phases: Array<{ key, label, plannedStart, plannedEnd, actualStart, actualEnd }> },
 *   today: string, finishOn: string | null }} input finishOn: forecastProject's
 * @returns {null | { start: string, end: string, days: number, minWidth: number,
 *   headerHeight: number, summary: string | null, weeks: Array<{ left, label }>,
 *   months: Array<{ left, label }>, (a name near the right edge has a CSS min() as its left)
 *   rows: Array<{ key, label, planned: string, late: { text, tone } | null,
 *     bars: { planned: { left, width } | null, actual: { left, width, square } | null,
 *       late: { left, width, joined } | null } }>,
 *   today: { x, label, align: 'start'|'center'|'end' },
 *   deadline: { x, top, label, leftward } | null,
 *   expected: { x, top, lineTop, label, early, leftward } | null }} null when no phase has a
 *   planned date (the empty state)
 */
export function timelineLayout({ plan, today, finishOn = null }) {
  const planned = plan.phases.some((phase) => phase.plannedStart || phase.plannedEnd);
  if (!planned) return null;
  const range = chartRange({ plan, today, finishOn });
  const bits = [];
  const rows = plan.phases.map((phase) => {
    const status = phaseStatus(plan.currentPhase, phase);
    const bit = lateBit(status, phase, today);
    if (bit) bits.push(bit);
    return {
      key: phase.key,
      label: phase.label,
      planned: plannedRange(phase, today) ?? 'No dates',
      late: lateNote(status, phase, today),
      bars: phaseBars(phase, { ...range, today }),
    };
  });
  const weeks = weekTicks(range);
  const minWidth = Math.max(MIN_CHART_PX, LABEL_COLUMN_PX + weeks.length * PX_PER_WEEK_TICK);
  const deadline = deadlineMarker(plan.deadline, today, range);
  const expected = deadline
    ? expectedMarker({ finishOn, deadline: plan.deadline, today }, deadline, range)
    : null;
  return {
    ...range,
    minWidth,
    headerHeight: expected?.top === ROW_THREE_TOP ? HEADER_HEIGHT + ROW_HEIGHT : HEADER_HEIGHT,
    summary: summaryLine(bits),
    weeks,
    months: monthTicks(range, minWidth - LABEL_COLUMN_PX),
    rows,
    today: todayMarker(today, range),
    deadline,
    expected,
  };
}
