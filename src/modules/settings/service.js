import { db, parseJson, toJson } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { normalizeClock, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { DEFAULT_SETTINGS } from '../../../db/seeds/03_settings.js';
import { parseInput } from './parse';
import * as repo from './repo';
import {
  ACTIVITY_IDLE_MINUTES,
  ACTIVITY_RETENTION_DAYS,
  AI_DAILY_LIMIT,
  BREAK_ALLOWANCE_MINUTES,
  CHECKIN_REMINDER_MINUTES,
  checkAutoCheckout,
  checkDayMarks,
  checkHrSummary,
  HALF_DAY_UNDER_MINUTES,
  LATE_ALERT_DAYS,
  LEFT_EARLY_GRACE_MINUTES,
  PAYROLL_MONTH_START_DAY,
  settingsUpdateSchema,
  SHORT_DAY_UNDER_MINUTES,
  TIMER_AWAY_MINUTES,
  TIMER_MODES,
  TIMER_REMINDER_MINUTES,
} from './schemas';

export {
  addOfficeNetwork,
  isOfficeIp,
  listOfficeNetworks,
  removeOfficeNetwork,
} from './officeNetworks';

const toCamel = (key) => key.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
const toSnake = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** camelCase key -> seeded default. The time zone falls back to DEFAULT_TIMEZONE. */
const DEFAULTS = Object.freeze(
  Object.fromEntries(
    Object.entries({ ...DEFAULT_SETTINGS, timezone: env.DEFAULT_TIMEZONE }).map(([key, value]) => [
      toCamel(key),
      value,
    ]),
  ),
);
const CLOCK_KEYS = new Set([
  'officeStart',
  'officeEnd',
  'lateAfter',
  'reportReminderAt',
  'autoCheckoutAt',
  'aiPmSummaryAt',
  'aiHrNotesAt',
  'hrSummaryAt', // CONTRACT 25
]);
// Slack channels: an id or name, or null for "don't post" (the to-do channel, CONTRACT 24, is null
// until an Admin picks one; a missing row reads as null too, since the live server never seeds).
const CHANNEL_KEYS = new Set([
  'slackReportChannelId',
  'slackReportChannelName',
  'slackTodoChannelId',
  'slackTodoChannelName',
]);
// Whole numbers kept inside their allowed range (a hand-edited row can't turn idle detection into
// "idle after 0 minutes").
const BOUNDED_KEYS = {
  activityIdleMinutes: ACTIVITY_IDLE_MINUTES,
  activityRetentionDays: ACTIVITY_RETENTION_DAYS,
  timerAwayMinutes: TIMER_AWAY_MINUTES,
  timerReminderMinutes: TIMER_REMINDER_MINUTES,
  breakAllowanceMinutes: BREAK_ALLOWANCE_MINUTES,
  aiDailyLimit: AI_DAILY_LIMIT,
  // Attendance marks and HR updates (CONTRACT 25)
  halfDayUnderMinutes: HALF_DAY_UNDER_MINUTES,
  shortDayUnderMinutes: SHORT_DAY_UNDER_MINUTES,
  leftEarlyGraceMinutes: LEFT_EARLY_GRACE_MINUTES,
  payrollMonthStartDay: PAYROLL_MONTH_START_DAY,
  checkinReminderMinutes: CHECKIN_REMINDER_MINUTES,
  lateAlertDays: LATE_ALERT_DAYS,
};

// ---------- cache ----------
// Shared through globalThis so every Next.js bundle layer (pages and route handlers) and hot
// reloads see the same cache, and a save clears it for all of them. Tests read the database every
// time (they change settings rows directly), unless a test turns the cache on.
const cache = globalThis.__daybookSettingsCache ?? {
  value: null,
  loadedAt: 0,
  loading: null,
  generation: 0,
};
globalThis.__daybookSettingsCache = cache;
let cacheTtlMs = env.isTest ? 0 : 30_000;

function isTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Coerces one stored value to its expected type, falling back to the default when it's unusable. */
function normalizeValue(key, value) {
  const fallback = DEFAULTS[key];
  if (value === undefined) return fallback;
  if (CLOCK_KEYS.has(key))
    return typeof value === 'string' && value ? normalizeClock(value) : fallback;
  if (typeof fallback === 'boolean') return Boolean(value);
  if (key in BOUNDED_KEYS) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(BOUNDED_KEYS[key].max, Math.max(BOUNDED_KEYS[key].min, number));
  }
  if (typeof fallback === 'number')
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  if (key === 'workingDays') {
    const days = Array.isArray(value)
      ? [...new Set(value.map(Number))].filter(
          (day) => Number.isInteger(day) && day >= 1 && day <= 7,
        )
      : [];
    return days.length > 0 ? days.sort((a, b) => a - b) : [...fallback];
  }
  if (key === 'timezone') return typeof value === 'string' && isTimeZone(value) ? value : fallback;
  if (CHANNEL_KEYS.has(key)) return value ? String(value) : null;
  if (key === 'timersMode') return TIMER_MODES.includes(value) ? value : fallback;
  return typeof value === 'string' ? value : fallback;
}

