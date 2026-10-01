// The users module: reads other modules and pages rely on (CONTRACT section 6), plus the People,
// Roles and Slack-sync changes, which live in their own files and are re-exported here.
import { AppError } from '@/lib/errors';
import { can, ROLE_LABELS } from '@/lib/permissions';
import { parseInput, toPublicUser } from './helpers';
import * as repo from './repo';
import { listUsersQuerySchema } from './schemas';

export { toPublicUser } from './helpers';
export { add, update } from './profile';
export { changeRole, deactivate, reactivate } from './access';
export { syncSlackUserIds } from './slackSync';

/**
 * One person by id, active or not.
 * @param {number} id
 * @returns {Promise<ReturnType<typeof toPublicUser> | null>}
 */
export async function findById(id) {
  const value = Number(id);
  if (!Number.isInteger(value) || value <= 0) return null;
  return toPublicUser(await repo.findById(value));
}

/**
 * Several people by id (any status), sorted by name. Unknown ids are skipped.
 * @param {number[]} ids
 * @returns {Promise<Array<ReturnType<typeof toPublicUser>>>}
 */
export async function findByIds(ids) {
  const clean = [...new Set((ids ?? []).map(Number))].filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  if (clean.length === 0) return [];
  return (await repo.findByIds(clean)).map(toPublicUser);
}

/**
 * Active people, sorted by name (dashboards, pickers, reminders).
 * @param {{ tracksAttendance?: boolean }} [options] true: only people who check in
 * @returns {Promise<Array<ReturnType<typeof toPublicUser>>>}
 */
export async function listActive({ tracksAttendance } = {}) {
  const rows = await repo.listActive({
    tracksAttendance: tracksAttendance === undefined ? undefined : Boolean(tracksAttendance),
  });
  return rows.map(toPublicUser);
}

/**
 * Active people with one role, sorted by name.
 * @param {'employee' | 'pm' | 'hr' | 'admin'} role
 * @returns {Promise<Array<ReturnType<typeof toPublicUser>>>}
 */
export async function listByRole(role) {
  if (!ROLE_LABELS[role]) return [];
  return (await repo.listActive({ role })).map(toPublicUser);
}

/**
 * Who approves this person's report edit requests: their reports_to when that person is an
 * active PM, otherwise every active Admin (never the person themselves, unless they are the only
 * Admin left).
 * @param {number} userId
 * @returns {Promise<number[]>} user ids (empty when the person doesn't exist)
 */
export async function getReportApproverIds(userId) {
  const person = await repo.findById(Number(userId));
  if (!person) return [];
  if (person.reportsToId && person.reportsToId !== person.id) {
    const manager = await repo.findById(person.reportsToId);
    if (manager && manager.status === 'active' && manager.role === 'pm') return [manager.id];
  }
  const admins = await repo.listActiveAdminIds();
  const others = admins.filter((id) => id !== person.id);
  return others.length > 0 ? others : admins;
}

/**
 * Departments with how many active people are in each, in seed order (for pickers and the
 * People tabs).
 * @returns {Promise<Array<{ id: number, name: string, activeCount: number }>>}
 */
export async function listDepartments() {
  const rows = await repo.listDepartments();
  return rows.map((row) => ({ id: row.id, name: row.name, activeCount: Number(row.activeCount) }));
}

/**
 * How many people are active and deactivated (the People subtitle).
 * @returns {Promise<{ active: number, deactivated: number }>}
 */
export async function countByStatus() {
  const counts = await repo.countByStatus();
  return { active: counts.active ?? 0, deactivated: counts.deactivated ?? 0 };
}

/**
 * Active people per role (the Roles screen cards).
 * @returns {Promise<{ admin: number, pm: number, hr: number, employee: number }>}
 */
export async function countActiveByRole() {
  const counts = await repo.countActiveByRole();
  return {
    admin: counts.admin ?? 0,
    pm: counts.pm ?? 0,
    hr: counts.hr ?? 0,
    employee: counts.employee ?? 0,
  };
}

/**
 * People someone can report to: active PMs, then active Admins, each by name.
 * @returns {Promise<Array<{ id: number, name: string, role: string }>>}
 */
export async function listManagerOptions() {
  const [pms, admins] = await Promise.all([
    repo.listActive({ role: 'pm' }),
    repo.listActive({ role: 'admin' }),
  ]);
  return [...pms, ...admins].map((row) => ({ id: row.id, name: row.name, role: row.role }));
}

async function resolveDepartmentId(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const row = /^\d+$/.test(text)
    ? await repo.findDepartment(Number(text))
    : await repo.findDepartmentByName(text);
  return row?.id ?? 0; // 0 matches nobody: an unknown department lists no one
}

/**
 * A page of people for the People table and GET /api/users. People with people.manage see
 * everyone; people with only team.view see active people.
 * @param {{ user: object, department?: string | number | null,
 *   status?: 'active' | 'deactivated' | 'all' | null, q?: string | null, limit?: number,
 *   offset?: number }} input department is an id or a name; status defaults to 'all'
 * @returns {Promise<{ rows: Array<ReturnType<typeof toPublicUser>>, total: number,
 *   limit: number, offset: number }>}
 * @throws FORBIDDEN without people.manage or team.view; VALIDATION_FAILED on bad paging
 */
export async function list({ user, ...query } = {}) {
  if (!can(user, 'people.manage') && !can(user, 'team.view')) throw new AppError('FORBIDDEN');
  const input = parseInput(listUsersQuerySchema, query);
  const status = can(user, 'people.manage') ? (input.status ?? 'all') : 'active';
  const filters = {
    departmentId: await resolveDepartmentId(input.department),
    status,
    q: input.q ?? null,
  };
  const [rows, total] = await Promise.all([
    repo.list({ ...filters, limit: input.limit, offset: input.offset }),
    repo.count(filters),
  ]);
  return { rows: rows.map(toPublicUser), total, limit: input.limit, offset: input.offset };
}
