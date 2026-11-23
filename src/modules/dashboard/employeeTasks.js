// "Tasks to watch" on the Employee detailed view (artboard 06, build guide 7.5): how many working
// days a task has been in progress and whether it is stuck. Company holidays aren't working days
// (CONTRACT 25); leave doesn't change a task's age.
import { isWorkingDay, workingDaysBetween } from '@/lib/time';
import { plural } from '@/lib/text';
import { attendance } from '@/modules/attendance';

// Tasks in progress this many working days (after the first) are listed even before they are
// stuck, as on the canvas ("In progress 3 days" in grey).
const WATCH_AFTER_DAYS = 2;

/**
 * Working days a task has been in progress, counting the day it was first reported (the canvas
 * shows "In progress 6 days" for a task first reported on Wed 23 and viewed on Wed 30). Company
 * holidays (`holidays`: a Set or array of dates, optional) aren't working days (CONTRACT 25);
 * leave doesn't change a task's age.
 */
export function daysInProgress(firstReportedOn, today, workingDays, holidays) {
  if (!firstReportedOn || firstReportedOn > today) return 0;
  const first = isWorkingDay(firstReportedOn, workingDays, holidays) ? 1 : 0;
  return workingDaysBetween(firstReportedOn, today, workingDays, holidays) + first;
}

/**
 * Build guide 7.5: a task is stuck when it is still in progress and at least `stuckTaskDays`
 * working days have passed since first_reported_on (the first day itself not counted; company
 * holidays skipped when `holidays` is given, CONTRACT 25).
 */
export function isStuckTask(firstReportedOn, today, workingDays, stuckTaskDays, holidays) {
  if (!firstReportedOn || firstReportedOn > today) return false;
  return workingDaysBetween(firstReportedOn, today, workingDays, holidays) >= stuckTaskDays;
}

/** The company holidays since the oldest task's first report, as a Set (one query, or none). */
export async function holidaysSince(rows, today) {
  const firsts = rows.map((row) => row.firstReportedOn).filter((date) => date && date <= today);
  if (firsts.length === 0) return new Set();
  const from = firsts.reduce((a, b) => (a < b ? a : b));
  const holidays = await attendance.listHolidaysBetween(from, today);
  return new Set(holidays.map((holiday) => holiday.date));
}

/**
 * "Tasks to watch": open tasks in progress for WATCH_AFTER_DAYS working days or more, the stuck
 * ones (stuckTaskDays) flagged, oldest first; company holidays skipped (CONTRACT 25).
 */
export function tasksToWatch(rows, ctx, holidays) {
  const { workingDays, stuckTaskDays } = ctx.settings;
  const listFrom = Math.min(WATCH_AFTER_DAYS, stuckTaskDays);
  const items = rows
    .map((row) => {
      const passed = workingDaysBetween(row.firstReportedOn, ctx.today, workingDays, holidays);
      const days = daysInProgress(row.firstReportedOn, ctx.today, workingDays, holidays);
      return {
        id: row.id,
        title: row.title,
        project: { name: row.projectName, color: row.color },
        firstReportedOn: row.firstReportedOn,
        lastReportedOn: row.workDate,
        passed,
        days,
        stuck: isStuckTask(row.firstReportedOn, ctx.today, workingDays, stuckTaskDays, holidays),
        label: `In progress ${days} ${plural(days, 'day')}`,
      };
    })
    .filter((item) => item.passed >= listFrom)
    .sort((a, b) => b.days - a.days || a.id - b.id);
  return {
    stuckTaskDays,
    subtitle: `In progress for ${stuckTaskDays} ${plural(stuckTaskDays, 'day')} or more are flagged`,
    stuckCount: items.filter((item) => item.stuck).length,
    emptyText: `No task has been in progress for ${listFrom + 1} working days or more.`,
    items: items.map(({ passed: _passed, ...item }) => item),
  };
}
