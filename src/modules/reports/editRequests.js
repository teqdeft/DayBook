// Report edit requests (build guide 7.4.8-7.4.9 and section 2 "Who handles what"): a person asks
// to change a locked report (or add a forgotten day); their PM (or an Admin) approves, which
// opens the report for 24 hours, or declines with a reason.
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { initials } from '@/lib/text';
import {
  dayjs,
  formatDayShort,
  formatTimeAmPm,
  locksAtFor,
  now,
  nowDate,
  workDate,
} from '@/lib/time';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { slack } from '@/modules/slack';
import { escapeSlackText } from '@/modules/slack/format';
import { users } from '@/modules/users';
import { insertDraft, planCarryOver } from './drafts';
import * as repo from './repo';
import { isEditable } from './view';

export const UNLOCK_HOURS = 24;

/** The edit request as the API and pages show it. */
export function editRequestView(row) {
  return {
    id: row.id,
    reportId: row.reportId ?? null,
    workDate: row.workDate,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
    handledAt: row.handledAt ?? null,
    declineReason: row.declineReason ?? null,
    handledBy: row.handledBy ? { id: row.handledBy, name: row.handledByName } : null,
    requester: {
      id: row.requestedBy,
      name: row.requesterName,
      designation: row.requesterDesignation,
      role: row.requesterRole,
      status: row.requesterStatus,
      avatarUrl: row.requesterAvatarUrl ?? null,
      initials: initials(row.requesterName),
    },
  };
}

/**
 * Which requests a person may handle: Admin any, a PM only those of people who report to them;
 * never their own.
 * @returns {{ reportsToId: number | null, selfId: number } | null} null when they may handle none
 */
function scopeFor(user) {
  if (!user || !can(user, 'report.approve_edit')) return null;
  if (user.role === 'admin') return { reportsToId: null, selfId: user.id };
  return { reportsToId: user.id, selfId: user.id };
}

function mayHandle(user, request) {
  const scope = scopeFor(user);
  if (!scope || Number(request.requestedBy) === Number(user.id)) return false;
  return scope.reportsToId === null || Number(request.requesterReportsToId) === Number(user.id);
}

const link = (path, label) => `<${env.appOrigin}${path}|${label}>`;

/**
 * Sends an edit request for a locked report, or for a missing day after its lock. Notifies the
 * approvers (their PM, otherwise every Admin) in the app and by Slack DM.
 * @param {{ user: object, workDate: string, reason: string }} input
 * @returns {Promise<object>} the new request (editRequestView)
 * @throws REPORT_IN_FUTURE, VALIDATION_FAILED (a day before the person joined), REPORT_NOT_LOCKED,
 *   REQUEST_ALREADY_PENDING
 */
export async function requestEdit({ user, workDate: day, reason }) {
  const current = await settings.getAll();
  if (day > workDate(current.timezone)) throw new AppError('REPORT_IN_FUTURE');
  if (user.joinedOn && day < user.joinedOn) {
    const message = 'That day is before you joined, so there is no report to edit.';
    throw new AppError('VALIDATION_FAILED', { message, fields: { workDate: message } });
  }
  const report = await repo.findByUserAndDate(user.id, day);
  const stillOpen = report
    ? isEditable(report)
    : now().isBefore(dayjs(locksAtFor(day, current.reportLock, current.timezone)));
  if (stillOpen) throw new AppError('REPORT_NOT_LOCKED');
  if (await repo.findPendingEditRequest(user.id, day)) throw alreadyPending();
  const approverIds = (await users.getReportApproverIds(user.id))
    .map(Number)
    .filter((id) => id && id !== Number(user.id));
  const approvers = approverIds.length ? await users.findByIds(approverIds) : [];
  const active = approvers.filter((person) => person && person.status !== 'deactivated');
  const dayLabel = formatDayShort(day);
  const at = nowDate();
  const id = await db
    .transaction(async (trx) => {
      // Checked again under a lock: a double click must not leave two pending requests.
      if (await repo.findPendingEditRequestForUpdate(user.id, day, trx)) throw alreadyPending();
      return insertRequest({ user, day, dayLabel, reason, report, approvers: active, at }, trx);
    })
    .catch((error) => {
      // Two requests at the same moment: InnoDB picks one as the deadlock victim.
      if (error?.errno === 1213) throw alreadyPending();
      throw error;
    });
  return editRequestView(await repo.findEditRequest(id));
}

