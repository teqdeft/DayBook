// Loads and shapes the month view (CONTRACT 25, item 4): the payroll month's top bar, the five
// number cards, the filter pills and one row per person. Server only (page.js calls it). Day
// counts may be halves ("19.5"); durations read as hours and minutes ("152h 30m").
import { formatDayShort, formatDuration, formatMonth, trimNumber } from '@/lib/time';
import { plural } from '@/lib/text';
import { attendance } from '@/modules/attendance';
import { MONTH_FILTERS } from '@/modules/attendance/monthSchemas';
import { switcherOf, subtitleOf } from './monthWords';

const PILL_LABELS = {
  all: 'All',
  needs_look: 'Needs a look',
  late: 'Late',
  short: 'Short days',
  absent: 'Absent',
  leave: 'On leave',
  missing: 'Missing check-outs',
};

/** '/attendance/month?month=2026-11&filter=late' (the month always kept, "all" left out). */
export function monthHref({ month, filter }) {
  const params = new URLSearchParams({ month });
  if (filter && filter !== 'all') params.set('filter', filter);
  return `/attendance/month?${params}`;
}

const num = (value) => trimNumber(value ?? 0);
/** "1 day", "0.5 day", "1.5 days" (halves read as one day's words). */
const days = (value) => `${num(value)} ${value > 1 ? 'days' : 'day'}`;
const people = (count) => `${count} ${plural(count, 'person', 'people')}`;
const pct = (part, all) => (all > 0 ? Math.min(100, (part / all) * 100) : 0);

/** The five number cards (people = everyone listed, whatever the filter). */
function monthKpis({ totals, counts, period }) {
  const all = counts.all;
  const holidays = totals.holidays
    ? `${totals.holidays} ${plural(totals.holidays, 'holiday')}`
    : 'no holidays';
  return [
    {
      label: 'Working days',
      value: totals.workingDays,
      sub: period.isCurrent ? `${totals.workingDaysSoFar} so far, ${holidays}` : holidays,
      percent: pct(totals.workingDaysSoFar, totals.workingDays),
      color: 'primary',
    },
    {
      label: 'Late days',
      value: totals.lateDays,
      sub: `by ${people(totals.latePeople)}`,
      percent: pct(totals.latePeople, all),
      color: 'marigold',
    },
    {
      label: 'Short days',
      value: totals.shortDays,
      sub: `${totals.leftEarlyDays} left early`,
      percent: pct(counts.short, all),
      color: 'marigold',
    },
    {
      label: 'Leave',
      value: num(totals.leaveDays),
      sub: totals.unpaidLeaveDays > 0 ? `${num(totals.unpaidLeaveDays)} unpaid` : 'all paid',
      percent: pct(counts.leave, all),
      color: 'teal',
    },
    {
      label: 'Absent',
      value: num(totals.absentDays),
      sub: `by ${people(totals.absentPeople)}`,
      percent: pct(totals.absentPeople, all),
      color: 'red',
    },
  ];
}

const joinParts = (parts, separator) => parts.filter(Boolean).join(separator) || null;

function presentOf(person, isCurrent) {
  return {
    value: num(person.presentDays),
    of: isCurrent
      ? `of ${person.workingDaysSoFar} days so far`
      : `of ${person.workingDays} ${plural(person.workingDays, 'day')}`,
    split: joinParts(
      [
        person.officeDays > 0 ? `${num(person.officeDays)} office` : null,
        person.wfhDays > 0 ? `${num(person.wfhDays)} WFH` : null,
      ],
      ' · ',
    ),
    daysOff: person.daysOffWorked > 0 ? `+${days(person.daysOffWorked)} off` : null,
    holidays:
      person.holidays > 0 ? `${person.holidays} ${plural(person.holidays, 'holiday')}` : null,
  };
}

function leaveOf({ leave }) {
  if (!(leave.total > 0) && !(leave.planned > 0)) return null;
  return {
    value: num(leave.total),
    split: joinParts(
      [
        leave.paid > 0 ? `${num(leave.paid)} paid` : null,
        leave.unpaid > 0 ? `${num(leave.unpaid)} unpaid` : null,
      ],
      ', ',
    ),
    planned: leave.planned > 0 ? `${days(leave.planned)} planned` : null,
  };
}

function shortOf(person) {
  const total = person.halfDays + person.shortDays;
  if (total === 0 && person.leftEarlyDays === 0) return null;
  return {
    value: String(total),
    half: person.halfDays > 0 ? `${person.halfDays} ${plural(person.halfDays, 'half day')}` : null,
    early: person.leftEarlyDays > 0 ? `${person.leftEarlyDays} left early` : null,
  };
}