function fromRows(rows) {
  const stored = {};
  for (const row of rows) {
    try {
      stored[toCamel(row.key)] = parseJson(row.value);
    } catch (error) {
      logger.warn(
        { err: error, key: row.key },
        'settings value is not valid JSON; using the default',
      );
    }
  }
  return Object.fromEntries(
    Object.keys(DEFAULTS).map((key) => [key, normalizeValue(key, stored[key])]),
  );
}

function copy(value) {
  return { ...value, workingDays: [...value.workingDays] };
}

function startLoad() {
  const generation = cache.generation;
  const promise = repo
    .listSettings()
    .then((rows) => {
      const value = fromRows(rows);
      // A save that happened while this read was running wins: don't cache the older values.
      if (cache.generation === generation) {
        cache.value = value;
        cache.loadedAt = performance.now();
      }
      return value;
    })
    .finally(() => {
      if (cache.loading === promise) cache.loading = null;
    });
  cache.loading = promise;
  return promise;
}

/** Forgets the cached settings, so the next getAll() reads the database. */
export function clearCache() {
  cache.generation += 1;
  cache.value = null;
  cache.loading = null;
}

/** Tests only: turn the cache on (milliseconds) or back to the test default (null). */
export function setCacheTtlForTests(ms) {
  cacheTtlMs = ms ?? (env.isTest ? 0 : 30_000);
  clearCache();
}

/**
 * All company settings with camelCase keys. Clock values are 'HH:mm' in company time; missing or
 * broken rows fall back to the seeded defaults. Cached in-process for about 30 seconds and
 * cleared on save, so the worker picks up an Admin change within a minute.
 * @returns {Promise<{ companyName: string, timezone: string, workingDays: number[],
 *   officeStart: string, officeEnd: string, lateAfter: string, reportReminderAt: string,
 *   reportLock: string, gapWarningMinutes: number, stuckTaskDays: number,
 *   allowUnverifiedOffice: boolean, autoMarkMissingCheckout: boolean, slackEnabled: boolean,
 *   slackReportChannelId: string | null, slackReportChannelName: string | null,
 *   slackTodoChannelId: string | null, slackTodoChannelName: string | null,
 *   slackPostReports: boolean, slackRemind: boolean, slackUrgentNotify: boolean,
 *   slackRequestsNotify: boolean, activityTrackingEnabled: boolean,
 *   activityIdleMinutes: number, activityRetentionDays: number, pushEnabled: boolean,
 *   timersMode: 'off' | 'optional' | 'required', timerAwayMinutes: number,
 *   timerReminderMinutes: number, breakAllowanceMinutes: number,
 *   officeCheckinAnywhere: boolean, wfhRequiresApproval: boolean, autoCheckoutEnabled: boolean,
 *   autoCheckoutAt: string, aiEnabled: boolean, aiDailyLimit: number, aiPolishEnabled: boolean,
 *   aiPmSummaryEnabled: boolean, aiPmSummaryAt: string, aiSummarySlack: boolean,
 *   aiHrNotesEnabled: boolean, aiHrNotesAt: string, aiAskEnabled: boolean,
 *   aiProjectSummaryEnabled: boolean, halfDayUnderMinutes: number, shortDayUnderMinutes: number,
 *   leftEarlyGraceMinutes: number, payrollMonthStartDay: number, hrMorningSummary: boolean,
 *   hrSummaryAt: string, hrEveningSummary: boolean, checkinReminderMinutes: number,
 *   lateAlertDays: number, slackAttendanceRemind: boolean, slackHrSummary: boolean }>} (AI,
 *   CONTRACT 20 and 22) a fresh copy, safe to change; activityIdleMinutes is 1-120 and
 *   activityRetentionDays 7-3650 (screen time, CONTRACT 11); pushEnabled switches desktop
 *   notifications for everyone (CONTRACT 14); timers and breaks (CONTRACT 15):
 *   timerAwayMinutes 5-240, timerReminderMinutes 0-240 (0 = never), breakAllowanceMinutes 0-480
 *   (0 = no allowance); check-in rules (CONTRACT 17); auto check-out (CONTRACT 19):
 *   autoCheckoutAt is 'HH:mm', later than officeEnd while autoCheckoutEnabled is on; the to-do
 *   channel (CONTRACT 24): null until an Admin picks one, never the report channel; attendance
 *   marks and HR updates (CONTRACT 25): halfDayUnderMinutes and shortDayUnderMinutes 0-720 (0 =
 *   off, half below short while both are on), leftEarlyGraceMinutes 0-240,
 *   payrollMonthStartDay 1-28 (1 = calendar months; 26 = the 26th to the 25th, named after the
 *   month it ends in), hrSummaryAt 'HH:mm' (at or after lateAfter and before officeEnd while
 *   hrMorningSummary is on; the evening wrap-up goes at officeEnd + 30 minutes),
 *   checkinReminderMinutes 0-240 after each person's own late mark (0 = off), lateAlertDays
 *   1-31 (also the Needs a look threshold); slackAttendanceRemind and slackHrSummary are the
 *   queueDm setting keys of the reminders and of both HR summaries
 */
