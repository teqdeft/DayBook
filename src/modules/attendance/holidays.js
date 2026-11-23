// Company holidays (CONTRACT 25, item 6): one company-wide date with a name, the same for
// everyone. A holiday on a weekday is not a working day: no late marks, no "Not checked in", no
// reminders. Each write is one transaction with the day rules around it (the attendance rows of
// that date get their working-day flag and late minutes worked out again, audited per row); after
// the commit the caches are cleared in this process, the rows a check-in created meanwhile are
// re-checked, and a change to today or an earlier day tells the Admins and the people whose late
// mark changed (holidayNotices.js). Before migration 018 the list reads as unavailable and every
// write answers UPDATE_NEEDED.
import { logger } from '@/lib/logger';
import { formatDayShort, isoWeekday, nowDate, workDate as localDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { settings } from '@/modules/settings';
import { afterCalendarWrite, distinctScopes, mergeChanged, withDayRules } from './calendarEffects';
import * as calendarRepo from './calendarRepo';
import * as writeRepo from './calendarWriteRepo';
import { tellHolidayChange } from './holidayNotices';
import {
  checkHolidayDate as checkDate,
  checkHolidayName as checkName,
  checkYearRoom,
  holidayGone as goneError,
  holidayWindow,
  savingHolidayOn as savingOn,
} from './holidayRules';
import { guard018Read, guard018Write } from './migration018';
import * as repo from './repo';
import { nowToSecond } from './rules';

/** The year a list shows: the asked one within the window, else this year (or the nearest end). */
function shownYear(year, window, today) {
  const asked = Number(year);
  if (!Number.isInteger(asked)) return Number(today.slice(0, 4));
  return Math.min(Math.max(asked, window.firstYear), window.lastYear);
}

/**
 * The holidays of one year (the Holidays page, GET /api/holidays).
 * @param {{ year?: number }} [input] a year outside last year to next year reads as the nearest
 *   one; none = this year (company time)
 * @returns {Promise<{ year: number, available: boolean, items: Array<{ id: number, date: string,
 *   name: string, dayLabel: string, weekday: boolean, past: boolean, today: boolean }>,
 *   upcoming: number, today: string, firstYear: number, lastYear: number }>} weekday = the
 *   date's weekday is one the company works (else the holiday changes nothing); upcoming = how
 *   many are still to come (after today); available is false before migration 018
 */
export async function listHolidays({ year } = {}) {
  const current = await settings.getAll();
  const today = localDate(current.timezone);
  const window = holidayWindow(today);
  const shown = shownYear(year, window, today);
  const rows = await guard018Read(
    'calendar',
    () => calendarRepo.listHolidays(`${shown}-01-01`, `${shown}-12-31`),
    () => null,
  );
  const items = (rows ?? []).map((row) => ({
    id: row.id,
    date: row.date,
    name: row.name,
    dayLabel: formatDayShort(row.date),
    weekday: current.workingDays.includes(isoWeekday(row.date)),
    past: row.date < today,
    today: row.date === today,
  }));
  return {
    year: shown,
    available: rows !== null,
    items,
    upcoming: items.filter((item) => item.date > today).length,
    today,
    firstYear: window.firstYear,
    lastYear: window.lastYear,
  };
}

/** The company date today. */
async function companyToday() {
  return localDate((await settings.getAll()).timezone);
}

/**
 * After the commit: clears the caches, re-checks the rows created meanwhile and tells who needs to
 * know. The holiday is saved by then, so a failed notification is logged, never answered.
 */
async function afterWrite({ actor, verb, date, scopes, since, changed, today }) {
  const rechecked = await afterCalendarWrite({ scopes, since, holidays: true });
  try {
    await tellHolidayChange({
      actor,
      verb,
      date,
      dates: scopes.map((scope) => scope.from),
      today,
      changed: mergeChanged(changed, rechecked),
      reason: scopes[0]?.reason ?? '',
    });
  } catch (error) {
    logger.error({ err: error, date }, 'holiday change notifications failed');
  }
}

/**
 * HR or an Admin adds a holiday (POST /api/holidays). The day rules remove the late marks of that
 * day's check-ins (and set their working-day flag to 0), each change audited.
 * @param {{ actor: { id: number, name: string }, date: string, name: string,
 *   ip?: string | null }} input
 * @returns {Promise<{ id: number, date: string, name: string }>}
 * @throws VALIDATION_FAILED (date outside last year to next year, name not 2 to 80 characters, a
 *   61st holiday in a year), CONFLICT (that date has a holiday), UPDATE_NEEDED (before 018)
 */
export async function createHoliday({ actor, date, name, ip }) {
  const today = await companyToday();
  checkDate(date, today);
  const clean = checkName(name);
  const since = nowToSecond();
  const scopes = [{ from: date, to: date, reason: `Holiday added: ${clean}`, actorId: actor.id }];
  const { result: id, changed } = await guard018Write('calendar', () =>
    repo.transaction(async (trx) => {
      await checkYearRoom(date, trx);
      const saved = await withDayRules(scopes, trx, (tx) =>
        savingOn(date, () =>
          writeRepo.insertHoliday({ date, name: clean, actorId: actor.id, at: nowDate() }, tx),
        ),
      );
      await audit.log(
        {
          actorId: actor.id,
          action: 'holiday.create',
          entityType: 'holiday',
          entityId: saved.result,
          after: { date, name: clean },
          ip,
        },
        trx,
      );
      return saved;
    }),
  );
  await afterWrite({ actor, verb: 'added', date, scopes, since, changed, today });
  return { id, date, name: clean };
}

/** The holiday, locked, with what changes: the new date and name, and the day-rule scopes. */
async function planUpdate({ actor, id, date, name, today }, trx) {
  const holiday = await writeRepo.findHoliday(id, trx, { forUpdate: true });
  if (!holiday) throw goneError();
  const next = {
    date: date === undefined || date === holiday.date ? holiday.date : checkDate(date, today),
    name: name === undefined ? holiday.name : checkName(name),
  };
  const moved = next.date !== holiday.date;
  if (moved && next.date.slice(0, 4) !== holiday.date.slice(0, 4)) {
    await checkYearRoom(next.date, trx, id);
  }
  const reason = `Holiday moved: ${next.name}`;
  const scopes = moved
    ? distinctScopes([holiday.date, next.date].map((day) => ({ from: day, to: day })))
    : [];
  return {
    holiday,
    next,
    scopes: scopes.map((scope) => ({ ...scope, reason, actorId: actor.id })),
  };
}

/**
 * HR or an Admin changes a holiday's date or name (PATCH /api/holidays/:id). A move runs the day
 * rules on the old and the new date ("Holiday moved: Diwali"); a new name only is saved as is.
 * @param {{ actor: { id: number, name: string }, id: number, date?: string, name?: string,
 *   ip?: string | null }} input
 * @returns {Promise<{ id: number, date: string, name: string }>}
 * @throws NOT_FOUND ("That holiday no longer exists."), VALIDATION_FAILED, CONFLICT (the new date
 *   has a holiday), UPDATE_NEEDED (before 018)
 */
export async function updateHoliday({ actor, id, date, name, ip }) {
  const today = await companyToday();
  const since = nowToSecond();
  const plan = await guard018Write('calendar', () =>
    repo.transaction(async (trx) => {
      const planned = await planUpdate({ actor, id, date, name, today }, trx);
      const { next, holiday } = planned;
      const saved = await withDayRules(planned.scopes, trx, (tx) =>
        savingOn(next.date, () =>
          writeRepo.updateHoliday(id, { ...next, actorId: actor.id, at: nowDate() }, tx),
        ),
      );
      await audit.log(
        {
          actorId: actor.id,
          action: 'holiday.update',
          entityType: 'holiday',
          entityId: id,
          before: { date: holiday.date, name: holiday.name },
          after: next,
          ip,
        },
        trx,
      );
      return { ...planned, changed: saved.changed };
    }),
  );
  if (plan.scopes.length > 0) {
    await afterWrite({ actor, verb: 'moved', date: plan.next.date, since, today, ...plan });
  } else {
    await afterCalendarWrite({ scopes: [], since, holidays: true });
  }
  return { id, ...plan.next };
}

/**
 * HR or an Admin deletes a holiday (DELETE /api/holidays/:id): the day is a working day again and
 * the late marks of that day's check-ins are worked out again ("Holiday removed: Diwali").
 * @param {{ actor: { id: number, name: string }, id: number, ip?: string | null }} input
 * @returns {Promise<{ id: number }>}
 * @throws NOT_FOUND ("That holiday no longer exists."), UPDATE_NEEDED (before 018)
 */
export async function deleteHoliday({ actor, id, ip }) {
  const today = await companyToday();
  const since = nowToSecond();
  const plan = await guard018Write('calendar', () =>
    repo.transaction(async (trx) => {
      const holiday = await writeRepo.findHoliday(id, trx, { forUpdate: true });
      if (!holiday) throw goneError();
      const reason = `Holiday removed: ${holiday.name}`;
      const scopes = [{ from: holiday.date, to: holiday.date, reason, actorId: actor.id }];
      const saved = await withDayRules(scopes, trx, (tx) => writeRepo.deleteHoliday(id, tx));
      await audit.log(
        {
          actorId: actor.id,
          action: 'holiday.delete',
          entityType: 'holiday',
          entityId: id,
          before: { date: holiday.date, name: holiday.name },
          ip,
        },
        trx,
      );
      return { holiday, scopes, changed: saved.changed };
    }),
  );
  const { holiday, scopes, changed } = plan;
  await afterWrite({ actor, verb: 'deleted', date: holiday.date, scopes, since, changed, today });
  return { id };
}
