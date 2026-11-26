// Read-only lookups in the demo data, for the few things a spec needs to know before it opens a
// screen (which locked report to ask about, which day has a missing check-out, a project's or a
// person's id, today's company date),
// and one thing no screen shows: whether the server asked the AI. Everything else the specs check
// is read from the screens, not from here. A few writes (the teardown loads the demo data again):
// removeCheckInToday (holidays-leave.spec.js needs a second person without a check-in today),
// startBreakToday (breaks.spec.js needs someone on a break now, at any time of day),
// addNotification (live-notifications.spec.js needs a new notification while a page is open), and
// addTasks / removeTasks (board-perf.spec.js needs a board of 150 cards, CONTRACT 28).
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
 * A project task by its title, as it is now: its id, person, phase, due date and status.
 * @param {number} projectId
 * @param {string} title
 * @returns {Promise<{ id: number, assigneeId: number | null, phase: string | null,
 *   dueDate: string | null, status: string }>}
 */
export async function taskByTitle(projectId, title) {
  const row = await db()('projectTasks')
    .where({ projectId, title })
    .first('id', 'assigneeId', 'phase', 'dueDate', 'status');
  if (!row) throw new Error(`The demo data has no task "${title}" on project ${projectId}.`);
  return row;
}

/**
 * A project's current phase as its plan has it now (project-plan.spec.js moves acme-store on to
 * Testing), or null without a plan or a current phase.
 * @param {number} projectId
 * @returns {Promise<string | null>}
 */
export async function currentPhaseOf(projectId) {
  const row = await db()('projectPlans').where({ projectId }).first('currentPhase');
  return row?.currentPhase ?? null;
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

/**
 * Adds a bell notification for a person while their pages are open, as `notifications.notify`
 * writes it (unread, the desktop push already handled: the e2e server has no push keys). The demo's
 * evening state dates some of today's rows after the real clock, and the bell sorts by `createdAt`,
 * so the new row is dated a second after the person's newest one when that is later than now: it
 * is the top of the bell, as a new notification is.
 * @param {string} email
 * @param {{ type: string, title: string, body?: string | null, link?: string | null }} notification
 * @returns {Promise<number>} the new row's id
 */
export async function addNotification(email, { type, title, body = null, link = null }) {
  const userId = await userIdByEmail(email);
  const newest = await db()('notifications').where({ userId }).max({ at: 'createdAt' }).first();
  const after = newest?.at ? new Date(newest.at).getTime() + 1000 : 0;
  const createdAt = new Date(Math.max(Math.floor(Date.now() / 1000) * 1000, after));
  const [id] = await db()('notifications').insert({
    userId,
    type,
    title,
    body,
    link,
    readAt: null,
    pushedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  });
  return Number(id);
}

/**
 * Adds open tasks to a project straight into the database (no notifications): titles
 * "<prefix> 1" to "<prefix> <count>", spread over `phases` in turn, P1 to P3 in turn, for anyone
 * on the project, added by the project's PM.
 * @param {number} projectId
 * @param {number} count
 * @param {{ prefix: string, phases: string[] }} options
 * @returns {Promise<number>} how many were added
 */
export async function addTasks(projectId, count, { prefix, phases }) {
  const project = await db()('projects').where({ id: projectId }).first('pmId');
  if (!project) throw new Error(`The demo data has no project ${projectId}.`);
  const now = new Date();
  const rows = Array.from({ length: count }, (_, index) => ({
    projectId,
    title: `${prefix} ${index + 1}`,
    priority: ['p1', 'p2', 'p3'][index % 3],
    assigneeId: null,
    status: 'open',
    phase: phases[index % phases.length],
    createdBy: project.pmId,
    updatedBy: project.pmId,
    createdAt: now,
    updatedAt: now,
  }));
  for (let start = 0; start < rows.length; start += 50) {
    await db()('projectTasks').insert(rows.slice(start, start + 50));
  }
  return rows.length;
}

/**
 * Removes the tasks addTasks added (every task of the project whose title starts with the prefix).
 * @param {number} projectId
 * @param {string} prefix
 * @returns {Promise<number>} how many were removed
 */
export async function removeTasks(projectId, prefix) {
  return db()('projectTasks')
    .where({ projectId })
    .andWhere('title', 'like', `${prefix} %`)
    .delete();
}
