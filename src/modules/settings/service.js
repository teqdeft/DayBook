import { db, parseJson, toJson } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, validationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { normalizeClock, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { DEFAULT_SETTINGS } from '../../../db/seeds/03_settings.js';
import * as repo from './repo';
import {
  ACTIVITY_IDLE_MINUTES,
  ACTIVITY_RETENTION_DAYS,
  normalizeIp,
  officeNetworkSchema,
  settingsUpdateSchema,
} from './schemas';

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
const CLOCK_KEYS = new Set(['officeStart', 'officeEnd', 'lateAfter', 'reportReminderAt']);
// Whole numbers kept inside their allowed range (a hand-edited row can't turn idle detection into
// "idle after 0 minutes").
const BOUNDED_KEYS = {
  activityIdleMinutes: ACTIVITY_IDLE_MINUTES,
  activityRetentionDays: ACTIVITY_RETENTION_DAYS,
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
  if (key === 'slackReportChannelId' || key === 'slackReportChannelName')
    return value ? String(value) : null;
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
 *   slackPostReports: boolean, slackRemind: boolean, slackUrgentNotify: boolean,
 *   slackRequestsNotify: boolean, activityTrackingEnabled: boolean,
 *   activityIdleMinutes: number, activityRetentionDays: number, pushEnabled: boolean }>} a fresh
 *   copy, safe to change; activityIdleMinutes is 1-120 and activityRetentionDays 7-3650 (screen
 *   time, CONTRACT 11); pushEnabled switches desktop notifications for everyone (CONTRACT 14)
 */
export async function getAll() {
  if (cacheTtlMs > 0 && cache.value && performance.now() - cache.loadedAt < cacheTtlMs) {
    return copy(cache.value);
  }
  return copy(await (cache.loading ?? startLoad()));
}

/** zod result -> the API's VALIDATION_FAILED error with a message per field. */
function parseInput(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  throw validationError(fields, Object.values(fields)[0]);
}

/**
 * Saves the settings that changed (only keys that differ from the stored value are written),
 * records who changed them, and writes one 'settings.update' audit row with before/after, all in
 * one transaction. Clears the cache.
 * @param {{ user: { id: number } | null, values: object, ip?: string | null }} input
 *   values: any subset of the keys getAll() returns
 * @returns {Promise<ReturnType<typeof getAll>>} the settings after the save
 * @throws VALIDATION_FAILED with fields, for example { timezone: 'Pick a valid time zone.' }
 */
export async function update({ user, values, ip }) {
  const parsed = parseInput(settingsUpdateSchema, values ?? {});
  const changed = await db.transaction(async (trx) => {
    const current = fromRows(await repo.listSettings(trx));
    const before = {};
    const after = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined || !(key in DEFAULTS)) continue;
      if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
      before[key] = current[key];
      after[key] = value;
    }
    const keys = Object.keys(after);
    if (keys.length === 0) return keys;
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
    return keys;
  });
  if (changed.length > 0) {
    clearCache();
    logger.info({ userId: user?.id ?? null, keys: changed }, 'settings saved');
  }
  return getAll();
}

// ---------- office networks ----------

function duplicateNetwork() {
  return new AppError('DUPLICATE_NETWORK', {
    fields: { ipAddress: 'That IP address is already saved.' },
  });
}

/**
 * Saved office networks, oldest first.
 * @returns {Promise<Array<{ id: number, name: string, ipAddress: string, createdBy: number | null,
 *   createdAt: Date }>>}
 */
export function listOfficeNetworks() {
  return repo.listOfficeNetworks();
}

/**
 * Adds an office network (the office's public IP). Audited as 'office_network.add'.
 * @param {{ user: { id: number }, name: string, ipAddress: string, ip?: string | null }} input
 * @returns {Promise<{ id: number, name: string, ipAddress: string, createdBy: number | null,
 *   createdAt: Date }>}
 * @throws VALIDATION_FAILED (name 1-80 characters, a valid IPv4 or IPv6 address),
 *   DUPLICATE_NETWORK when the IP address is already saved
 */
export async function addOfficeNetwork({ user, name, ipAddress, ip }) {
  const input = parseInput(officeNetworkSchema, { name, ipAddress });
  if (await repo.findOfficeNetworkByIp(input.ipAddress)) throw duplicateNetwork();
  try {
    return await db.transaction(async (trx) => {
      const at = nowDate();
      const id = await repo.insertOfficeNetwork(
        { ...input, createdBy: user?.id ?? null, createdAt: at, updatedAt: at },
        trx,
      );
      await audit.log(
        {
          actorId: user?.id ?? null,
          action: 'office_network.add',
          entityType: 'office_network',
          entityId: id,
          after: input,
          ip,
        },
        trx,
      );
      return repo.findOfficeNetwork(id, trx);
    });
  } catch (error) {
    // Two admins adding the same IP at once: the unique key catches the second one.
    if (error?.errno === 1062) throw duplicateNetwork();
    throw error;
  }
}

/**
 * Removes an office network. Audited as 'office_network.remove'.
 * @param {{ user: { id: number }, id: number | string, ip?: string | null }} input
 * @returns {Promise<{ id: number }>}
 * @throws NOT_FOUND when the network doesn't exist (or was already removed)
 */
export async function removeOfficeNetwork({ user, id, ip }) {
  const networkId = Number(id);
  if (!Number.isInteger(networkId) || networkId <= 0) throw new AppError('NOT_FOUND');
  return db.transaction(async (trx) => {
    const network = await repo.findOfficeNetwork(networkId, trx);
    if (!network) throw new AppError('NOT_FOUND', { message: 'That network was already removed.' });
    await repo.deleteOfficeNetwork(networkId, trx);
    await audit.log(
      {
        actorId: user?.id ?? null,
        action: 'office_network.remove',
        entityType: 'office_network',
        entityId: networkId,
        before: { name: network.name, ipAddress: network.ipAddress },
        ip,
      },
      trx,
    );
    return { id: networkId };
  });
}

/**
 * True when the IP is one of the saved office networks (exact match; '::ffff:' IPv4-mapped
 * addresses are compared as plain IPv4).
 * @param {string | null | undefined} ip
 * @returns {Promise<boolean>}
 */
export async function isOfficeIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return false;
  return Boolean(await repo.findOfficeNetworkByIp(value));
}
