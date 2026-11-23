// Loads and shapes the Attendance page (artboard 09). Server only (called from page.js). Every read
// passes the viewer: HR and PMs never see an Admin's attendance (company rule). HR and Admins also
// get the work-from-home requests card (CONTRACT 17, wfhCard.js), and in 1.10 (CONTRACT 25) the
// leave type and pay, reminders, "4th this month", Needs a look and the leave coming up. The rows
// and number cards are built in dayRows.js.
import { can } from '@/lib/permissions';
import { addDays, formatDayShort, isoWeekday, workDate as localDate } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { FILTERS } from '@/modules/attendance/schemas';
import { settings } from '@/modules/settings';
import { kpis, pillsFor, tableRow } from './dayRows';
import { loadRemindData } from './remindData';
import { clockValue } from './rowActions';
import { handledSinceFor, wfhCard } from './wfhCard';

export { FILTERS };

const UPCOMING_DAYS = 7;
const HOLIDAY_DAYS = 60;

/** The side card "Missing check-outs": up to 5 rows, Fix for HR (not their own). */
function missingCard(missing, { canCorrect, viewerId, tz, today }) {
  return {
    total: missing.total,
    items: missing.items.map((row) => ({
      id: row.id,
      // Artboard 09 writes "Priya Sharma, Fri 13 Nov" here (CONTRACT 25, item 7).
      title: `${row.user.name}, ${formatDayShort(row.workDate).replace(',', '')}`,
      suggestedAt: row.suggestedAt ?? null,
      pendingCorrection: row.pendingCorrection ?? null,
      reminded: row.reminded ?? null,
      action:
        canCorrect && row.userId !== viewerId
          ? {
              kind: 'fix',
              row: {
                attendanceId: row.id,
                userId: row.userId,
                name: row.user.name,
                workDate: row.workDate,
                dayLabel: formatDayShort(row.workDate),
                checkIn: clockValue(row.checkInAt, tz),
                checkOut: row.suggestedAt ? clockValue(row.suggestedAt, tz) : null,
                location: row.location,
                isToday: row.workDate === today,
              },
            }
          : null,
    })),
  };
}

/** The "Leave and holidays" side card (LeaveCard, builder F). */
function leaveCard({ date, today, onLeave, upcoming, holiday, canCorrect, available }) {
  return {
    date,
    isToday: date === today,
    title: date === today ? 'On leave today' : `On leave, ${formatDayShort(date)}`,
    items: onLeave,
    upcoming: canCorrect ? upcoming : [],
    nextHoliday: holiday,
    canCorrect,
    available,
  };
}

/** The HR-only reads: reminders, Needs a look and the leave coming up. */
function hrReads({ canCorrect, viewer, items, date, today, current }) {
  if (!canCorrect) return [new Map(), null, []];
  const tomorrow = addDays(today, 1);
  return Promise.all([
    loadRemindData({ items, date, today, viewer, settings: current }),
    attendance.getNeedsLook({ viewer }),
    attendance.listUpcomingLeave({
      viewer,
      from: tomorrow,
      to: addDays(today, UPCOMING_DAYS),
      limit: 5,
    }),
  ]);
}

/**
 * @param {{ user: object, date?: string, filter?: string }} input from the URL
 */
export async function loadAttendance({ user, date: asked, filter: askedFilter }) {
  const current = await settings.getAll();
  const tz = current.timezone;
  const today = localDate(tz);
  const date = await attendance.resolveDate(asked);
  const filter = FILTERS.includes(askedFilter) ? askedFilter : 'all';
  const canCorrect = can(user, 'attendance.correct');
  const viewer = user;
  const calendar = await attendance.loadCalendar({ from: date, to: date, leaveDetail: canCorrect });
  const items = await attendance.listDay(date, { viewer, calendar, leaveDetail: canCorrect });
  const lateIds = items.filter((item) => item.lateMinutes > 0).map((item) => item.user.id);
  const [summary, corrections, missing, wfh, wfhWaiting, lateCounts, onLeave, holiday, hr] =
    await Promise.all([
      attendance.getDaySummary(date, { items, viewer }),
      canCorrect ? attendance.listCorrections({ status: 'pending', limit: 20, viewer }) : null,
      attendance.listMissingCheckouts({ limit: 5, viewer, suggest: canCorrect }),
      // Pending requests, then the ones handled in the last 7 days (whatever day is shown).
      canCorrect
        ? attendance.listWfhRequests({ viewer, handledSince: handledSinceFor(today), limit: 30 })
        : null,
      canCorrect ? attendance.countPendingWfh({ viewer }) : 0,
      lateIds.length ? attendance.lateCountsFor({ date, userIds: lateIds }) : {},
      attendance.listOnLeave(date, { viewer }),
      attendance.nextHoliday(addDays(today, 1), { withinDays: HOLIDAY_DAYS }),
      hrReads({ canCorrect, viewer, items, date, today, current }),
    ]);
  const [remind, needsLook, upcoming] = hr;
  const ctx = {
    date,
    today,
    dayLabel: formatDayShort(date),
    tz,
    canCorrect,
    viewerId: user.id,
    month: attendance.payrollMonthOf(date, current.payrollMonthStartDay),
    lateCounts,
    remind,
    calendarAvailable: calendar.available,
  };
  const rows = attendance.filterDay(items, filter).map((item) => tableRow(item, ctx));
  return {
    tz,
    today,
    date,
    filter,
    canCorrect,
    summary,
    kpis: kpis(summary, date),
    pills: pillsFor({ summary, date, today, filter }),
    day: {
      date,
      weekday: current.workingDays.includes(isoWeekday(date)),
      isWorkingDay: calendar.isWorkingDay(date),
      holiday: calendar.holidayOn(date),
    },
    rows,
    // Remind all (builder D) for the Not checked in and On break filters on today.
    remindAll: remindAllFor({ rows, filter, isToday: date === today, canCorrect }),
    wfh: wfhCard(wfh, wfhWaiting, { viewer, tz, today }),
    corrections: corrections && {
      total: corrections.total,
      items: corrections.items.map((item) => ({ ...item, own: item.userId === user.id })),
    },
    missing: missingCard(missing, { canCorrect, viewerId: user.id, tz, today }),
    needsLook,
    leave: leaveCard({
      date,
      today,
      onLeave,
      upcoming,
      holiday,
      canCorrect,
      available: calendar.available,
    }),
    prevDate: addDays(date, -1),
    nextDate: date < today ? addDays(date, 1) : null,
  };
}

const REMIND_ALL_KINDS = { not_checked_in: 'check_in', on_break: 'break' };

/** The people "Remind all (3)" sends to: listed rows whose menu offers that remind now. */
function remindAllFor({ rows, filter, isToday, canCorrect }) {
  const kind = REMIND_ALL_KINDS[filter];
  if (!canCorrect || !isToday || !kind) return null;
  const users = rows
    .filter((row) => row.menu?.remind?.kind === kind)
    .map((row) => row.menu.remind.user);
  return { kind, users };
}
