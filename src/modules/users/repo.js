import { db } from '@/lib/db';

// Every read returns the same columns, with the department and manager names joined in.
const USER_COLUMNS = [
  'u.id',
  'u.name',
  'u.email',
  'u.role',
  'u.designation',
  'u.departmentId',
  'd.name as departmentName',
  'u.reportsToId',
  'r.name as reportsToName',
  'u.avatarUrl',
  'u.slackUserId',
  'u.tracksAttendance',
  'u.shiftStart',
  'u.shiftEnd',
  'u.joinedOn',
  'u.status',
  'u.deactivatedAt',
];

function baseQuery(trx) {
  return trx('users as u')
    .leftJoin('departments as d', 'd.id', 'u.departmentId')
    .leftJoin('users as r', 'r.id', 'u.reportsToId');
}

/** '50%_off' -> '50\%\_off', so LIKE treats the text literally. */
function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Filters for the People table and GET /api/users. */
function applyFilters(query, { departmentId, status, q }) {
  if (departmentId !== null && departmentId !== undefined) {
    query.where('u.departmentId', departmentId);
  }
  if (status && status !== 'all') query.where('u.status', status);
  if (q) {
    const text = escapeLike(q);
    // Emails match from the start: every address shares the company domain, so "an" would
    // otherwise match everyone through "company".
    query.where((inner) =>
      inner
        .where('u.name', 'like', `%${text}%`)
        .orWhere('u.email', 'like', `${text}%`)
        .orWhere('u.designation', 'like', `%${text}%`),
    );
  }
  return query;
}

export function findById(id, trx = db) {
  return baseQuery(trx).where('u.id', id).first(USER_COLUMNS);
}

export function findByIds(ids, trx = db) {
  return baseQuery(trx)
    .whereIn('u.id', ids)
    .select(USER_COLUMNS)
    .orderBy([
      { column: 'u.name', order: 'asc' },
      { column: 'u.id', order: 'asc' },
    ]);
}

export function findIdByEmail(email, trx = db) {
  return trx('users').where({ email }).first(['id']);
}

/** Active people, by name. */
export function listActive({ tracksAttendance, role } = {}, trx = db) {
  const query = baseQuery(trx).where('u.status', 'active');
  if (tracksAttendance !== undefined) query.where('u.tracksAttendance', tracksAttendance);
  if (role) query.where('u.role', role);
  return query.select(USER_COLUMNS).orderBy([
    { column: 'u.name', order: 'asc' },
    { column: 'u.id', order: 'asc' },
  ]);
}

/** A page of people: active first, then deactivated, each by name. */
export function list({ departmentId, status, q, limit, offset }, trx = db) {
  return applyFilters(baseQuery(trx), { departmentId, status, q })
    .select(USER_COLUMNS)
    .orderByRaw('(`u`.`status` = ?) asc', ['deactivated'])
    .orderBy([
      { column: 'u.name', order: 'asc' },
      { column: 'u.id', order: 'asc' },
    ])
    .limit(limit)
    .offset(offset);
}

export async function count({ departmentId, status, q }, trx = db) {
  const row = await applyFilters(trx('users as u'), { departmentId, status, q })
    .count({ total: '*' })
    .first();
  return Number(row?.total ?? 0);
}

/** { active: n, deactivated: n } */
export async function countByStatus(trx = db) {
  const rows = await trx('users').select('status').count({ total: '*' }).groupBy('status');
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
}

/** { admin: n, pm: n, hr: n, employee: n } among active people */
export async function countActiveByRole(trx = db) {
  const rows = await trx('users')
    .where({ status: 'active' })
    .select('role')
    .count({ total: '*' })
    .groupBy('role');
  return Object.fromEntries(rows.map((row) => [row.role, Number(row.total)]));
}

/**
 * Ids of the active Admins. Inside a transaction the rows are locked, so two changes that would
 * each remove "another" Admin can't both pass the last-Admin check.
 */
export async function listActiveAdminIds(trx = db, { lock = false } = {}) {
  const query = trx('users').where({ role: 'admin', status: 'active' }).select('id').orderBy('id');
  if (lock) query.forUpdate();
  return (await query).map((row) => row.id);
}

export async function insertUser(row, trx = db) {
  const [id] = await trx('users').insert(row);
  return id;
}

export function updateUser(id, changes, trx = db) {
  return trx('users').where({ id }).update(changes);
}

/** Active people without a Slack user ID, for the hourly Slack sync. */
export function listMissingSlackIds(trx = db) {
  return trx('users')
    .where({ status: 'active' })
    .whereNull('slackUserId')
    .select('id', 'email')
    .orderBy('id');
}

export function findBySlackUserId(slackUserId, trx = db) {
  return trx('users').where({ slackUserId }).first(['id']);
}

// ---------- departments ----------

/** Every department with how many active people are in it, in seed order. */
export function listDepartments(trx = db) {
  return trx('departments as d')
    .leftJoin('users as u', function joinActive() {
      this.on('u.departmentId', '=', 'd.id').andOn('u.status', '=', trx.raw('?', ['active']));
    })
    .select('d.id', 'd.name')
    .count({ activeCount: 'u.id' })
    .groupBy('d.id', 'd.name')
    .orderBy('d.id');
}

export function findDepartment(id, trx = db) {
  return trx('departments').where({ id }).first(['id', 'name']);
}

export function findDepartmentByName(name, trx = db) {
  return trx('departments').where({ name }).first(['id', 'name']);
}
