// Creating a project (the New project form, and approving a project request).
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { loadProject } from './lookup';
import { sendMemberAdded, sendNewPm, sendUrgent } from './messages';
import * as repo from './repo';
import {
  assertManager,
  assertNameFree,
  duplicate,
  findOrCreateClient,
  loadActivePeople,
  snapshot,
  withMembers,
} from './rules';
import { projectCreateSchema } from './schemas';
import { isAdmin, isDuplicateKey, parseInput } from './shared';

/**
 * Creates a project inside the caller's transaction (also used when a project request is
 * approved). Values are already validated with projectCreateSchema.
 * Members are notified (project.member_added), except the creator and `quietMemberIds`.
 * @param {{ user: object, values: object, ip?: string | null, fromRequest?: { id: number,
 *   name: string }, newPmNote?: string, quietMemberIds?: number[] }} args fromRequest: the
 *   request being approved; it and other pending requests for the same name (someone sent theirs
 *   anyway) don't block the name. quietMemberIds: members who hear about it another way (the
 *   requester of an approved request)
 * @returns {Promise<object>} the Project plus `members`
 */
export async function createInTransaction(
  { user, values, ip, fromRequest, newPmNote, quietMemberIds = [] },
  trx,
) {
  await assertNameFree(
    values.name,
    { excludeRequestId: fromRequest?.id, ignoreRequestsLike: fromRequest?.name },
    trx,
  );
  await assertManager(values.pmId, trx);
  const people = await loadActivePeople(values.memberIds, trx);
  const clientId = await findOrCreateClient(values.clientName, trx);
  const at = nowDate();
  const urgent = values.status === 'active' && values.isUrgent;
  let id;
  try {
    id = await repo.insertProject(
      {
        name: values.name,
        clientId,
        pmId: values.pmId,
        status: values.status,
        color: values.color,
        isUrgent: urgent,
        urgentNote: urgent ? values.urgentNote : null,
        urgentMarkedAt: urgent ? at : null,
        urgentMarkedBy: urgent ? user.id : null,
        completedAt: null,
        createdBy: user.id,
        createdAt: at,
        updatedAt: at,
      },
      trx,
    );
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicate(`There is already a project called ${values.name}.`);
    throw error;
  }
  await repo.insertMembers(
    people.map((person) => ({ projectId: id, userId: person.id, addedBy: user.id, addedAt: at })),
    trx,
  );
  const project = await loadProject(id, trx);
  const memberIds = people.map((person) => person.id);
  await audit.log(
    {
      actorId: user.id,
      action: 'project.create',
      entityType: 'project',
      entityId: id,
      after: snapshot(project, memberIds),
      ip,
    },
    trx,
  );
  if (urgent) {
    await audit.log(
      {
        actorId: user.id,
        action: 'project.mark_urgent',
        entityType: 'project',
        entityId: id,
        after: { urgentNote: project.urgentNote },
        ip,
      },
      trx,
    );
    await sendUrgent(
      { project, note: project.urgentNote, actorName: user.name, members: people },
      trx,
    );
  }
  await sendMemberAdded({ project, userIds: memberIds, actor: user, skipIds: quietMemberIds }, trx);
  if (project.pmId !== user.id) {
    await sendNewPm(
      { project, pmId: project.pmId, body: newPmNote ?? `${user.name} created it in Daybook.` },
      trx,
    );
  }
  return withMembers(project, people);
}

/**
 * Creates a project (the New project form). A PM can only create projects they manage; Admin may
 * pick any active PM or Admin. The client is found by name or created in the same transaction.
 * Members must be active. Marking it urgent right away notifies the members.
 * @param {{ user: object, input: object, ip?: string | null }} args input as projectCreateSchema:
 *   { name, clientName, pmId, memberIds?, status?, color?, isUrgent?, urgentNote? }
 * @returns {Promise<object>} the Project plus `members`
 * @throws FORBIDDEN, VALIDATION_FAILED, DUPLICATE_PROJECT (same name ignoring case, spaces and
 *   dashes as a project or a pending request)
 */
export async function create({ user, input, ip = null }) {
  if (!can(user, 'project.manage')) throw new AppError('FORBIDDEN');
  const values = parseInput(projectCreateSchema, input);
  if (!isAdmin(user) && values.pmId !== user.id) {
    const message = 'You can only create projects that you manage.';
    throw validationError({ pmId: message }, message);
  }
  return db.transaction((trx) => createInTransaction({ user, values, ip }, trx));
}
