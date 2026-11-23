// HR's row action (RowAction: add, edit, fix, confirm) for one person and date, shared by the
// Attendance day table and the person month (CONTRACT 25, item 8). Server only (pages call it).
import { formatTime, toLocal } from '@/lib/time';

/** 'HH:mm' in company time for a time input, or null. */
export function clockValue(at, tz) {
  return at ? toLocal(at, tz).format('HH:mm') : null;
}

/**
 * The RowAction for a listDay() item (or any { user, attendance, where } on a date).
 * @param {{ user: { id: number, name: string }, attendance: AttendanceRow | null,
 *   where: string }} item
 * @param {{ date: string, today: string, dayLabel: string, tz: string }} ctx
 * @returns {{ kind: 'add' | 'edit' | 'fix' | 'confirm', row: object }} fix for a missing
 *   check-out, confirm for an unverified office check-in
 */
export function actionFor(item, { date, today, dayLabel, tz }) {
  const base = {
    userId: item.user.id,
    name: item.user.name,
    workDate: date,
    dayLabel,
    isToday: date === today,
  };
  const row = item.attendance;
  if (!row) return { kind: 'add', row: { ...base, location: 'office' } };
  const attendanceRow = {
    ...base,
    attendanceId: row.id,
    checkIn: clockValue(row.checkInAt, tz),
    checkOut: clockValue(row.checkOutAt, tz),
    location: row.location,
    note: row.note,
    checkInText: formatTime(row.checkInAt, tz),
  };
  // A missing check-out gets Fix (the secondary button, as on the Missing check-outs card).
  if (row.checkoutStatus === 'missing')
    return { kind: 'fix', row: { ...attendanceRow, checkOut: null } };
  return { kind: item.where === 'unverified' ? 'confirm' : 'edit', row: attendanceRow };
}
