// Cron ticks run in UTC; jobs decide in company time. Settings are read on every tick, so an Admin
// change (time zone, reminder time, working days) applies within a minute without a restart.
import { clockToMinutes, isWorkingDay, now, toLocal } from '@/lib/time';
import { settings } from '@/modules/settings';

/**
 * The company's local date and time right now.
 * @returns {Promise<{ settings: Awaited<ReturnType<typeof settings.getAll>>, date: string,
 *   minutes: number, workingDay: boolean }>} minutes after local midnight
 */
export async function companyNow() {
  const current = await settings.getAll();
  const local = toLocal(now(), current.timezone);
  const date = local.format('YYYY-MM-DD');
  return {
    settings: current,
    date,
    minutes: local.hour() * 60 + local.minute(),
    workingDay: isWorkingDay(date, current.workingDays),
  };
}

/** True when `minutes` (after local midnight) is at or after a 'HH:mm' clock time. */
export function isAtOrAfter(minutes, clock) {
  return minutes >= clockToMinutes(clock);
}
