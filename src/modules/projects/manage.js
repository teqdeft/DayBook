// Project edits: fields and status, members and the urgent flag. PMs manage only projects where
// pm_id is them; Admin manages every project.
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { compactName } from '@/lib/text';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { loadProject } from './lookup';
import { sendMemberAdded, sendNewPm, sendUrgent } from './messages';
import * as repo from './repo';
import {
  activeMembers,
  assertManager,
  assertNameFree,
  duplicate,
  findOrCreateClient,
  loadActivePeople,
  notFound,
  snapshot,
  URGENT_NOTE_MESSAGE,
  withMembers,
} from './rules';
import { projectMembersSchema, projectUpdateSchema, projectUrgentSchema } from './schemas';
import { assertCanManage, isAdmin, isDuplicateKey, parseInput, toPerson } from './shared';

/**
 * Replaces the project's active members with `ids` inside a transaction. Deactivated members
 * stay (history). New members get added_by / added_at; the change is audited.
 * @returns {Promise<{ members: object[], added: number[] }>} the active member rows after the
 *   change, and the ids of the people who were newly added (to notify)
 */
async function replaceMembers({ user, project, ids, ip }, trx) {
  await loadActivePeople(ids, trx);
  const current = await repo.listMembers([project.id], trx);
  const currentIds = new Set(current.map((row) => row.id));
  const before = current.filter((row) => row.status === 'active').map((row) => row.id);
  const remove = before.filter((id) => !ids.includes(id));
  const add = ids.filter((id) => !currentIds.has(id));
  if (remove.length === 0 && add.length === 0) {
    return { members: await activeMembers(project.id, trx), added: [] };
  }
  const at = nowDate();
  await repo.deleteMembers(project.id, remove, trx);
  await repo.insertMembers(
    add.map((userId) => ({ projectId: project.id, userId, addedBy: user.id, addedAt: at })),
    trx,
  );
  await audit.log(
    {
      actorId: user.id,
      action: 'project.members',
      entityType: 'project',
      entityId: project.id,
      before: { memberIds: before },
      after: { memberIds: ids },
      ip,
    },
    trx,
  );
  return { members: await activeMembers(project.id, trx), added: add };
}

/** Locks the project row and checks the user may manage it. */
async function lockForManage(user, id, trx) {
  if (!can(user, 'project.manage')) throw new AppError('FORBIDDEN');
  const locked = await repo.lockById(id, trx);
  if (!locked) throw notFound();
  assertCanManage(user, locked);
  return loadProject(id, trx);
}

/** The column changes for the name, client, PM, colour and status fields. */
async function fieldChanges({ user, before, values }, trx) {
  const changes = {};
  if (values.name !== undefined && values.name !== before.name) {
    if (compactName(values.name) !== compactName(before.name)) {
      await assertNameFree(values.name, { excludeProjectId: before.id }, trx);
    }
    changes.name = values.name;
  }
  if (values.clientName !== undefined) {
    const clientId = await findOrCreateClient(values.clientName, trx);
    if (clientId !== before.clientId) changes.clientId = clientId;
  }
  if (values.pmId !== undefined && values.pmId !== before.pmId) {
    if (!isAdmin(user)) {
      const message = 'Only Admin can hand a project to another project manager.';
      throw validationError({ pmId: message }, message);
    }
    await assertManager(values.pmId, trx);
    changes.pmId = values.pmId;
  }
  if (values.color !== undefined && values.color !== before.color) changes.color = values.color;
  if (values.status !== undefined && values.status !== before.status) {
    changes.status = values.status;
    changes.completedAt = values.status === 'completed' ? nowDate() : null;
  }
  return changes;
}

/** Urgent column changes and what happened: 'marked', 'cleared' or null. */
function urgentChanges({ user, before, values, status }) {
  if (values.isUrgent === true && status !== 'active') {
    const message = 'Only active projects can be marked urgent.';
    throw validationError({ isUrgent: message }, message);
  }
  const wanted = status === 'active' && (values.isUrgent ?? before.isUrgent);
  const note = values.urgentNote !== undefined ? values.urgentNote || null : before.urgentNote;
  if (wanted && !note)
    throw validationError({ urgentNote: URGENT_NOTE_MESSAGE }, URGENT_NOTE_MESSAGE);
  if (wanted && (!before.isUrgent || note !== before.urgentNote)) {
    return {
      event: 'marked',
      changes: {
        isUrgent: true,
        urgentNote: note,
        urgentMarkedAt: nowDate(),
        urgentMarkedBy: user.id,
      },
    };
  }
  if (!wanted && before.isUrgent) {
    return {
      event: 'cleared',
      changes: { isUrgent: false, urgentNote: null, urgentMarkedAt: null, urgentMarkedBy: null },
    };
  }
  return { event: null, changes: {} };
}

/** Audits and announces an urgent change. */
async function afterUrgent({ user, event, before, project, members, ip }, trx) {
  if (!event) return;
  await audit.log(
    {
      actorId: user.id,
      action: event === 'marked' ? 'project.mark_urgent' : 'project.unmark_urgent',
      entityType: 'project',
      entityId: project.id,
      before: { urgentNote: before.urgentNote },
      after: { urgentNote: project.urgentNote },
      ip,
    },
    trx,
  );
  if (event === 'marked') {
    await sendUrgent({ project, note: project.urgentNote, actorName: user.name, members }, trx);
  }
}

