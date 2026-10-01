// Shapes screen-time numbers (docs/CONTRACT.md section 11) into what the screens show: the day
// timeline of the Screen time table, and the per-day summary card on Employee detail and My log.
// Pure functions of @/lib/time (no database, no React), so they are easy to test.
import { plural } from '@/lib/text';
import {
  clockToMinutes,
  dayjs,
  eachDay,
  formatDayMonthShort,
  formatDayShort,
  formatDuration,
  isWorkingDay,
  localToUtc,
  weekRange,
} from '@/lib/time';

const DAY_MINUTES = 24 * 60;
// Above this many days the summary chart shows one bar per week instead of one per day.
const MAX_DAY_BARS = 31;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const minutesOf = (value) => Math.max(0, Math.round(Number(value) || 0));

/** Minutes after local midnight of `date` for a moment (below 0 or above 1440 across midnight). */
export function minuteOfDay(at, date, tz) {
  return dayjs(at).diff(localToUtc(date, '00:00', tz), 'second') / 60;
}

function hourLabel(minutes) {
  const hour = Math.floor(minutes / 60) % 24;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * The hours one day's timelines cover: office hours with an hour either side, widened to whole
 * hours around every segment. Every row of the table uses the same scale.
 * @param {{ date: string, tz: string, officeStart: string, officeEnd: string,
 *   segmentLists?: { startedAt: any, endedAt: any }[][] }} input
 * @returns {{ start: number, end: number, ticks: { minute: number, pct: number, label: string|null,
 *   align: 'start'|'center'|'end' }[] }}
 */
export function timelineScale({ date, tz, officeStart, officeEnd, segmentLists = [] }) {
  let start = Math.floor(clockToMinutes(officeStart) / 60) * 60 - 60;
  let end = Math.ceil(clockToMinutes(officeEnd) / 60) * 60 + 60;
  for (const segments of segmentLists) {
    for (const segment of segments ?? []) {
      start = Math.min(start, Math.floor(minuteOfDay(segment.startedAt, date, tz) / 60) * 60);
      end = Math.max(end, Math.ceil(minuteOfDay(segment.endedAt, date, tz) / 60) * 60);
    }
  }
  start = clamp(start, 0, DAY_MINUTES - 60);
  end = clamp(end, start + 60, DAY_MINUTES);
  const span = end - start;
  const step = span <= 12 * 60 ? 120 : span <= 18 * 60 ? 180 : 240;
  const ticks = [];
  for (let minute = start; minute <= end; minute += 60) {
    const pct = ((minute - start) / span) * 100;
    const labelled = minute % step === 0;
    ticks.push({
      minute,
      pct,
      label: labelled ? hourLabel(minute) : null,
      align: pct < 4 ? 'start' : pct > 96 ? 'end' : 'center',
    });
  }
  return { start, end, ticks };
}

/**
 * One person's segments as positioned blocks on the scale. Touching blocks in the same state are
 * merged; gaps (no data) stay empty.
 * @returns {{ state: 'active'|'idle'|'locked', left: number, width: number }[]} percentages
 */
export function timelineBlocks(segments, { date, tz, scale }) {
  const span = scale.end - scale.start;
  const sorted = [...(segments ?? [])].sort(
    (a, b) => dayjs(a.startedAt).valueOf() - dayjs(b.startedAt).valueOf(),
  );
  const merged = [];
  for (const segment of sorted) {
    const from = clamp(minuteOfDay(segment.startedAt, date, tz), scale.start, scale.end);
    const to = clamp(minuteOfDay(segment.endedAt, date, tz), scale.start, scale.end);
    if (to - from < 0.5) continue;
    const last = merged.at(-1);
    if (last && last.state === segment.state && from - last.to <= 1)
      last.to = Math.max(last.to, to);
    else merged.push({ state: segment.state, from, to });
  }
  return merged.map((block) => ({
    state: block.state,
    left: ((block.from - scale.start) / span) * 100,
    width: ((block.to - block.from) / span) * 100,
  }));
}

/** 'Active 5h 12m, idle 40m, locked 1h' for screen readers and hover text. */
export function minutesText({ activeMinutes, idleMinutes, lockedMinutes }) {
  return `Active ${formatDuration(activeMinutes)}, idle ${formatDuration(idleMinutes)}, locked ${formatDuration(lockedMinutes)}`;
}

function dayBars(dates, byDate, today) {
  const short = dates.length <= 7;
  return dates.map((date, index) => {
    const day = byDate.get(date);
    const values = {
      active: minutesOf(day?.activeMinutes),
      idle: minutesOf(day?.idleMinutes),
      locked: minutesOf(day?.lockedMinutes),
    };
    const future = date > today;
    const label = short ? formatDayShort(date).slice(0, 3) : String(Number(date.slice(8)));
    return {
      key: date,
      label,
      // Every other day number is left out when the card is narrow.
      minor: !short && index % 2 === 1,
      today: date === today,
      future,
      ...values,
      title: future
        ? `${formatDayShort(date)}: not yet`
        : `${formatDayShort(date)}: ${minutesText({
            activeMinutes: values.active,
            idleMinutes: values.idle,
            lockedMinutes: values.locked,
          })}`,
    };
  });
}

function weekBars(dates, byDate, today) {
  const weeks = new Map();
  for (const date of dates) {
    const { from } = weekRange(date);
    const week = weeks.get(from) ?? { from, to: date, active: 0, idle: 0, locked: 0 };
    const day = byDate.get(date);
    week.to = date;
    week.active += minutesOf(day?.activeMinutes);
    week.idle += minutesOf(day?.idleMinutes);
    week.locked += minutesOf(day?.lockedMinutes);
    weeks.set(from, week);
  }
  return [...weeks.values()].map((week, index) => ({
    key: week.from,
    label: formatDayMonthShort(week.from),
    minor: index % 2 === 1,
    today: week.from <= today && today <= week.to,
    future: week.from > today,
    active: week.active,
    idle: week.idle,
    locked: week.locked,
    title: `Week of ${formatDayMonthShort(week.from)}: ${minutesText({
      activeMinutes: week.active,
      idleMinutes: week.idle,
      lockedMinutes: week.locked,
    })}`,
  }));
}

/**
 * The Screen time card for a range (Employee detail, My log): four numbers and a bar per day
 * (working days, plus any other day with data), or per week for ranges longer than a month.
 * @param {{
 *   range: { days: object[], totals: { activeMinutes: number, idleMinutes: number,
 *     lockedMinutes: number, daysWithData: number } },
 *   from: string, to: string, today: string, workingDays: number[],
 * }} input  `from`..`to` is the period shown (days after today are drawn empty).
 */
export function rangeSummary({ range, from, to, today, workingDays }) {
  const days = range?.days ?? [];
  const byDate = new Map(days.map((day) => [day.workDate, day]));
  const totals = range?.totals ?? {};
  const active = minutesOf(totals.activeMinutes);
  const idle = minutesOf(totals.idleMinutes);
  const locked = minutesOf(totals.lockedMinutes);
  const daysWithData = Math.max(0, Number(totals.daysWithData) || 0);
  const average = daysWithData ? Math.round(active / daysWithData) : 0;
  const dates =
    from && to && from <= to
      ? eachDay(from, to).filter(
          (date) => isWorkingDay(date, workingDays) || byDate.has(date) || date === today,
        )
      : [];
  const bars =
    dates.length > MAX_DAY_BARS ? weekBars(dates, byDate, today) : dayBars(dates, byDate, today);
  const max = Math.max(60, ...bars.map((bar) => bar.active + bar.idle + bar.locked));
  return {
    hasData: active + idle + locked > 0,
    daysWithData,
    daysText: `${daysWithData} ${plural(daysWithData, 'day')} with data`,
    stats: [
      { key: 'active', value: formatDuration(active), label: 'Total active' },
      {
        key: 'average',
        value: daysWithData ? formatDuration(average) : '—',
        label: 'Daily average',
      },
      { key: 'idle', value: formatDuration(idle), label: 'Idle' },
      { key: 'locked', value: formatDuration(locked), label: 'Locked' },
    ],
    bars,
    max,
    weekly: dates.length > MAX_DAY_BARS,
  };
}

/** 'Active means mouse or keyboard use in the last 5 minutes while Daybook is open. …' */
export function measuredText(idleMinutes) {
  const minutes = Math.max(1, Math.round(Number(idleMinutes) || 5));
  const window = minutes === 1 ? 'the last minute' : `the last ${minutes} minutes`;
  return `Active means mouse or keyboard use in ${window} while Daybook is open. Apps and websites are never recorded.`;
}
