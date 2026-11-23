// The checks of a holiday write (CONTRACT 25, item 6, Limits): the dates a holiday can be on
// (last year to next year), the name (2 to 80 characters), at most 60 a year, and one holiday
// per date (the unique key's errno 1062 answers CONFLICT on the date).
import { AppError, validationError } from '@/lib/errors';
import { formatDayShort } from '@/lib/time';
import * as writeRepo from './calendarWriteRepo';

/** The most holidays one calendar year may have. */
export const HOLIDAYS_PER_YEAR = 60;
const DUPLICATE = 1062;

const NAME_MESSAGE = 'Name the holiday (2 to 80 characters).';

function fieldError(field, message) {
  return validationError({ [field]: message }, message);
}

/**
 * The years holidays can be on: from 1 January of last year to 31 December of next year.
 * @param {string} today 'YYYY-MM-DD' (company date)
 * @returns {{ firstYear: number, lastYear: number, from: string, to: string, message: string }}
 */
export function holidayWindow(today) {
  const year = Number(today.slice(0, 4));
  return {
    firstYear: year - 1,
    lastYear: year + 1,
    from: `${year - 1}-01-01`,
    to: `${year + 1}-12-31`,
    message: `Pick a date from 1 Jan ${year - 1} to 31 Dec ${year + 1}.`,
  };
}

/** The date, or VALIDATION_FAILED on `date` outside the window. */
export function checkHolidayDate(date, today) {
  const window = holidayWindow(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) throw fieldError('date', 'Pick a date.');
  if (date < window.from || date > window.to) throw fieldError('date', window.message);
  return date;
}

/** The trimmed name, or VALIDATION_FAILED on `name`. */
export function checkHolidayName(name) {
  const text = String(name ?? '').trim();
  if (text.length < 2 || text.length > 80) throw fieldError('name', NAME_MESSAGE);
  return text;
}

/** NOT_FOUND for a holiday id that isn't there (any more). */
export function holidayGone() {
  return new AppError('NOT_FOUND', { message: 'That holiday no longer exists.' });
}

function clashError(date) {
  const message = `There's already a holiday on ${formatDayShort(date)}.`;
  return new AppError('CONFLICT', { message, fields: { date: message } });
}

/** Runs a holiday insert or update; the unique key's errno 1062 becomes CONFLICT on `date`. */
export async function savingHolidayOn(date, run) {
  try {
    return await run();
  } catch (error) {
    if (error?.errno === DUPLICATE) throw clashError(date);
    throw error;
  }
}

/** VALIDATION_FAILED when the date's year already has 60 holidays (other than `excludeId`). */
export async function checkYearRoom(date, trx, excludeId) {
  const year = date.slice(0, 4);
  const count = await writeRepo.countHolidaysBetween(
    { from: `${year}-01-01`, to: `${year}-12-31`, excludeId },
    trx,
  );
  if (count >= HOLIDAYS_PER_YEAR) {
    throw fieldError('date', `A year can have up to ${HOLIDAYS_PER_YEAR} holidays.`);
  }
}
