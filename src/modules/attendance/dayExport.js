// The Excel download for one day (GET /api/attendance/export): one sheet, one row per person the
// viewer may see (listDay()). Durations stay numbers so the sheet can add them up. 1.10 adds seven
// columns at the end, so the existing columns keep their positions (CONTRACT 25).
import { can } from '@/lib/permissions';
import { toLocal } from '@/lib/time';
import { settings } from '@/modules/settings';
import { LEAVE_TYPE_LABELS, PART_LABELS } from './calendar';
import { listDay } from './day';
import * as months from './monthExports';

const WHERE_WORDS = {
  office: 'Office',
  wfh: 'WFH',
  unverified: 'Office (unverified)',
  not_checked_in: 'Not checked in',
  on_leave: 'On leave',
  holiday: 'Holiday',
  day_off: 'Day off',
};

export const CHECKOUT_WORDS = {
  open: 'Open',
  checked_out: 'Checked out',
  missing: 'Missing',
  corrected: 'Corrected',
  auto: 'Auto', // auto check-out when inactive (CONTRACT 19)
};

/** "Working day", "Holiday: Diwali" or "Day off". */
export function dayTypeWords(day) {
  if (day.isWorkingDay) return 'Working day';
  return day.holiday && day.weekday ? `Holiday: ${day.holiday.name}` : 'Day off';
}

/** "Full day", "First half"; for attendance.correct viewers ", casual, paid" after it. */
function leaveWords(leave, detail) {
  if (!leave) return '';
  const part = PART_LABELS[leave.part] ?? PART_LABELS.full;
  if (!detail || !leave.leaveType) return part;
  const type = (LEAVE_TYPE_LABELS[leave.leaveType] ?? '').toLowerCase();
  return `${part}, ${type}, ${leave.paid === false ? 'unpaid' : 'paid'}`;
}

const COLUMNS = [
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Email', key: 'email', width: 28 },
  { header: 'Designation', key: 'designation', width: 22 },
  { header: 'Department', key: 'department', width: 16 },
  { header: 'Where', key: 'where', width: 20 },
  { header: 'Check-in', key: 'checkIn', width: 10 },
  { header: 'Check-out', key: 'checkOut', width: 10 },
  { header: 'Present (hours)', key: 'presentHours', width: 15, numFmt: '0.00' },
  { header: 'Breaks (minutes)', key: 'breakMinutes', width: 16 },
  { header: 'Worked (hours)', key: 'workedHours', width: 15, numFmt: '0.00' },
  { header: 'Late (minutes)', key: 'lateMinutes', width: 14 },
  { header: 'Check-out status', key: 'checkout', width: 16 },
  { header: 'Note', key: 'note', width: 40 },
  // 1.10 (CONTRACT 25), at the end.
  { header: 'Day type', key: 'dayType', width: 22 },
  { header: 'Leave', key: 'leave', width: 22 },
  { header: 'Late this month', key: 'lateNth', width: 15 },
  { header: 'Half day', key: 'halfDay', width: 10 },
  { header: 'Short day', key: 'shortDay', width: 10 },
  { header: 'Left early (minutes)', key: 'leftEarly', width: 18 },
  { header: 'Check-out entered by', key: 'enteredBy', width: 22 },
];

/**
 * The Excel download for a day: one sheet, one row per person the viewer may see.
 * @param {string} workDate
 * @param {{ viewer?: { role: string } }} [options] viewer as for listDay(); the leave's type and
 *   pay only for attendance.correct viewers
 * @returns {Promise<{ filename: string, sheets: object[] }>} input for xlsxResponse()
 */
export async function exportDay(workDate, { viewer } = {}) {
  const [items, current] = await Promise.all([
    listDay(workDate, { viewer, leaveDetail: true }),
    settings.getAll(),
  ]);
  const detail = !viewer || can(viewer, 'attendance.correct');
  const late = items.filter((item) => item.lateMinutes > 0).map((item) => item.user.id);
  const counts = late.length ? await months.lateCountsFor({ date: workDate, userIds: late }) : {};
  const tz = current.timezone;
  // 24-hour clocks: "6:34" alone can't be told from 6:34 AM in a spreadsheet.
  const clock = (at) => (at ? toLocal(at, tz).format('HH:mm') : '');
  const hours = (minutes) => (minutes === null ? null : Math.round((minutes / 60) * 100) / 100);
  const yes = (value) => (value ? 'Yes' : '');
  const rows = items.map((item) => {
    const { user, attendance, where, presentMinutes: present, day, marks } = item;
    return {
      name: user.name,
      email: user.email ?? '',
      designation: user.designation ?? '',
      department: user.departmentName ?? '',
      where: WHERE_WORDS[where] ?? '',
      checkIn: clock(attendance?.checkInAt),
      checkOut: clock(attendance?.checkOutAt),
      presentHours: hours(present),
      breakMinutes: present === null ? null : item.breakMinutes,
      workedHours: hours(item.workedMinutes),
      lateMinutes: attendance ? item.lateMinutes : null,
      checkout: attendance ? CHECKOUT_WORDS[attendance.checkoutStatus] : '',
      note: attendance?.note ?? '',
      dayType: dayTypeWords(day),
      leave: leaveWords(day.leave, detail),
      lateNth: item.lateMinutes > 0 ? (counts?.[user.id]?.nth ?? null) : null,
      halfDay: yes(marks?.halfDay),
      shortDay: yes(marks?.shortDay),
      leftEarly: marks?.leftEarly ? marks.leftEarlyMinutes : null,
      enteredBy: item.checkoutEnteredBy?.name ?? '',
    };
  });
  return {
    filename: `attendance-${workDate}.xlsx`,
    sheets: [{ name: `Attendance ${workDate}`, columns: COLUMNS, rows }],
  };
}
