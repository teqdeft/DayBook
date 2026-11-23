// The person month's "Each day" rows (CONTRACT 25, item 8): Day, Where, Check-in with "Late 22m"
// and "4th this month", Out with its tags and "By Priya", Breaks, Worked with Half day or Short
// day, Report (yes or no only, never the content) and HR's RowAction. Server only.
import {
  formatClock,
  formatDayShort,
  formatDuration,
  formatTime,
  formatTimeAmPm,
  workDate as localDate,
} from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { actionFor } from '../../rowActions';

const HALVES = { first_half: 'First half', second_half: 'Second half' };
const ON_LEAVE = {
  full: 'On leave',
  first_half: 'On leave, first half',
  second_half: 'On leave, second half',
};
const STATUS = { absent: 'missing' };
const LABELS = { absent: 'Absent' };

const firstName = (name) =>
  String(name ?? '')
    .trim()
    .split(/\s+/)[0] || name;

/** The Where cell: the status block and its muted line (leave, a check-in on a leave day). */
function whereOf(item) {
  const part = item.leave?.part;
  let line = null;
  if (item.conflict) line = 'Checked in on a leave day';
  else if (item.leave && (item.row || item.where === 'absent')) line = ON_LEAVE[part];
  else if (item.leave) line = HALVES[part] ?? null;
  return { status: STATUS[item.where] ?? item.where, label: LABELS[item.where], line };
}

/** "4th this month" for each late day, counted through the month in order. */
function lateCounts(days, period, threshold) {
  const counts = new Map();
  let nth = 0;
  for (const item of days) {
    if (!(item.lateMinutes > 0)) continue;
    nth += 1;
    const range = period.rangeLabel ? ` (${period.rangeLabel})` : '';
    const ordinal = attendance.ordinal(nth);
    counts.set(item.date, {
      label: `${ordinal} this month`,
      title: `${ordinal} late day in ${period.label}${range}`,
      alert: nth >= threshold,
    });
  }
  return counts;
}

/** The Out cell: time, Auto, "Early 25m", "By Priya", the Check tag, or red Missing. */
function outOf(item, { tz, name }) {
  const { row, marks, checkout } = item;
  if (!row?.checkOutAt) return { missing: checkout.notFixed };
  const entered = checkout.enteredBy;
  let check = null;
  if (entered?.self && checkout.pastLastSeen) {
    const seen = checkout.suggestedAt
      ? `Daybook last saw them working at ${formatTimeAmPm(checkout.suggestedAt, tz)}.`
      : 'Daybook had no sign of work after the check-in.';
    check = `${firstName(name)} entered ${formatTimeAmPm(row.checkOutAt, tz)}. ${seen}`;
  }
  const early = marks.leftEarly ? formatDuration(marks.leftEarlyMinutes) : null;
  return {
    time: formatTime(row.checkOutAt, tz),
    auto: checkout.auto,
    early: early
      ? {
          label: `Early ${early}`,
          title: `Left ${early} before their shift ended at ${formatClock(item.day.dayEnd)}`,
        }
      : null,
    by: entered
      ? {
          name: firstName(entered.name),
          title: entered.at
            ? `${entered.name} entered this check-out on ${formatDayShort(localDate(tz, entered.at))}`
            : entered.name,
        }
      : null,
    check,
  };
}

function reportOf(item, current) {
  if (item.report === 'submitted') return { text: 'Submitted' };
  if (item.report === 'not_submitted') return { text: 'Not submitted', tone: 'red' };
  if (item.report === 'due')
    return { text: `Due ${formatClock(current.reportReminderAt)}`, tone: 'muted' };
  return null;
}

/** The Worked cell's Half day or Short day tag. */
function markOf(item) {
  const { marks } = item;
  if (!marks.halfDay && !marks.shortDay) return null;
  return {
    label: marks.halfDay ? 'Half day' : 'Short day',
    title: `Worked ${formatDuration(item.workedMinutes ?? 0)}, under ${formatDuration(marks.underMinutes ?? 0)}`,
  };
}

/**
 * The rows of the "Each day" table.
 * @param {object} data attendance.getPersonMonth()
 * @param {{ tz: string, current: object, viewer: object }} ctx
 */
export function dayRows(data, { tz, current }) {
  const { person, days, period } = data;
  const nth = lateCounts(days, period, current.lateAlertDays);
  const user = { id: person.id, name: person.name };
  return days.map((item) => {
    const { row } = item;
    const dayLabel = formatDayShort(item.date);
    return {
      id: item.date,
      day: dayLabel,
      daySub: item.isToday ? 'Today' : (item.holiday?.name ?? null),
      where: whereOf(item),
      checkIn: row ? formatTime(row.checkInAt, tz) : null,
      late: item.lateMinutes > 0 ? `Late ${formatDuration(item.lateMinutes)}` : null,
      lateCount: nth.get(item.date) ?? null,
      out: row ? outOf(item, { tz, name: person.name }) : null,
      breaks:
        row && item.breakMinutes > 0
          ? {
              text: formatDuration(item.breakMinutes),
              over:
                item.overAllowanceMinutes > 0
                  ? `Over ${formatDuration(item.overAllowanceMinutes)}`
                  : null,
              button: { attendanceId: row.id, user, presentTitle: null },
            }
          : null,
      worked: item.workedMinutes === null ? null : formatDuration(item.workedMinutes),
      mark: markOf(item),
      report: reportOf(item, current),
      action: data.canChange
        ? actionFor(
            { user, attendance: row, where: item.where },
            { date: item.date, today: data.today, dayLabel, tz },
          )
        : null,
    };
  });
}