/**
 * Edits a project (the Edit drawer and "Change status"): any of name, client, PM (Admin only),
 * members, status, colour and the urgent flag with its note, in one transaction. Moving a project
 * off active clears its urgent flag. Completing it sets completed_at. People newly added to the
 * team are notified (project.member_added).
 * @param {{ user: object, id: number, input: object, ip?: string | null }} args input as
 *   projectUpdateSchema
 * @returns {Promise<object>} the Project plus `members`
 * @throws NOT_FOUND, FORBIDDEN (not their project), VALIDATION_FAILED, DUPLICATE_PROJECT
 */
export async function update({ user, id, input, ip = null }) {
  const values = parseInput(projectUpdateSchema, input);
  return db.transaction(async (trx) => {
    const before = await lockForManage(user, id, trx);
    const changes = await fieldChanges({ user, before, values }, trx);
    const status = changes.status ?? before.status;
    const urgent = urgentChanges({ user, before, values, status });
    Object.assign(changes, urgent.changes);
    const { members, added } =
      values.memberIds !== undefined
        ? await replaceMembers({ user, project: before, ids: values.memberIds, ip }, trx)
        : { members: await activeMembers(id, trx), added: [] };
    if (Object.keys(changes).length > 0) {
      try {
        await repo.updateProject(id, { ...changes, updatedAt: nowDate() }, trx);
      } catch (error) {
        // Two people renamed projects to the same name at the same moment.
        if (isDuplicateKey(error))
          throw duplicate(`There is already a project called ${changes.name}.`);
        throw error;
      }
    }
    const project = await loadProject(id, trx);
    const fields = ['name', 'clientId', 'pmId', 'status', 'color'].filter((key) => key in changes);
    if (fields.length > 0) {
      await audit.log(
        {
          actorId: user.id,
          action: 'project.update',
          entityType: 'project',
          entityId: id,
          before: snapshot(before),
          after: snapshot(project),
          ip,
        },
        trx,
      );
    }
    await afterUrgent({ user, event: urgent.event, before, project, members, ip }, trx);
    await sendMemberAdded({ project, userIds: added, actor: user }, trx);
    if (changes.pmId && changes.pmId !== user.id) {
      await sendNewPm(
        { project, pmId: changes.pmId, body: `${user.name} made you its project manager.` },
        trx,
      );
    }
    return withMembers(project, members);
  });
}

/**
 * Replaces the member list (PUT /api/projects/:id/members). Only active people; deactivated
 * members are kept for history. People newly added are notified (project.member_added).
 * @param {{ user: object, id: number, userIds: number[], ip?: string | null }} args
 * @returns {Promise<object[]>} the active members after the change
 * @throws NOT_FOUND, FORBIDDEN, VALIDATION_FAILED
 */
export async function setMembers({ user, id, userIds, ip = null }) {
  const values = parseInput(projectMembersSchema, { userIds });
  return db.transaction(async (trx) => {
    const project = await lockForManage(user, id, trx);
    const { members, added } = await replaceMembers(
      { user, project, ids: values.userIds, ip },
      trx,
    );
    await sendMemberAdded({ project, userIds: added, actor: user }, trx);
    return members.map((row) => toPerson(row));
  });
}

/**
 * Marks an active project urgent with a note (1-200 characters): every member gets an in-app
 * notification and, when slack_urgent_notify is on, a Slack DM. Changing the note of an urgent
 * project announces the new note. Audited.
 * @param {{ user: object, id: number, note: string, ip?: string | null }} args
 * @returns {Promise<object>} the Project
 * @throws NOT_FOUND, FORBIDDEN, VALIDATION_FAILED, PROJECT_NOT_ACTIVE
 */
export async function markUrgent({ user, id, note, ip = null }) {
  const values = parseInput(projectUrgentSchema, { note });
  return db.transaction(async (trx) => {
    const before = await lockForManage(user, id, trx);
    if (before.status !== 'active') {
      throw new AppError('PROJECT_NOT_ACTIVE', {
        message: 'Only active projects can be marked urgent.',
      });
    }
    if (before.isUrgent && before.urgentNote === values.note) return before;
    await repo.updateProject(
      id,
      {
        isUrgent: true,
        urgentNote: values.note,
        urgentMarkedAt: nowDate(),
        urgentMarkedBy: user.id,
        updatedAt: nowDate(),
      },
      trx,
    );
    const project = await loadProject(id, trx);
    const members = await activeMembers(id, trx);
    await afterUrgent({ user, event: 'marked', before, project, members, ip }, trx);
    return project;
  });
}

/**
 * Removes the urgent flag and clears its note. Audited. Does nothing if it isn't urgent.
 * @param {{ user: object, id: number, ip?: string | null }} args
 * @returns {Promise<object>} the Project
 * @throws NOT_FOUND, FORBIDDEN
 */
export async function clearUrgent({ user, id, ip = null }) {
  return db.transaction(async (trx) => {
    const before = await lockForManage(user, id, trx);
    if (!before.isUrgent) return before;
    await repo.updateProject(
      id,
      {
        isUrgent: false,
        urgentNote: null,
        urgentMarkedAt: null,
        urgentMarkedBy: null,
        updatedAt: nowDate(),
      },
      trx,
    );
    const project = await loadProject(id, trx);
    await afterUrgent({ user, event: 'cleared', before, project, members: [], ip }, trx);
    return project;
  });
}
