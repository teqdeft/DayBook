// What the morning HR summary and the evening wrap-up say (CONTRACT 25, item 1). The day is read
// once with no viewer (listDay with its calendar), then each recipient's facts keep only the people
// they may see (an Admin's attendance only for an Admin), never the recipient. "Not checked in" is
// the Attendance pill's set, so the summary and the screen agree. Reports are yes or no only.
import { can } from '@/lib/permissions';
import {
  clockToMinutes,
  formatClockShort,
  formatRelativeDay,
  formatTime,
  formatTimeAmPm,
  now,
  toLocal,
} from '@/lib/time';
import { audit } from '@/modules/audit';
import { reports } from '@/modules/reports';
import { settings } from '@/modules/settings';
import { holidaysBefore, loadCalendar } from './calendarReads';
import { listDay, missingWindow } from './day';
import * as hrSummaryRepo from './hrSummaryRepo';
import { listOnLeave } from './leaveReads';
import { showsAttendanceOf } from './rules';

const byName = (a, b) => a.name.localeCompare(b.name);

/** Minutes after local midnight of a moment, in company time. */
function minutesOf(at, tz) {
  const local = toLocal(at, tz);
  return local.hour() * 60 + local.minute();
}

/** Only the people the recipient may see, never the recipient. */
function seenBy(recipient) {
  return (person) =>
    Number(person.id) !== Number(recipient.id) && showsAttendanceOf(recipient, person);
}

async function loadDay(today) {
  const current = await settings.getAll();
  const [calendar, holidays] = await Promise.all([
    loadCalendar({ from: today, to: today }),
    holidaysBefore(today),
  ]);
  const items = await listDay(today, { calendar });
  return {
    today,
    at: now(),
    settings: current,
    items,
    window: missingWindow(today, current.workingDays, holidays),
  };
}

/**
 * The morning's data, read once for every recipient.
 * @param {string} today company date
 */
export async function loadMorning(today) {
  const day = await loadDay(today);
  const [onLeave, missing] = await Promise.all([
    listOnLeave(today),
    hrSummaryRepo.listMissingBetween(day.window.from, day.window.to),
  ]);
  return { ...day, onLeave, missing };
}

/** "from yesterday", "since Friday": the Missing check-out number's words. */
function missingFacts(rows, today) {
  const days = new Set(rows.map((row) => row.workDate));
  const relative = rows[0] ? formatRelativeDay(rows[0].workDate, today) : 'Yesterday';
  const when = ['Yesterday', 'Today'].includes(relative) ? relative.toLowerCase() : relative;
  return {
    count: rows.length,
    names: [...new Set(rows.map((row) => row.name))],
    label: `${days.size > 1 ? 'since' : 'from'} ${when}`,
  };
}

/**
 * One recipient's morning facts (hrSummaryText.morningMessage).
 * @param {Awaited<ReturnType<typeof loadMorning>>} data
 * @param {{ id: number, role: string }} recipient
 * @param {{ corrections: number, wfh: number }} waiting never the recipient's own requests
 */
export function morningFacts(data, recipient, waiting) {
  const tz = data.settings.timezone;
  const seen = seenBy(recipient);
  const items = data.items.filter((item) => seen(item.user));
  const minutes = minutesOf(data.at, tz);
  const waitingFor = (item) => minutes < clockToMinutes(item.day.lateMark);
  const notIn = items.filter((item) => item.where === 'not_checked_in');
  const late = items.filter((item) => item.lateMinutes > 0);
  return {
    date: data.today,
    time: formatTimeAmPm(data.at, tz),
    // Late marks passed first; people whose day starts later after them, with their start.
    notCheckedIn: [
      ...notIn.filter((item) => !waitingFor(item)).map((item) => ({ name: item.user.name })),
      ...notIn.filter(waitingFor).map((item) => ({
        name: item.user.name,
        startsAt: formatClockShort(item.day.expectedStart),
      })),
    ].map((entry) => ({ startsAt: null, ...entry })),
    late: late
      .map((item) => ({ name: item.user.name, minutes: item.lateMinutes }))
      .sort((a, b) => b.minutes - a.minutes || byName(a, b)),
    onLeave: data.onLeave
      .filter((entry) => seen(entry.user))
      .map((entry) => ({ name: entry.user.name, part: entry.part })),
    wfh: items
      .filter(
        (item) =>
          item.attendance?.location === 'wfh' ||
          (item.where === 'not_checked_in' && item.day.wfhApproved),
      )
      .map((item) => item.user.name),
    waiting,
    missing: missingFacts(
      data.missing.filter((row) => seen({ id: row.userId, role: row.role })),
      data.today,
    ),
  };
}

/**
 * The evening's data, read once for every recipient: the day, who submitted a report today, and
 * the auto check-outs from the last working day on (the audit row counts, so a row fixed since
 * still shows; today's are in too, which only exist once auto_checkout_at has passed).
 * @param {string} today company date
 */
export async function loadEvening(today) {
  const day = await loadDay(today);
  const rows = await hrSummaryRepo.listRowsBetween(day.window.from, today);
  const checkedIn = day.items.filter((item) => item.attendance).map((item) => item.user.id);
  const [submitted, audits] = await Promise.all([
    reports.listSubmittedUserIds(checkedIn, today),
    audit.listForEntities({
      entityType: 'attendance',
      entityIds: rows.map((row) => row.id),
      actions: ['attendance.auto_checkout'],
    }),
  ]);
  const autoAt = new Map();
  for (const entry of audits) {
    const id = Number(entry.entityId);
    if (!autoAt.has(id)) autoAt.set(id, entry.after?.checkOutAt ?? null);
  }
  const autos = rows
    .filter((row) => autoAt.has(Number(row.id)) || row.checkoutStatus === 'auto')
    .map((row) => ({ ...row, autoAt: autoAt.get(Number(row.id)) ?? row.checkOutAt }))
    .filter((row) => row.autoAt);
  return { ...day, submitted: new Set(submitted.map(Number)), autos };
}

const isOpen = (row) => Boolean(row) && row.checkoutStatus === 'open' && !row.checkOutAt;

/**
 * One recipient's evening facts (hrSummaryText.eveningMessage).
 * @param {Awaited<ReturnType<typeof loadEvening>>} data
 * @param {{ id: number, role: string }} recipient
 */
export function eveningFacts(data, recipient) {
  const tz = data.settings.timezone;
  const seen = seenBy(recipient);
  const items = data.items.filter((item) => seen(item.user));
  const minutes = minutesOf(data.at, tz);
  const open = items.filter((item) => isOpen(item.attendance));
  const past = open.filter((item) => minutes >= clockToMinutes(item.day.dayEnd));
  return {
    date: data.today,
    time: formatTimeAmPm(data.at, tz),
    stillIn: past.map((item) => ({
      name: item.user.name,
      since: formatTime(item.attendance.checkInAt, tz),
    })),
    onShift: open.length - past.length,
    reportsNotIn: items
      .filter((item) => item.attendance && can(item.user, 'report.self'))
      .filter((item) => !data.submitted.has(Number(item.user.id)))
      .map((item) => item.user.name),
    over: items
      .filter((item) => item.overAllowanceMinutes > 0)
      .map((item) => ({ name: item.user.name, minutes: item.overAllowanceMinutes }))
      .sort((a, b) => b.minutes - a.minutes || byName(a, b)),
    autos: {
      from: data.window.from,
      items: data.autos
        .filter((row) => seen({ id: row.userId, role: row.role }))
        .map((row) => ({
          name: row.name,
          time: formatTimeAmPm(row.autoAt, tz),
          workDate: row.workDate,
        })),
    },
  };
}
