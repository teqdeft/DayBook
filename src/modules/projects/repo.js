// Every Knex query of the projects module. Names of people and clients are read with joins; other
// modules' data is changed only through their services.
import { db } from '@/lib/db';
import { compactName } from '@/lib/text';
import { escapeLike } from './shared';

const PROJECT_COLUMNS = [
  'p.id',
  'p.name',
  'p.clientId',
  'c.name as clientName',
  'c.isInternal as clientIsInternal',
  'p.pmId',
  'pm.name as pmName',
  'p.status',
  'p.color',
  'p.isUrgent',
  'p.urgentNote',
  'p.urgentMarkedAt',
  'p.urgentMarkedBy as urgentMarkedById',
  'um.name as urgentMarkedByName',
  'p.completedAt',
  'p.createdAt',
];

const PERSON_COLUMNS = [
  'u.id',
  'u.name',
  'u.designation',
  'u.role',
  'u.status',
  'u.avatarUrl',
  'u.slackUserId',
  'u.reportsToId',
];

// Raw SQL form of compactName(): lowercase without spaces, dashes and underscores.
const COMPACT_NAME_SQL = "REPLACE(REPLACE(REPLACE(LOWER(p.name), ' ', ''), '-', ''), '_', '')";

/**
 * projects joined with the client, and filtered by status, membership and a search text.
 * memberId: projects the person is a member of; mineFor: projects the person is a member or the
 * PM of.
 */
function filtered(trx, { status, memberId, mineFor, q } = {}) {
  const query = trx('projects as p').join('clients as c', 'c.id', 'p.clientId');
  if (status) query.where('p.status', status);
  if (memberId) {
    query.whereIn('p.id', trx('projectMembers').select('projectId').where({ userId: memberId }));
  }
  if (mineFor) {
    query.where((where) => {
      where
        .where('p.pmId', mineFor)
        .orWhereIn('p.id', trx('projectMembers').select('projectId').where({ userId: mineFor }));
    });
  }
  const text = String(q ?? '')
    .trim()
    .toLowerCase();
  if (text) {
    const like = `%${escapeLike(text)}%`;
    const compact = compactName(text);
    query.where((where) => {
      where.whereRaw('LOWER(p.name) LIKE ?', [like]).orWhereRaw('LOWER(c.name) LIKE ?', [like]);
      if (compact) where.orWhereRaw(`${COMPACT_NAME_SQL} LIKE ?`, [`%${escapeLike(compact)}%`]);
    });
  }
  return query;
}

function withPeople(query) {
  return query
    .leftJoin('users as pm', 'pm.id', 'p.pmId')
    .leftJoin('users as um', 'um.id', 'p.urgentMarkedBy')
    .select(PROJECT_COLUMNS);
}

// ---------- projects ----------

export function findById(id, trx = db) {
  return withPeople(trx('projects as p').join('clients as c', 'c.id', 'p.clientId'))
    .where('p.id', id)
    .first();
}

/** Locks one projects row for the rest of the transaction. */
export function lockById(id, trx) {
  return trx('projects').where({ id }).forUpdate().first();
}

/** One page of projects, oldest first (the order they were created). */
export function list({ status, memberId, mineFor, q, limit, offset }, trx = db) {
  return withPeople(filtered(trx, { status, memberId, mineFor, q }))
    .orderBy('p.id', 'asc')
    .limit(limit)
    .offset(offset);
}

export async function count({ status, memberId, mineFor, q }, trx = db) {
  const row = await filtered(trx, { status, memberId, mineFor, q }).count({ total: '*' }).first();
  return Number(row?.total ?? 0);
}

/** { active, on_hold, completed } for the tabs. */
export async function countByStatus({ memberId, q }, trx = db) {
  const rows = await filtered(trx, { memberId, q })
    .select('p.status')
    .count({ total: '*' })
    .groupBy('p.status');
  const counts = { active: 0, on_hold: 0, completed: 0 };
  for (const row of rows) counts[row.status] = Number(row.total);
  return counts;
}

/** Every project a person is a member of, any status. */
export function listForMember(userId, trx = db) {
  return withPeople(filtered(trx, { memberId: userId })).orderBy('p.id', 'asc');
}

