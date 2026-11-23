// Cron ticks run in UTC; jobs decide in company time. Settings are read on every tick, so an Admin
// change (time zone, reminder time, working days) applies within a minute without a restart. A
// company holiday is not a working day (CONTRACT 25): the company's day is cached 30 s per
// process, so a holiday added in the web process reaches the worker within 30 s.
import { clockToMinutes, now, toLocal } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { settings } from '@/modules/settings';

/**
 * The company's local date and time right now.
 * @returns {Promise<{ settings: Awaited<ReturnType<typeof settings.getAll>>, date: string,
 *   minutes: number, workingDay: boolean, holiday: { id: number, name: string } | null }>}
 *   minutes after local midnight; workingDay is false on a holiday (null before migration 018)
 */
export async function companyNow() {
  const current = await settings.getAll();
  const local = toLocal(now(), current.timezone);
  const date = local.format('YYYY-MM-DD');
  const day = await attendance.companyDay(date);
  return {
    settings: current,
    date,
    minutes: local.hour() * 60 + local.minute(),
    workingDay: day.isWorkingDay,
    holiday: day.holiday,
  };
}

/** True when `minutes` (after local midnight) is at or after a 'HH:mm' clock time. */
export function isAtOrAfter(minutes, clock) {
  return minutes >= clockToMinutes(clock);
}