function checkoutsOf(person) {
  const lines = {
    missing: person.missingCheckouts > 0 ? `${person.missingCheckouts} missing` : null,
    notFixed: person.missingNotFixed > 0 ? `${person.missingNotFixed} not fixed` : null,
    auto: person.autoCheckouts > 0 ? `${person.autoCheckouts} auto` : null,
    self:
      person.selfEnteredCheckouts > 0 ? `${person.selfEnteredCheckouts} entered themselves` : null,
    check: person.selfEnteredPastLastSeen > 0 ? `${person.selfEnteredPastLastSeen} to check` : null,
  };
  return Object.values(lines).some(Boolean) ? lines : null;
}

/** "Joined Wed, 4 Nov" / "Left Tue, 10 Nov" when it falls inside the period. */
function employmentOf(person, period) {
  const inside = (date) => date && date >= period.from && date <= period.to;
  if (inside(person.leftOn)) return `Left ${formatDayShort(person.leftOn)}`;
  if (inside(person.joinedOn)) return `Joined ${formatDayShort(person.joinedOn)}`;
  return null;
}

/** One row of the month table. */
function monthRow(person, period) {
  const { user, reports } = person;
  return {
    id: user.id,
    user,
    personHref: `/attendance/people/${user.id}?month=${period.month}`,
    look: person.needsLook.length
      ? person.needsLook.map((reason) => reason.label).join(' · ')
      : null,
    employment: employmentOf(person, period),
    present: presentOf(person, period.isCurrent),
    leave: leaveOf(person),
    absent: person.absentDays > 0 ? num(person.absentDays) : null,
    late:
      person.lateDays > 0
        ? { value: String(person.lateDays), time: formatDuration(person.lateMinutes) }
        : null,
    short: shortOf(person),
    worked: {
      value: formatDuration(person.workedMinutes),
      breaks: person.breakMinutes > 0 ? `Breaks ${formatDuration(person.breakMinutes)}` : null,
      over:
        person.overAllowanceDays > 0
          ? `Over on ${person.overAllowanceDays} ${plural(person.overAllowanceDays, 'day')}`
          : null,
    },
    checkouts: checkoutsOf(person),
    reports:
      reports && reports.expected > 0
        ? {
            value: `${reports.submitted} of ${reports.expected}`,
            missing: reports.missing > 0 ? `${reports.missing} missing` : null,
          }
        : null,
  };
}

/** "Half day: worked under 4h 30m. Short day: … Holidays and leave are never absent." */
function footLine(rules) {
  const half = rules.halfDayUnderMinutes
    ? `Half day: worked under ${formatDuration(rules.halfDayUnderMinutes)}.`
    : 'Half days are off.';
  const short = rules.shortDayUnderMinutes
    ? `Short day: worked under ${formatDuration(rules.shortDayUnderMinutes)}.`
    : 'Short days are off.';
  const early = rules.leftEarlyGraceMinutes
    ? `Left early: out more than ${formatDuration(rules.leftEarlyGraceMinutes)} before their shift ended.`
    : 'Left early: out before their shift ended.';
  return `${half} ${short} ${early} Worked is present time less breaks. Holidays and leave are never absent.`;
}

function emptyOf(filter, threshold) {
  const lateDays = `${threshold} ${plural(threshold, 'late day')}`;
  const EMPTY = {
    all: ['Nobody tracks attendance yet', 'People who check in show up here.'],
    needs_look: [
      'Nothing stands out',
      `Nobody reached ${lateDays}, short days or missing reports.`,
    ],
    late: ['Nobody was late'],
    short: ['No short days'],
    absent: ['Nobody was absent'],
    leave: ['Nobody took leave'],
    missing: ['No missing check-outs'],
  };
  const [title, body = null] = EMPTY[filter] ?? EMPTY.all;
  return { title, body };
}

/**
 * The month view for HR and Admins.
 * @param {{ user: object, month?: string, filter?: string }} input from the URL
 */
export async function loadMonth({ user, month, filter }) {
  const data = await attendance.getMonth({ viewer: user, month, filter });
  const { period, counts } = data;
  return {
    period,
    filter: data.filter,
    subtitle: subtitleOf(period),
    switcher: switcherOf(period, (value) => monthHref({ month: value, filter: data.filter })),
    exportHref: `/api/attendance/month/export?month=${period.month}`,
    exportName: `attendance-${period.month}.xlsx`,
    kpis: monthKpis({ totals: data.totals, counts, period }),
    title: `Everyone, ${formatMonth(period.month)}`,
    pills: MONTH_FILTERS.map((value) => ({
      value,
      label: `${PILL_LABELS[value]} (${counts[value] ?? 0})`,
      href: monthHref({ month: period.month, filter: value }),
    })),
    allHref: monthHref({ month: period.month }),
    rows: data.people.map((person) => monthRow(person, period)),
    empty: emptyOf(data.filter, data.rules.lateAlertDays),
    foot: footLine(data.rules),
    needsUpdate: !data.available.holidays,
  };
}
