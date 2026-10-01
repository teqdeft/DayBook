// Project requests (build guide 7.7): someone asks for a missing project, and PMs and Admins see
// what waits for them. Approving and declining live in decisions.js.
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { compactName } from '@/lib/text';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { reports } from '@/modules/reports';
import { findSimilarName, loadProject } from './lookup';
import { sendRequestCreated } from './messages';
import * as repo from './repo';
import { projectRequestCreateSchema } from './schemas';
import { parseInput, toRequest } from './shared';

const HANDLED = ['approved', 'declined'];

function alreadyPending(name) {
  const message = `You already asked for ${name}. Your PM will handle it soon.`;
  return new AppError('REQUEST_ALREADY_PENDING', { message, fields: { name: message } });
}

function canHandle(user) {
  return can(user, 'project_request.handle');
}

/**
 * Who hears about a new request (guide 2 and 11): the requester's reports_to when that is an active
 * PM, otherwise every active Admin. They get the bell and a Slack DM. Any other PM or Admin can
 * still handle it from Requests (its badge counts every pending request). The requester is never
 * notified of their own request.
 */
async function approversFor(requester, trx) {
  if (requester.reportsToId && requester.reportsToId !== requester.id) {
    const [lead] = await repo.findUsersByIds([requester.reportsToId], trx);
    if (lead?.status === 'active' && lead.role === 'pm') return [lead];
  }
  return (await repo.listActiveUsers({ roles: ['admin'] }, trx)).filter(
    (admin) => admin.id !== requester.id,
  );
}

/** The match shown in the Request a project dialog. */
async function describeSimilar(similar) {
  if (similar.kind === 'request') {
    return {
      kind: 'request',
      requestId: similar.requestId,
      name: similar.name,
      requestedByName: similar.requestedByName,
    };
  }
  const project = await loadProject(similar.id);
  return {
    kind: 'project',
    id: similar.id,
    name: similar.name,
    status: similar.status,
    clientName: project?.clientName ?? null,
  };
}

/**
 * Asks for a missing project. The name is first compared with every project and pending request,
 * ignoring case, spaces and dashes: when one matches and `sendAnyway` is not set, nothing is saved
 * and the match comes back as `similarProject` so the dialog can suggest it. The request notifies
 * the requester's PM, or the Admins when they have none (bell + Slack DM when
 * slack_requests_notify is on).
 * @param {{ user: object, input: { name: string, note: string, sendAnyway?: boolean },
 *   ip?: string | null }} args
 * @returns {Promise<{ request: object | null, similarProject: object | null }>} request is null
 *   when it was not sent because of a match
 * @throws FORBIDDEN, VALIDATION_FAILED, REQUEST_ALREADY_PENDING (they already asked for it)
 */
export async function createRequest({ user, input, ip = null }) {
  if (!can(user, 'project.request')) throw new AppError('FORBIDDEN');
  const values = parseInput(projectRequestCreateSchema, input);
  const similar = await findSimilarName(values.name);
  if (similar?.kind === 'request' && similar.requestedBy === user.id) {
    throw alreadyPending(similar.name);
  }
  const similarProject = similar ? await describeSimilar(similar) : null;
  if (similarProject && !values.sendAnyway) return { request: null, similarProject };
  const request = await db.transaction(async (trx) => {
    // One request at a time per person, so a double submit can't save the same request twice.
    await repo.lockUser(user.id, trx);
    const key = compactName(values.name);
    const own = (await repo.listPendingRequestNames(trx)).find(
      (row) => row.requestedBy === user.id && compactName(row.name) === key,
    );
    if (own) throw alreadyPending(own.name);
    const at = nowDate();
    const id = await repo.insertRequest(
      {
        requestedBy: user.id,
        name: values.name,
        note: values.note,
        status: 'pending',
        createdAt: at,
        updatedAt: at,
      },
      trx,
    );
    const created = toRequest(await repo.findRequest(id, trx));
    const [requester] = await repo.findUsersByIds([user.id], trx);
    const approvers = await approversFor(requester, trx);
    await sendRequestCreated({ request: created, requester, approvers }, trx);
    await audit.log(
      {
        actorId: user.id,
        action: 'project_request.create',
        entityType: 'project_request',
        entityId: id,
        after: { name: values.name, note: values.note },
        ip,
      },
      trx,
    );
    return created;
  });
  return { request, similarProject };
}

/**
 * The person's own pending request, if it is still pending (a report entry can point at it).
 * @param {number} requestId
 * @param {number} userId
 * @returns {Promise<{ id, name, note, status, requestedBy, createdAt } | null>}
 */
export async function findPendingRequestForUser(requestId, userId) {
  if (!Number.isInteger(Number(requestId)) || Number(requestId) <= 0) return null;
  const row = await repo.findRequest(Number(requestId));
  if (!row || row.status !== 'pending' || Number(row.requestedBy) !== Number(userId)) return null;
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    status: row.status,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt,
  };
}

/**
 * How many project requests wait for this person (the Requests badge). Any PM or Admin can
 * handle every pending request.
 * @param {object} user
 * @returns {Promise<number>}
 */
export async function countPendingRequestsFor(user) {
  if (!canHandle(user)) return 0;
  return repo.countRequests({ status: 'pending' });
}

/**
 * Pending project requests for the Requests screen, newest first. `hasEntries` says whether hours
 * were already logged to the request (declining then needs a project to move them to).
 * @param {object} user
 * @returns {Promise<Array<{ id, name, note, createdAt, hasEntries, requester: { id, name,
 *   initials, designation, role, status, avatarUrl } }>>}
 */
export async function listPendingRequestsFor(user) {
  if (!canHandle(user)) return [];
  const rows = (await repo.listRequests({ status: 'pending', limit: 100 })).map(toRequest);
  const flags = await Promise.all(
    rows.map((row) => reports.hasEntriesForProjectRequest(row.id).catch(() => false)),
  );
  return rows.map((row, index) => ({ ...row, hasEntries: Boolean(flags[index]) }));
}

/**
 * The latest decisions on project requests ("Recently handled"), most recent first.
 * @param {object} user
 * @param {{ limit?: number }} [options] default 10, at most 100
 * @returns {Promise<Array<{ id, name, note, status: 'approved'|'declined', createdAt, handledAt,
 *   handledBy, declineReason, projectId, projectName, requester }>>}
 */
export async function listHandledRequestsFor(user, { limit = 10 } = {}) {
  if (!canHandle(user)) return [];
  const size = Math.min(Math.max(Math.trunc(Number(limit)) || 10, 1), 100);
  return (await repo.listRequests({ status: HANDLED, limit: size })).map(toRequest);
}

/**
 * GET /api/project-requests: requests with one status, for PMs and Admins.
 * @param {{ user: object, status?: string, limit?: number, offset?: number }} args
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function listRequests({ user, status = 'pending', limit = 50, offset = 0 }) {
  if (!canHandle(user)) throw new AppError('FORBIDDEN');
  const size = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 100);
  const skip = Math.max(Math.trunc(Number(offset)) || 0, 0);
  const [rows, total] = await Promise.all([
    repo.listRequests({ status, limit: size, offset: skip }),
    repo.countRequests({ status }),
  ]);
  return { rows: rows.map(toRequest), total };
}