function alreadyPending() {
  return new AppError('REQUEST_ALREADY_PENDING', {
    message: 'You already asked to edit this report. Wait for an answer first.',
  });
}

/** Inside requestEdit's transaction: the request row, the notifications and the Slack DMs. */
async function insertRequest({ user, day, dayLabel, reason, report, approvers, at }, trx) {
  const requestId = await repo.insertEditRequest(
    {
      reportId: report?.id ?? null,
      workDate: day,
      requestedBy: user.id,
      reason,
      status: 'pending',
      createdAt: at,
      updatedAt: at,
    },
    trx,
  );
  await notifications.notify(
    {
      userIds: approvers.map((person) => person.id),
      type: 'report_edit.requested',
      title: `${user.name} wants to edit the report for ${dayLabel}`,
      body: reason,
      link: '/requests',
    },
    trx,
  );
  await notifications.notify(
    {
      userIds: [user.id],
      type: 'report_edit.sent',
      title: `Edit request sent for ${dayLabel}`,
      body: reason,
      link: '/log',
    },
    trx,
  );
  const text =
    `${escapeSlackText(user.name)} wants to edit the report for ${dayLabel}: ` +
    `"${escapeSlackText(reason)}" ${link('/requests', 'Open requests')}`;
  for (const person of approvers) {
    await slack.queueDm(
      {
        slackUserId: person.slackUserId,
        text,
        settingKey: 'slackRequestsNotify',
        relatedType: 'report_edit_request',
        relatedId: requestId,
      },
      trx,
    );
  }
  return requestId;
}

/**
 * Loads a request the person may handle and that is still pending.
 * @throws NOT_FOUND, FORBIDDEN, REQUEST_ALREADY_HANDLED
 */
async function findHandleable(user, requestId) {
  const request = await repo.findEditRequest(requestId);
  if (!request) throw new AppError('NOT_FOUND', { message: "We couldn't find that request." });
  if (Number(request.requestedBy) === Number(user.id)) {
    throw new AppError('FORBIDDEN', { message: "You can't handle your own edit request." });
  }
  if (!mayHandle(user, request)) {
    throw new AppError('FORBIDDEN', {
      message: 'Only their project manager or an Admin can handle this request.',
    });
  }
  if (request.status !== 'pending') throw new AppError('REQUEST_ALREADY_HANDLED');
  return request;
}

async function lockPending(requestId, trx) {
  const row = await repo.lockEditRequest(requestId, trx);
  if (!row || row.status !== 'pending') throw new AppError('REQUEST_ALREADY_HANDLED');
}

async function tellRequester({ request, type, title, body, linkPath, dm }, trx) {
  await notifications.notify(
    { userIds: [request.requestedBy], type, title, body, link: linkPath },
    trx,
  );
  await slack.queueDm(
    {
      slackUserId: request.requesterSlackUserId,
      text: dm,
      settingKey: 'slackRequestsNotify',
      relatedType: 'report_edit_request',
      relatedId: request.id,
    },
    trx,
  );
}

/**
 * Approves an edit request: the report opens for 24 hours (unlocked_until), created as a draft
 * (with carry-over) when the day has no report yet. The requester is notified.
 * @param {{ user: object, requestId: number, ip?: string | null }} input
 * @returns {Promise<object>} the handled request (editRequestView)
 * @throws NOT_FOUND, FORBIDDEN, REQUEST_ALREADY_HANDLED
 */
