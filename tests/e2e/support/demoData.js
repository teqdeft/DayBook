// Read-only lookups in the demo data, for the few things a spec needs to know before it opens a
// screen (which locked report to ask about, which day has a missing check-out, a project's or a
// person's id, today's company date),
// and one thing no screen shows: whether the server asked the AI. Everything else the specs check
// is read from the screens, not from here. Two writes (the teardown loads the demo data again):
// removeCheckInToday (holidays-leave.spec.js needs a second person without a check-in today) and
// startBreakToday (breaks.spec.js needs someone on a break now, at any time of day).
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

/**
 * A project's id by its name.
 * @param {string} name
 * @returns {Promise<number>}
 */
export async function projectIdByName(name) {
  const row = await db()('projects').where({ name }).first('id');
  if (!row) throw new Error(`The demo data has no project ${name}.`);
  return row.id;
}

/**
 * How many AI requests the server has made: each one writes an ai_usage row (CONTRACT 20).
 * @returns {Promise<number>}
 */
export async function aiRequestCount() {
  const row = await db()('aiUsage').count({ total: '*' }).first();
  return Number(row?.total ?? 0);
}

/**
 * A person's id by their email.
 * @param {string} email
 * @returns {Promise<number>}
 */
export async function userIdByEmail(email) {
  const row = await db()('users').where({ email }).first('id');
  if (!row) throw new Error(`The demo data has no person ${email}.`);
  return row.id;
}

/**
 * Today's date in the company time zone (Settings), as the app writes it.
 * @returns {Promise<string>} 'YYYY-MM-DD'
 */
export async function companyToday() {
  const timeZone = await companyTimeZone();
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

/** The company time zone (Settings). */
async function companyTimeZone() {
  const row = await db()('settings').where({ key: 'timezone' }).first('value');
  // A JSON column: MySQL 8 hands back the parsed string, MariaDB the JSON text.
  const value = row?.value ?? '"Asia/Kolkata"';
  return String(value).startsWith('"') ? JSON.parse(value) : value;
}

/**
 * Removes a person's check-in of today (the demo gives them no breaks, corrections or timers that
 * day), so their Today shows the Check in card again.
 * @param {string} email
 */
export async function removeCheckInToday(email) {
  const userId = await userIdByEmail(email);
  const deleted = await db()('attendance')
    .where({ userId, workDate: await companyToday() })
    .delete();
  if (deleted !== 1) throw new Error(`The demo data has no check-in today for ${email}.`);
}

/**
 * The newest day a person has time removed from a timer as a break (an away break).
 * @param {string} email
 * @returns {Promise<string>} 'YYYY-MM-DD'
 */
export async function awayBreakDay(email) {
  const row = await db()('attendanceBreaks as b')
    .join('users as u', 'u.id', 'b.userId')
    .where('u.email', email)
    .andWhere('b.source', 'away')
    .orderBy('b.workDate', 'desc')
    .first('b.workDate');
  if (!row) throw new Error(`The demo data has no away break for ${email}.`);
  return row.workDate;
}

/**
 * Puts a person on a break that started 10 minutes ago: their check-in of today is open again
 * (the demo's evening state has most people checked out) with one open break.
 * @param {string} email
 * @returns {Promise<string>} 'HH:mm', company time: five minutes after the break started, an end
 *   HR may give it
 */
export async function startBreakToday(email) {
  const userId = await userIdByEmail(email);
  const workDate = await companyToday();
  const row = await db()('attendance').where({ userId, workDate }).first('id', 'checkInAt');
  const startedAt = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 10 * 60_000);
  if (!row || row.checkInAt >= startedAt) {
    throw new Error(`The demo data has no check-in today before ${startedAt} for ${email}.`);
  }
  await db()('attendance')
    .where({ id: row.id })
    .update({ checkOutAt: null, checkoutStatus: 'open' });
  // One open break per person (the open_user_id key).
  await db()('attendanceBreaks').where({ userId }).whereNull('endedAt').delete();
  await db()('attendanceBreaks').insert({
    userId,
    attendanceId: row.id,
    workDate,
    startedAt,
    source: 'self',
    createdAt: startedAt,
    updatedAt: startedAt,
  });
  const end = new Date(startedAt.getTime() + 5 * 60_000);
  const timeZone = await companyTimeZone();
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    end,
  );
}
