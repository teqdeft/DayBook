// Loads and shapes one person's month for HR (CONTRACT 25, item 8): the profile card's six
// numbers, the "Each day" rows, the calendar (dashboard.buildCalendar with the payroll month's
// range and tones) and the changes. Server only (page.js calls it). The attendance module never
// builds the calendar itself (no module cycle).
import { notFound } from 'next/navigation';
import { OFF_LEGEND } from '@/components/MonthCalendar';
import { isAppError } from '@/lib/errors';
import {
  formatDateLong,
  formatDayShort,
  formatDuration,
  formatTimeAmPm,
  trimNumber,
  workDate as localDate,
} from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { dashboard } from '@/modules/dashboard';
import { settings } from '@/modules/settings';
import { subtitleOf, switcherOf } from '../../month/monthWords';
import { dayRows } from './personDayRows';

/** The calendar legend: "Absent" for the missing tone on HR's person month. */
const LEGEND = [
  { tone: 'office', label: 'Office' },
  { tone: 'wfh', label: 'WFH' },
  { tone: 'late', label: 'Late' },
  { tone: 'missing', label: 'Absent' },
  ...OFF_LEGEND,
];

async function load(viewer, userId, month) {
  try {
    return await attendance.getPersonMonth({ viewer, userId, month });
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

/** The six numbers of the profile card. */
function statsOf(totals, period) {
  const late = totals.lateDays ? `Late days, ${formatDuration(totals.lateMinutes)}` : 'Late days';
  const shortDays = totals.halfDays + totals.shortDays;
  return [
    {
      key: 'present',
      value: trimNumber(totals.presentDays),
      small: period.isCurrent
        ? ` of ${totals.workingDaysSoFar} so far`
        : ` of ${totals.workingDays}`,
      label: 'Days present',
    },
    { key: 'leave', value: trimNumber(totals.leave.total), label: 'Leave days' },
    { key: 'absent', value: trimNumber(totals.absentDays), label: 'Absent days' },
    { key: 'late', value: String(totals.lateDays), label: late },
    {
      key: 'short',
      value: String(shortDays),
      label: totals.leftEarlyDays ? `Short days, ${totals.leftEarlyDays} left early` : 'Short days',
    },
    { key: 'worked', value: formatDuration(totals.workedMinutes), label: 'Worked' },
  ];
}

/** "Frontend developer, Engineering", the shift, and "Joined 12 March 2024" or "Left on …". */
function profileOf(person) {
  let since = null;
  if (person.leftOn) since = `Left on ${formatDayShort(person.leftOn)}`;
  else if (person.joinedOn) since = `Joined ${formatDateLong(person.joinedOn)}`;
  return {
    role: [person.designation, person.departmentName].filter(Boolean).join(', ') || null,
    shift: person.shift,
    since,
  };
}

/** 'vishal-saini' (the month Excel's file name for one person). */
function slug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A change's lines: "Reason: …", "HR note: …" and the time ("by Daybook, Mon, 2 Nov, …"). */
function changeOf(change, tz) {
  const when = `${formatDayShort(localDate(tz, change.at))}, ${formatTimeAmPm(change.at, tz)}`;
  return {
    id: change.id,
    title: change.title,
    details: change.details,
    reason: change.reason ? `Reason: ${change.reason}` : null,
    note: change.note ? `HR note: ${change.note}` : null,
    time: change.byLine ? `by ${change.actor?.name ?? 'Daybook'}, ${when}` : when,
  };
}

/**
 * One person's month for the page.
 * @param {{ viewer: object, userId: number, month?: string }} input
 */
export async function loadPersonMonth({ viewer, userId, month }) {
  const [data, current] = await Promise.all([load(viewer, userId, month), settings.getAll()]);
  const { period, person, totals } = data;
  const tz = current.timezone;
  const base = `/attendance/people/${person.id}`;
  const calendar = dashboard.buildCalendar({
    month: period.month,
    attendance: [],
    profile: {
      joinedOn: person.joinedOn,
      deactivatedOn: person.leftOn,
      tracksAttendance: person.tracksAttendance,
    },
    ctx: { settings: { workingDays: current.workingDays }, today: data.today },
    range: { from: period.from, to: period.to },
    toneOf: (date) => data.tones[date],
  });
  return {
    person,
    period,
    subtitle: subtitleOf(period),
    breadcrumb: [
      { label: 'Attendance', href: '/attendance' },
      { label: period.label, href: `/attendance/month?month=${period.month}` },
      { label: person.name },
    ],
    switcher: switcherOf(period, (value) => `${base}?month=${value}`),
    exportHref: `/api/attendance/month/export?month=${period.month}&userId=${person.id}`,
    exportName: `attendance-${period.month}-${slug(person.name)}.xlsx`,
    profile: profileOf(person),
    stats: statsOf(totals, period),
    days: dayRows(data, { tz, current, viewer }),
    canChange: data.canChange,
    calendar: { weeks: calendar.weeks, weekdays: calendar.weekdays, legend: LEGEND },
    calendarSubtitle: period.rangeLabel ?? period.label,
    changes: data.changes.map((change) => changeOf(change, tz)),
    changesMore: data.changesMore,
    untracked: data.untracked,
    needsUpdate: !data.available.holidays,
  };
}
