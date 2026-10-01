// Deciding project requests (build guide 7.7): any PM or Admin approves one (creating the
// project from the New project form) or declines it with a reason.
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { reports } from '@/modules/reports';
import { createInTransaction } from './create';
import { loadProject } from './lookup';
import { sendRequestDecided } from './messages';
import * as repo from './repo';
import { projectCreateSchema, projectRequestDeclineSchema } from './schemas';
import { isAdmin, parseInput, toRequest } from './shared';

function requestNotFound() {
  return new AppError('NOT_FOUND', { message: "We couldn't find that request." });
}

function canHandle(user) {
  return can(user, 'project_request.handle');
}

/** Locks a pending request. @throws NOT_FOUND, REQUEST_ALREADY_HANDLED */
async function lockPending(id, trx) {
  const locked = await repo.lockRequest(id, trx);
  if (!locked) throw requestNotFound();
  if (locked.status !== 'pending') throw new AppError('REQUEST_ALREADY_HANDLED');
  return toRequest(await repo.findRequest(id, trx));
}

/**
 * Approves a request by creating the project from the submitted New project fields, in one
 * transaction: the project is created (the requester is added as a member), the request is marked
 * approved with project_id, report entries logged to the request move to the new project, and the
 * requester is notified (the other members get project.member_added).
 * @param {{ user: object, id: number, input: object, ip?: string | null }} args input as
 *   projectCreateSchema
 * @returns {Promise<{ request: object, project: object }>}
 * @throws FORBIDDEN, NOT_FOUND, REQUEST_ALREADY_HANDLED, VALIDATION_FAILED, DUPLICATE_PROJECT
 */
export async function approveRequest({ user, id, input, ip = null }) {
  if (!canHandle(user) || !can(user, 'project.manage')) throw new AppError('FORBIDDEN');
  const values = parseInput(projectCreateSchema, input);
  if (!isAdmin(user) && values.pmId !== user.id) {
    const message = 'You can only create projects that you manage.';
    throw validationError({ pmId: message }, message);
  }
  return db.transaction(async (trx) => {
    const request = await lockPending(id, trx);
    const [requester] = await repo.findUsersByIds([request.requestedBy], trx);
    const memberIds =
      requester?.status === 'active' && !values.memberIds.includes(requester.id)
        ? [...values.memberIds, requester.id]
        : values.memberIds;
    const project = await createInTransaction(
      {
        user,
        values: { ...values, memberIds },
        ip,
        fromRequest: request,
        newPmNote: `Created from ${requester.name}'s project request.`,
        // The requester hears "Your project request was approved" instead.
        quietMemberIds: requester ? [requester.id] : [],
      },
      trx,
    );
    const at = nowDate();
    await repo.updateRequest(
      id,
      {
        status: 'approved',
        handledBy: user.id,
        handledAt: at,
        projectId: project.id,
        updatedAt: at,
      },
      trx,
    );
    const moved = await reports.moveProjectRequestEntries(
      { projectRequestId: request.id, projectId: project.id },
      trx,
    );
    await audit.log(
      {
        actorId: user.id,
        action: 'project_request.approve',
        entityType: 'project_request',
        entityId: request.id,
        before: { status: 'pending' },
        after: { status: 'approved', projectId: project.id, movedEntries: Number(moved) || 0 },
        ip,
      },
      trx,
    );
    await sendRequestDecided({ request, requester, approved: true, project }, trx);
    return { request: toRequest(await repo.findRequest(id, trx)), project };
  });
}

/** The active project to move logged hours to; required when hours were logged to the request. */
async function moveTarget({ requestId, projectId }, trx) {
  if (!projectId) {
    if (await reports.hasEntriesForProjectRequest(requestId)) {
      const message = 'Hours were already logged to this request. Pick a project to move them to.';
      throw validationError({ moveEntriesToProjectId: message }, message);
    }
    return null;
  }
  const target = await loadProject(projectId, trx);
  if (!target || target.status !== 'active') {
    const message = 'Pick an active project to move the logged hours to.';
    throw validationError({ moveEntriesToProjectId: message }, message);
  }
  return target;
}

/**
 * Declines a request with a reason (1-300 characters). When hours were already logged to it,
 * `moveEntriesToProjectId` (an active project) is required and those report entries move there.
 * The requester is notified with the reason.
 * @param {{ user: object, id: number, input: { reason: string,
 *   moveEntriesToProjectId?: number | null }, ip?: string | null }} args
 * @returns {Promise<{ request: object, movedEntries: number }>}
 * @throws FORBIDDEN, NOT_FOUND, REQUEST_ALREADY_HANDLED, VALIDATION_FAILED
 */
export async function declineRequest({ user, id, input, ip = null }) {
  if (!canHandle(user)) throw new AppError('FORBIDDEN');
  const values = parseInput(projectRequestDeclineSchema, input);
  return db.transaction(async (trx) => {
    const request = await lockPending(id, trx);
    const target = await moveTarget(
      { requestId: request.id, projectId: values.moveEntriesToProjectId },
      trx,
    );
    const moved = target
      ? Number(
          await reports.moveProjectRequestEntries(
            { projectRequestId: request.id, projectId: target.id },
            trx,
          ),
        ) || 0
      : 0;
    const at = nowDate();
    await repo.updateRequest(
      id,
      {
        status: 'declined',
        handledBy: user.id,
        handledAt: at,
        declineReason: values.reason,
        updatedAt: at,
      },
      trx,
    );
    await audit.log(
      {
        actorId: user.id,
        action: 'project_request.decline',
        entityType: 'project_request',
        entityId: request.id,
        before: { status: 'pending' },
        after: { status: 'declined', movedToProjectId: target?.id ?? null, movedEntries: moved },
        reason: values.reason,
        ip,
      },
      trx,
    );
    const [requester] = await repo.findUsersByIds([request.requestedBy], trx);
    await sendRequestDecided({ request, requester, approved: false, reason: values.reason }, trx);
    return { request: toRequest(await repo.findRequest(id, trx)), movedEntries: moved };
  });
}
