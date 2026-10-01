// Inserts the demo people, clients, projects and project members.
import { CEO, DEACTIVATED, PEOPLE } from './people.js';
import { CLIENTS, COMPLETED_PROJECTS, PROJECTS } from './projects.js';
import { at } from './calendar.js';

/**
 * Updates the seeded CEO and inserts everyone else. Managers are linked after the insert, because
 * reports_to points at other rows of the same table.
 * @param {import('knex').Knex.Transaction} trx
 * @param {{ tz: string, ceoEmail: string }} ctx
 * @returns {Promise<Map<string, object>>} person key -> { id, name, role, ... }
 */
export async function insertPeople(trx, ctx) {
  const departments = new Map(
    (await trx('departments').select('id', 'name')).map((row) => [row.name, row.id]),
  );
  const ceo = await trx('users').where({ email: ctx.ceoEmail }).first();
  if (!ceo) throw new Error(`The seeded admin ${ctx.ceoEmail} is missing.`);
  await trx('users').where({ id: ceo.id }).update({ joinedOn: CEO.joinedOn });

  const users = new Map([['ceo', { ...ceo, key: 'ceo' }]]);
  const everyone = [...PEOPLE, ...DEACTIVATED];
  const rows = everyone.map((person, i) => {
    const departmentId = departments.get(person.department);
    if (!departmentId) throw new Error(`Unknown department ${person.department}`);
    const createdAt = at(person.joinedOn, '10:00', ctx.tz);
    return {
      id: ceo.id + 1 + i,
      name: person.name,
      email: person.email,
      slackUserId: null,
      avatarUrl: null,
      designation: person.designation,
      departmentId,
      role: person.role,
      reportsToId: null,
      joinedOn: person.joinedOn,
      shiftStart: null, // company default (9:30 AM to 6:30 PM on 06 and 10)
      shiftEnd: null,
      tracksAttendance: person.tracksAttendance,
      status: person.status,
      deactivatedAt: person.deactivatedOn ? at(person.deactivatedOn, '18:00', ctx.tz) : null,
      lastLoginAt: null,
      createdAt,
      updatedAt: person.deactivatedOn ? at(person.deactivatedOn, '18:00', ctx.tz) : createdAt,
    };
  });
  await trx('users').insert(rows);
  everyone.forEach((person, i) => users.set(person.key, { ...person, ...rows[i] }));

  for (const person of everyone) {
    const manager = users.get(person.reportsTo);
    if (!manager) throw new Error(`Unknown manager ${person.reportsTo} for ${person.key}`);
    const user = users.get(person.key);
    // Setting updated_at keeps the column's ON UPDATE default from stamping the seed time.
    await trx('users')
      .where({ id: user.id })
      .update({ reportsToId: manager.id, updatedAt: user.updatedAt });
  }
  return users;
}

/**
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<Map<string, number>>} client name -> id (including the seeded "Internal")
 */
export async function insertClients(trx) {
  const existing = await trx('clients').select('id', 'name');
  const nextId = Math.max(0, ...existing.map((row) => row.id)) + 1;
  await trx('clients').insert(
    CLIENTS.map((client, i) => ({ id: nextId + i, name: client.name, isInternal: false })),
  );
  return new Map((await trx('clients').select('id', 'name')).map((row) => [row.name, row.id]));
}

/**
 * Inserts every project and its members (in canvas avatar order).
 * @param {import('knex').Knex.Transaction} trx
 * @param {{ when: (offset: number, clock: string) => Date, midday: boolean,
 *   users: Map<string, object>, clients: Map<string, number> }} ctx
 * @returns {Promise<Map<string, object>>} project key -> { id, name, color, minOffset, ... }
 */
export async function insertProjects(trx, ctx) {
  const all = [...PROJECTS, ...COMPLETED_PROJECTS];
  const projects = new Map();
  const rows = all.map((project, i) => {
    const row = projectRow(project, i, ctx);
    projects.set(project.key, { ...project, id: row.id, createdAt: row.createdAt });
    return row;
  });
  await trx('projects').insert(rows);

  const members = [];
  for (const project of projects.values()) {
    const pm = ctx.users.get(project.pm);
    project.members.forEach((key, i) => {
      members.push({
        projectId: project.id,
        userId: ctx.users.get(key).id,
        addedBy: pm.id,
        addedAt: new Date(project.createdAt.getTime() + i * 60_000),
      });
    });
  }
  await trx('projectMembers').insert(members);
  return projects;
}

function projectRow(project, i, ctx) {
  const pm = ctx.users.get(project.pm);
  const clientId = ctx.clients.get(project.client);
  if (!pm || !clientId) throw new Error(`Bad PM or client on project ${project.name}`);
  const ceo = ctx.users.get('ceo');
  let createdAt = ctx.when(120 + i * 7, '10:00');
  if (project.createdOffset !== null)
    createdAt = ctx.when(project.createdOffset, project.createdClock);
  if (project.status === 'completed') createdAt = ctx.when(project.completedOffset + 80, '10:00');
  const urgent = project.urgent && (!ctx.midday || project.urgent.midday) ? project.urgent : null;
  return {
    id: i + 1,
    name: project.name,
    clientId,
    pmId: pm.id,
    status: project.status,
    color: project.color,
    isUrgent: Boolean(urgent),
    urgentNote: urgent ? urgent.note : null,
    urgentMarkedAt: urgent ? ctx.when(0, urgent.clock) : null,
    urgentMarkedBy: urgent ? ctx.users.get(urgent.by).id : null,
    completedAt: project.status === 'completed' ? ctx.when(project.completedOffset, '17:30') : null,
    // Only PMs and Admins create projects; Hiring (PM Neha, HR) was set up by the CEO.
    createdBy: ['pm', 'admin'].includes(pm.role) ? pm.id : ceo.id,
    createdAt,
    updatedAt: urgent ? ctx.when(0, urgent.clock) : createdAt,
  };
}
