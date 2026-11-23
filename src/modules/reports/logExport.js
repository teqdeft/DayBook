// The My log Excel download (GET /api/me/log?format=xlsx): one sheet of days, one of tasks. The
// days end with "Day type" and "Leave" (CONTRACT 25): the person's own leave type and pay, never
// HR's note.
import { formatDayShort, toLocal } from '@/lib/time';

export const LOG_STATUS_LABELS = {
  submitted: 'Submitted',
  locked: 'Locked',
  edit_requested: 'Edit requested',
  draft: 'Draft',
  not_started: 'Not started',
  missing: 'Missing',
  not_checked_in: 'Not checked in',
  holiday: 'Holiday',
  on_leave: 'On leave',
};

const PART_WORDS = { full: 'Full day', first_half: 'First half', second_half: 'Second half' };
const TYPE_WORDS = { casual: 'casual', sick: 'sick', other: 'other' };

/** 'Working day', 'Holiday: Diwali' or 'Day off' (the Attendance Excel's words). */
function dayType(day) {
  if (day.holiday) return `Holiday: ${day.holiday.name}`;
  return day.isWorkingDay ? 'Working day' : 'Day off';
}

/** 'Full day, casual, paid' / 'First half, sick, unpaid', blank without leave. */
function leaveWords(leave) {
  if (!leave) return '';
  const part = PART_WORDS[leave.part] ?? PART_WORDS.full;
  const type = TYPE_WORDS[leave.leaveType] ?? 'casual';
  return `${part}, ${type}, ${leave.paid === false ? 'unpaid' : 'paid'}`;
}

const LOCATION_LABELS = { office: 'Office', wfh: 'WFH' };
const TASK_STATUS_LABELS = { done: 'Done', in_progress: 'In progress', blocked: 'Blocked' };

/** '18:34' (24-hour, so a spreadsheet reads it without AM/PM). */
const clock = (at, tz) => (at ? toLocal(at, tz).format('HH:mm') : '');

const hours = (minutes) => Math.round(((Number(minutes) || 0) / 60) * 100) / 100;

/**
 * The workbook spec for xlsxResponse() from a getMonthLog() result.
 * @param {object} log getMonthLog() result
 * @returns {{ filename: string, sheets: object[] }}
 */
export function monthLogWorkbook(log) {
  const tz = log.timezone;
  const days = [...log.days].reverse();
  const dayRows = days.map((day) => ({
    date: day.date,
    day: formatDayShort(day.date),
    where: day.attendance ? (LOCATION_LABELS[day.attendance.location] ?? '') : '',
    checkIn: day.attendance ? clock(day.attendance.checkInAt, tz) : '',
    checkOut: day.attendance?.checkOutAt ? clock(day.attendance.checkOutAt, tz) : '',
    lateMinutes: day.attendance ? day.attendance.lateMinutes : '',
    present: day.attendance ? hours(day.presentMinutes) : '',
    logged: day.report ? hours(day.report.totalMinutes) : '',
    // Only the projects worked on: a planned one (0 minutes, CONTRACT 24) has no hours.
    projects: (day.report?.entries ?? [])
      .filter((entry) => entry.minutes > 0)
      .map((entry) => entry.projectName)
      .join(', '),
    report: LOG_STATUS_LABELS[day.status] ?? day.status,
    dayType: dayType(day),
    leave: leaveWords(day.leave),
  }));
  const taskRows = days.flatMap((day) =>
    (day.report?.entries ?? []).flatMap((entry) =>
      entry.tasks.map((task, index) => ({
        date: day.date,
        project: entry.projectName,
        hours: index === 0 && entry.minutes > 0 ? hours(entry.minutes) : '',
        task: task.title,
        status: TASK_STATUS_LABELS[task.status] ?? task.status,
        report: day.report.status === 'submitted' ? 'Submitted' : 'Draft',
      })),
    ),
  );
  return {
    filename: `daybook-my-log-${log.month}.xlsx`,
    sheets: [
      {
        name: 'Days',
        columns: [
          { header: 'Date', key: 'date', width: 12 },
          { header: 'Day', key: 'day', width: 13 },
          { header: 'Where', key: 'where', width: 9 },
          { header: 'Check-in', key: 'checkIn', width: 10 },
          { header: 'Check-out', key: 'checkOut', width: 10 },
          { header: 'Late (min)', key: 'lateMinutes', width: 10 },
          { header: 'Present (h)', key: 'present', width: 11, numFmt: '0.00' },
          { header: 'Logged (h)', key: 'logged', width: 11, numFmt: '0.00' },
          { header: 'Projects', key: 'projects', width: 36 },
          { header: 'Report', key: 'report', width: 15 },
          { header: 'Day type', key: 'dayType', width: 24 },
          { header: 'Leave', key: 'leave', width: 24 },
        ],
        rows: dayRows,
      },
      {
        name: 'Tasks',
        columns: [
          { header: 'Date', key: 'date', width: 12 },
          { header: 'Project', key: 'project', width: 22 },
          { header: 'Hours', key: 'hours', width: 8, numFmt: '0.00' },
          { header: 'Task', key: 'task', width: 60 },
          { header: 'Status', key: 'status', width: 12 },
          { header: 'Report', key: 'report', width: 11 },
        ],
        rows: taskRows,
      },
    ],
  };
}
