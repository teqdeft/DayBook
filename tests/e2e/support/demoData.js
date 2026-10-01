// Read-only lookups in the demo data, for the few things a spec needs to know before it opens a
// screen (which locked report to ask about, which day has a missing check-out). Everything the
// specs check is read from the screens, not from here.
import knex from 'knex';
import { buildKnexConfig } from '../../../knexfile.js';

let connection = null;

function db() {
  if (!connection) {
    const config = buildKnexConfig();
    connection = knex({ ...config, pool: { ...config.pool, min: 0, max: 2 } });
  }
  return connection;
}

/** Closes the connection pool (call it in afterAll). */
export async function closeDemoData() {
  if (connection) await connection.destroy();
  connection = null;
}

/**
 * The newest submitted report of a person that has locked and has no edit request waiting.
 * @param {string} email
 * @returns {Promise<string>} 'YYYY-MM-DD'
 */
export async function lockedReportDay(email) {
  const row = await db()('dailyReports as r')
    .join('users as u', 'u.id', 'r.userId')
    .where('u.email', email)
    .andWhere('r.status', 'submitted')
    .andWhere('r.locksAt', '<', db().fn.now())
    .andWhere((query) =>
      query.whereNull('r.unlockedUntil').orWhere('r.unlockedUntil', '<', db().fn.now()),
    )
    .whereNotExists((query) =>
      query
        .select(db().raw('1'))
        .from('reportEditRequests as e')
        .whereRaw('e.report_id = r.id')
        .andWhere('e.status', 'pending'),
    )
    .orderBy('r.workDate', 'desc')
    .first('r.workDate');
  if (!row) throw new Error(`The demo data has no locked report for ${email}.`);
  return row.workDate;
}

/**
 * The newest day a person's check-out was marked missing (the midnight job's mark).
 * @param {string} email
 * @returns {Promise<string>} 'YYYY-MM-DD'
 */
export async function missingCheckoutDay(email) {
  const row = await db()('attendance as a')
    .join('users as u', 'u.id', 'a.userId')
    .where('u.email', email)
    .andWhere('a.checkoutStatus', 'missing')
    .orderBy('a.workDate', 'desc')
    .first('a.workDate');
  if (!row) throw new Error(`The demo data has no missing check-out for ${email}.`);
  return row.workDate;
}