export async function getAll() {
  if (cacheTtlMs > 0 && cache.value && performance.now() - cache.loadedAt < cacheTtlMs) {
    return copy(cache.value);
  }
  return copy(await (cache.loading ?? startLoad()));
}

/**
 * Saves the settings that changed (only keys that differ from the stored value are written),
 * records who changed them, and writes one 'settings.update' audit row with before/after, all in
 * one transaction. Clears the cache. Turning timers off (optional or required -> off) then stops
 * every running timer (CONTRACT 15); a failure there is logged and never fails the save.
 * @param {{ user: { id: number } | null, values: object, ip?: string | null }} input
 *   values: any subset of the keys getAll() returns
 * @returns {Promise<ReturnType<typeof getAll>>} the settings after the save
 * @throws VALIDATION_FAILED with fields, for example { timezone: 'Pick a valid time zone.' } or,
 *   while auto check-out is on, { autoCheckoutAt: 'Pick a time after office hours end.' } when
 *   the auto check-out time isn't later than office end (CONTRACT 19); { halfDayUnderMinutes:
 *   'Half day must be less than the short day time.' } while both marks are on, and, while the
 *   morning HR summary is on, { hrSummaryAt: 'Pick a time at or after the late mark (9:30).' }
 *   or { hrSummaryAt: 'Pick a time before office hours end.' } (CONTRACT 25)
 */
export async function update({ user, values, ip }) {
  const parsed = parseInput(settingsUpdateSchema, values ?? {});
  const changes = await db.transaction(async (trx) => {
    const current = fromRows(await repo.listSettings(trx));
    checkAutoCheckout(current, parsed);
    checkDayMarks(current, parsed);
    checkHrSummary(current, parsed);
    const before = {};
    const after = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined || !(key in DEFAULTS)) continue;
      if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
      before[key] = current[key];
      after[key] = value;
    }
    const keys = Object.keys(after);
    if (keys.length === 0) return after;
    const updatedAt = nowDate();
    for (const key of keys) {
      await repo.saveSetting(
        { key: toSnake(key), value: toJson(after[key]), updatedBy: user?.id ?? null, updatedAt },
        trx,
      );
    }
    await audit.log(
      {
        actorId: user?.id ?? null,
        action: 'settings.update',
        entityType: 'settings',
        before,
        after,
        ip,
      },
      trx,
    );
    return after;
  });
  const changed = Object.keys(changes);
  if (changed.length > 0) {
    clearCache();
    logger.info({ userId: user?.id ?? null, keys: changed }, 'settings saved');
  }
  // Only a change: the stored mode was optional or required.
  if (changes.timersMode === 'off') await stopRunningTimers(user?.id ?? null);
  return getAll();
}

/**
 * Timers were just turned off: stops every running timer (timers.stopAllRunning, stop reason
 * stopped). timers imports settings, so it is imported here, inside the function (import cycle).
 * A failure is only logged: the save stands, and anyone can still stop their own timer.
 */
async function stopRunningTimers(userId) {
  try {
    const { timers } = await import('@/modules/timers');
    const { stopped } = await timers.stopAllRunning({ at: nowDate(), reason: 'stopped' });
    if (stopped > 0) logger.info({ userId, stopped }, 'timers turned off; running timers stopped');
  } catch (error) {
    logger.warn({ err: error, userId }, 'timers turned off; running timers could not be stopped');
  }
}