/** Active urgent projects, most recently marked first; optionally only one member's. */
export function listUrgent({ memberId } = {}, trx = db) {
  const query = withPeople(filtered(trx, { status: 'active', memberId }))
    .where('p.isUrgent', true)
    .select(
      // Active members only, like the team shown on the Projects screens.
      trx.raw(
        '(SELECT COUNT(*) FROM project_members m JOIN users mu ON mu.id = m.user_id ' +
          "WHERE m.project_id = p.id AND mu.status = 'active') AS member_count",
      ),
    )
    .orderBy([
      { column: 'p.urgentMarkedAt', order: 'desc' },
      { column: 'p.id', order: 'asc' },
    ]);
  return query;
}

/** Active projects with whether the user is a member or their PM (report picker). */
export function listActiveForPicker(userId, trx = db) {
  return trx('projects as p')
    .where('p.status', 'active')
    .select(
      'p.id',
      'p.name',
      'p.color',
      'p.isUrgent',
      trx.raw(
        'CASE WHEN p.pm_id = ? OR EXISTS (SELECT 1 FROM project_members m ' +
          'WHERE m.project_id = p.id AND m.user_id = ?) THEN 1 ELSE 0 END AS is_mine',
        [userId, userId],
      ),
    )
    .orderBy('p.name', 'asc');
}

/** Every active project's id and name, by name (the decline dialog's move-to picker). */
export function listActiveOptions(trx = db) {
  return trx('projects')
    .where({ status: 'active' })
    .select('id', 'name')
    .orderBy([
      { column: 'name', order: 'asc' },
      { column: 'id', order: 'asc' },
    ]);
}

export async function countActive(trx = db) {
  const row = await trx('projects')
    .where({ status: 'active' })
    .select(trx.raw('COUNT(*) AS active'), trx.raw('COALESCE(SUM(is_urgent), 0) AS urgent'))
    .first();
  return { active: Number(row?.active ?? 0), urgent: Number(row?.urgent ?? 0) };
}

/** Every project name, for the duplicate check (projects are tens to hundreds of rows). */
export function listAllNames(trx = db) {
  return trx('projects').select('id', 'name', 'status');
}

export async function insertProject(row, trx) {
  const [id] = await trx('projects').insert(row);
  return id;
}

export function updateProject(id, changes, trx) {
  return trx('projects').where({ id }).update(changes);
}

// ---------- members ----------

/** Members of the given projects (active and deactivated), in the order they were added. */
export function listMembers(projectIds, trx = db) {
  if (projectIds.length === 0) return Promise.resolve([]);
  return trx('projectMembers as m')
    .join('users as u', 'u.id', 'm.userId')
    .whereIn('m.projectId', projectIds)
    .select('m.projectId', 'm.addedAt', 'm.addedBy', ...PERSON_COLUMNS)
    .orderBy([
      { column: 'm.addedAt', order: 'asc' },
      { column: 'u.id', order: 'asc' },
    ]);
}

export function insertMembers(rows, trx) {
  if (rows.length === 0) return Promise.resolve();
  return trx('projectMembers').insert(rows);
}

export function deleteMembers(projectId, userIds, trx) {
  if (userIds.length === 0) return Promise.resolve(0);
  return trx('projectMembers').where({ projectId }).whereIn('userId', userIds).del();
}

// ---------- people ----------

export function findUsersByIds(ids, trx = db) {
  if (ids.length === 0) return Promise.resolve([]);
  return trx('users as u').whereIn('u.id', ids).select(PERSON_COLUMNS);
}

/** Locks one users row for the rest of the transaction (serialises a person's requests). */
export function lockUser(id, trx) {
  return trx('users').where({ id }).forUpdate().first('id');
}

/** Active people, by name; optionally only some roles. */
export function listActiveUsers({ roles } = {}, trx = db) {
  const query = trx('users as u').where('u.status', 'active').select(PERSON_COLUMNS);
  if (roles) query.whereIn('u.role', roles);
  return query.orderBy([
    { column: 'u.name', order: 'asc' },
    { column: 'u.id', order: 'asc' },
  ]);
}