export async function approveEditRequest({ user, requestId, ip = null }) {
  const request = await findHandleable(user, requestId);
  const current = await settings.getAll();
  const tz = current.timezone;
  const until = now().add(UNLOCK_HOURS, 'hour').toDate();
  const existing = await repo.findByUserAndDate(request.requestedBy, request.workDate);
  const plan = existing ? [] : await planCarryOver(request.requestedBy, request.workDate);
  const dayLabel = formatDayShort(request.workDate);
  const untilText = `${formatTimeAmPm(until, tz)} on ${formatDayShort(workDate(tz, until))}`;
  const reportPath = `/report?date=${request.workDate}`;
  await db.transaction(async (trx) => {
    await lockPending(requestId, trx);
    const at = nowDate();
    const report = await repo.findByUserAndDate(request.requestedBy, request.workDate, trx);
    let reportId = report?.id;
    if (report) {
      await repo.updateReport(reportId, { unlockedUntil: until, updatedAt: at }, trx);
    } else {
      const locksAt = locksAtFor(request.workDate, current.reportLock, tz);
      const draft = { userId: request.requestedBy, workDate: request.workDate, locksAt, plan };
      reportId = await insertDraft({ ...draft, unlockedUntil: until }, trx);
    }
    await repo.updateEditRequest(
      requestId,
      { status: 'approved', handledBy: user.id, handledAt: at, reportId, updatedAt: at },
      trx,
    );
    await tellRequester(
      {
        request,
        type: 'report_edit.approved',
        title: `Your edit request for ${dayLabel} was approved`,
        body: `You can change the report until ${untilText}.`,
        linkPath: reportPath,
        dm:
          `${escapeSlackText(user.name)} approved your edit request for ${dayLabel}. ` +
          `You can change the report until ${untilText}. ${link(reportPath, 'Open the report')}`,
      },
      trx,
    );
    await audit.log(
      {
        actorId: user.id,
        action: 'report_edit.approve',
        entityType: 'report_edit_request',
        entityId: requestId,
        after: { status: 'approved', reportId, unlockedUntil: until },
        reason: request.reason,
        ip,
      },
      trx,
    );
  });
  return editRequestView(await repo.findEditRequest(requestId));
}

/**
 * Declines an edit request with a reason; the requester is notified.
 * @param {{ user: object, requestId: number, reason: string, ip?: string | null }} input
 * @returns {Promise<object>} the handled request (editRequestView)
 * @throws NOT_FOUND, FORBIDDEN, REQUEST_ALREADY_HANDLED
 */
export async function declineEditRequest({ user, requestId, reason, ip = null }) {
  const request = await findHandleable(user, requestId);
  const dayLabel = formatDayShort(request.workDate);
  await db.transaction(async (trx) => {
    await lockPending(requestId, trx);
    const at = nowDate();
    await repo.updateEditRequest(
      requestId,
      {
        status: 'declined',
        handledBy: user.id,
        handledAt: at,
        declineReason: reason,
        updatedAt: at,
      },
      trx,
    );
    await tellRequester(
      {
        request,
        type: 'report_edit.declined',
        title: `Your edit request for ${dayLabel} was declined`,
        body: reason,
        linkPath: '/log',
        dm:
          `${escapeSlackText(user.name)} declined your edit request for ${dayLabel}: ` +
          `"${escapeSlackText(reason)}" ${link('/log', 'Open My log')}`,
      },
      trx,
    );
    await audit.log(
      {
        actorId: user.id,
        action: 'report_edit.decline',
        entityType: 'report_edit_request',
        entityId: requestId,
        after: { status: 'declined' },
        reason,
        ip,
      },
      trx,
    );
  });
  return editRequestView(await repo.findEditRequest(requestId));
}

/**
 * A page of edit requests this person may handle ('pending' newest first, 'handled' most
 * recently handled first).
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function pageEditRequestsFor(
  user,
  { status = 'pending', limit = 50, offset = 0 } = {},
) {
  const scope = scopeFor(user);
  if (!scope) return { rows: [], total: 0 };
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const page = await repo.pageEditRequests({
    status,
    reportsToId: scope.reportsToId,
    excludeUserId: scope.selfId,
    limit: size,
    offset: Math.max(Number(offset) || 0, 0),
  });
  return { rows: page.rows.map(editRequestView), total: page.total };
}

/**
 * Pending edit requests this person may approve, newest first (Requests screen).
 * @returns {Promise<Array<{ id, workDate, reason, createdAt, requester: { id, name, designation,
 *   role, status, avatarUrl, initials } }>>}
 */
export async function listPendingEditRequestsFor(user) {
  return (await pageEditRequestsFor(user, { status: 'pending', limit: 100 })).rows;
}

/**
 * Recently handled edit requests in this person's scope (Requests "Recently handled").
 * @returns {Promise<object[]>} the same shape plus status, handledAt, declineReason, handledBy
 */
export async function listHandledEditRequestsFor(user, { limit = 10 } = {}) {
  return (await pageEditRequestsFor(user, { status: 'handled', limit })).rows;
}

/** How many edit requests wait for this person (the Requests badge). */
export async function countPendingEditRequestsFor(user) {
  return (await pageEditRequestsFor(user, { status: 'pending', limit: 1 })).total;
}

/** A person's own edit requests for report days in a range, newest first (My log). */
export async function listMyEditRequests(userId, { from, to, limit = 5 }) {
  const rows = await repo.listEditRequestsByUser(userId, { from, to, limit });
  return rows.map(editRequestView);
}
