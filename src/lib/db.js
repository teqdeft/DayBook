// One shared Knex instance for the web app, the worker and service tests.
import knex from 'knex';
import { buildKnexConfig } from '../../knexfile.js';
import { env } from './env.js';

const globalForDb = globalThis;
// Next.js dev reloads modules on every change; reuse the pool instead of opening a new one each time.
const reuse = env.NODE_ENV === 'development';

/** @type {import('knex').Knex} */
export const db = (reuse && globalForDb.__daybookDb) || knex(buildKnexConfig());

if (reuse) globalForDb.__daybookDb = db;

/**
 * JSON columns arrive as strings (the connection sets jsonStrings), so this parses them.
 * @param {unknown} value
 */
export function parseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  return JSON.parse(value);
}

/** Serialises a value for a JSON column. */
export function toJson(value) {
  return value === undefined ? null : JSON.stringify(value);
}

let skipLockedSupport;

/**
 * MySQL 8 supports SELECT ... FOR UPDATE SKIP LOCKED; MariaDB only from 10.6.
 * Without it, FOR UPDATE still stops two workers claiming the same rows (the second one waits).
 */
export async function supportsSkipLocked() {
  if (skipLockedSupport !== undefined) return skipLockedSupport;
  const [rows] = await db.raw('SELECT VERSION() AS version');
  const version = String(rows[0].version);
  const match = version.match(/^(\d+)\.(\d+)/);
  const [major, minor] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  skipLockedSupport = version.toLowerCase().includes('mariadb')
    ? major > 10 || (major === 10 && minor >= 6)
    : major >= 8;
  return skipLockedSupport;
}