// ---------- clients ----------

export function searchClients({ q, limit, offset = 0 }, trx = db) {
  const query = trx('clients').select('id', 'name', 'isInternal');
  const text = String(q ?? '').trim();
  if (text) {
    query.whereRaw('LOWER(name) LIKE ?', [`%${escapeLike(text.toLowerCase())}%`]);
    // Names that start with the text come first.
    query.orderByRaw('CASE WHEN LOWER(name) LIKE ? THEN 0 ELSE 1 END', [
      `${escapeLike(text.toLowerCase())}%`,
    ]);
  }
  return query.orderBy('name', 'asc').limit(limit).offset(offset);
}

/**
 * Case-insensitive (the column collation ignores case and trailing spaces). `lock` reads the
 * latest committed row (a locking read), for the retry after a duplicate-key error.
 */
export function findClientByName(name, trx = db, { lock = false } = {}) {
  const query = trx('clients').where({ name }).select('id', 'name', 'isInternal').first();
  if (lock) query.forShare();
  return query;
}

export async function insertClient(row, trx) {
  const [id] = await trx('clients').insert(row);
  return id;
}

// ---------- project requests ----------

const REQUEST_COLUMNS = [
  'r.id',
  'r.name',
  'r.note',
  'r.status',
  'r.requestedBy',
  'r.handledBy',
  'r.handledAt',
  'r.declineReason',
  'r.projectId',
  'r.createdAt',
  'u.id as requesterId',
  'u.name as requesterName',
  'u.designation as requesterDesignation',
  'u.role as requesterRole',
  'u.status as requesterStatus',
  'u.avatarUrl as requesterAvatarUrl',
  'u.slackUserId as requesterSlackUserId',
  'u.reportsToId as requesterReportsToId',
  'h.name as handledByName',
  'p.name as projectName',
];

function requestQuery(trx) {
  return trx('projectRequests as r')
    .join('users as u', 'u.id', 'r.requestedBy')
    .leftJoin('users as h', 'h.id', 'r.handledBy')
    .leftJoin('projects as p', 'p.id', 'r.projectId')
    .select(REQUEST_COLUMNS);
}

export function findRequest(id, trx = db) {
  return requestQuery(trx).where('r.id', id).first();
}

/** Locks one project_requests row for the rest of the transaction. */
export function lockRequest(id, trx) {
  return trx('projectRequests').where({ id }).forUpdate().first();
}

/**
 * Requests with a status (or several); pending ones newest first, handled ones most recently
 * handled first.
 */
export function listRequests({ status, requestedBy, limit, offset = 0 }, trx = db) {
  const statuses = Array.isArray(status) ? status : [status];
  const query = requestQuery(trx).whereIn('r.status', statuses);
  if (requestedBy) query.where('r.requestedBy', requestedBy);
  const order =
    statuses.length === 1 && statuses[0] === 'pending'
      ? [
          { column: 'r.createdAt', order: 'desc' },
          { column: 'r.id', order: 'desc' },
        ]
      : [
          { column: 'r.handledAt', order: 'desc' },
          { column: 'r.id', order: 'desc' },
        ];
  return query.orderBy(order).limit(limit).offset(offset);
}

export async function countRequests({ status, requestedBy }, trx = db) {
  const query = trx('projectRequests').whereIn('status', Array.isArray(status) ? status : [status]);
  if (requestedBy) query.where({ requestedBy });
  const row = await query.count({ total: '*' }).first();
  return Number(row?.total ?? 0);
}

/** Pending request names, for the duplicate check. */
export function listPendingRequestNames(trx = db) {
  return trx('projectRequests as r')
    .join('users as u', 'u.id', 'r.requestedBy')
    .where('r.status', 'pending')
    .select('r.id', 'r.name', 'r.requestedBy', 'u.name as requesterName');
}

export async function insertRequest(row, trx) {
  const [id] = await trx('projectRequests').insert(row);
  return id;
}

export function updateRequest(id, changes, trx) {
  return trx('projectRequests').where({ id }).update(changes);
}
