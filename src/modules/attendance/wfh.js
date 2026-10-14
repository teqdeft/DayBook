// Working from home needs HR's approval (CONTRACT 17): a person asks for a day or a few days, HR
// (or an Admin) approves or declines and the person may cancel or end early (wfhDecisions.js), and
// a request nobody decided on before its last day is out of date (no longer counted). Check-in
// allows WFH only on approved days. An Admin's requests reach and show to the other Admins only
// (CONTRACT 16, recipients.js).
import { env } from '@/lib/env';
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { initials } from '@/lib/text';
import { dayjs, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { escapeSlackText } from '@/modules/slack/format';
import { slack } from '@/modules/slack';
import { users } from '@/modules/users';
import { wfhApproversFor } from './recipients';
import * as repo from './repo';
import { clockOn, hidesAdmins, todayFor } from './rules';
import { formatDayRange } from './wording';

/** The most days one request may cover. */
export const MAX_WFH_DAYS = 14;

function fieldError(field, message) {
  return validationError({ [field]: message }, message);
}

/**
 * A request as the API shows it (a repo row with its people).
 * @returns {{ id: number, user: { id, name, initials, designation, role, status }, fromDate: string,
 *   toDate: string, days: string, reason: string, status: string,
 *   handledBy: { id: number, name: string } | null, handledAt: Date | null,
 *   declineReason: string | null, createdAt: Date }} days = "Tue, 14 – Thu, 16 Oct"; a cancelled
 *   request's handledBy is the person who cancelled it
 */
export function toRequest(row) {
  return {
    id: row.id,
    user: {
      id: row.userId,
      name: row.userName,
      initials: initials(row.userName),
      designation: row.userDesignation,
      role: row.userRole,
      status: row.userStatus,
    },
    fromDate: row.fromDate,
    toDate: row.toDate,
    days: formatDayRange(row.fromDate, row.toDate),
    reason: row.reason,
    status: row.status,
    handledBy: row.handledBy ? { id: row.handledBy, name: row.handlerName } : null,
    handledAt: row.handledAt,
    declineReason: row.declineReason,
    createdAt: row.createdAt,
  };
}

/** One request as the API shows it, by id. */
export async function findRequest(id) {
  const row = await repo.findWfh(id);
  return row ? toRequest(row) : null;
}

/**
 * True when `person` needs an approved request to check in as WFH: wfhRequiresApproval is on and
 * they can't correct attendance (HR and Admins are the approvers, so they never ask).
 * @param {{ role?: string, status?: string } | null} person
 * @param {{ wfhRequiresApproval: boolean }} current settings.getAll()
 */
export function needsWfhApproval(person, current) {
  return Boolean(current.wfhRequiresApproval) && !can(person, 'attendance.correct');
}

/**
 * Check-in's WFH rule (CONTRACT 17): someone who needs approval (needsWfhApproval) checks in as
 * WFH only on a day an approved request covers.
 * @param {{ user: { id: number, role?: string }, workDate: string, current: object }} input
 * @throws WFH_NOT_APPROVED
 */
export async function assertWfhAllowed({ user, workDate, current }) {
  if (!needsWfhApproval(user, current)) return;
  if (!(await repo.hasApprovedWfh(user.id, workDate))) throw new AppError('WFH_NOT_APPROVED');
}

/** fromDate today or later, toDate (default fromDate) not before it, at most MAX_WFH_DAYS days. */
function checkDays({ fromDate, toDate, today }) {
  const valid = (value) => typeof value === 'string' && dayjs(value, 'YYYY-MM-DD', true).isValid();
  if (!valid(fromDate)) throw fieldError('fromDate', 'Pick the first day.');
  const last = toDate || fromDate;
  if (!valid(last)) throw fieldError('toDate', 'Pick the last day.');
  if (fromDate < today) throw fieldError('fromDate', 'Pick today or a later day.');
  if (last < fromDate) throw fieldError('toDate', "The last day can't be before the first day.");
  if (dayjs(last).diff(dayjs(fromDate), 'day') + 1 > MAX_WFH_DAYS) {
    throw fieldError('toDate', `Ask for ${MAX_WFH_DAYS} days or fewer at a time.`);
  }
  return { fromDate, toDate: last };
}

function checkReason(reason) {
  const text = String(reason ?? '').trim();
  if (text.length < 5) throw fieldError('reason', 'Add a reason of at least 5 characters.');
  if (text.length > 500) throw fieldError('reason', 'Keep it to 500 characters or fewer.');
  return text;
}

/** REQUEST_ALREADY_PENDING naming the request that already covers some of the days. */
function overlapError(clash) {
  const days = formatDayRange(clash.fromDate, clash.toDate);
  const message =
    clash.status === 'approved'
      ? `Working from home is already approved for ${days}.`
      : `You already asked to work from home on ${days}.`;
  return new AppError('REQUEST_ALREADY_PENDING', { message, fields: { fromDate: message } });
}

async function tellApprovers({ approvers, user, request }, trx) {
  const days = formatDayRange(request.fromDate, request.toDate);
  await notifications.notify(
    {
      userIds: approvers.map((person) => person.id),
      type: 'wfh_request.created',
      title: `${user.name} asked to work from home on ${days}`,
      body: request.reason,
      link: '/attendance#wfh',
    },
    trx,
  );
  const text =
    `*${escapeSlackText(user.name)}* asked to work from home on ${days}.\n` +
    `Reason: ${escapeSlackText(request.reason)}\n` +
    `<${env.appOrigin}/attendance#wfh|Open Attendance>`;
  for (const person of approvers) {
    await slack.queueDm(
      {
        slackUserId: person.slackUserId,
        text,
        settingKey: 'slackRequestsNotify',
        relatedType: 'wfh_request',
        relatedId: request.id,
      },
      trx,
    );
  }
}

/**
 * A person asks to work from home (POST /api/wfh-requests). Notifies the approvers in the app and
 * by Slack DM (slack_requests_notify): HR, or the Admins when there is no HR; an HR person's
 * request goes to the Admins, an Admin's to the other Admins (recipients.js). Audited.
 * @param {{ user: { id: number, name: string, role: string, status?: string,
 *   tracksAttendance: boolean }, fromDate: string, toDate?: string | null, reason: string,
 *   ip?: string | null }} input dates 'YYYY-MM-DD' in company time, both included
 * @returns {Promise<object>} the new request (toRequest())
 * @throws FORBIDDEN (not someone who checks in), VALIDATION_FAILED (fromDate before today, toDate
 *   before fromDate, more than 14 days, reason under 5 or over 500 characters),
 *   REQUEST_ALREADY_PENDING (with fields: overlaps their own pending or approved request)
 */
export async function requestWfh({ user, fromDate, toDate, reason, ip }) {
  if (!can(user, 'attendance.self') || !user.tracksAttendance) {
    throw new AppError('FORBIDDEN', { message: 'Only people who check in can ask for this.' });
  }
  const current = await settings.getAll();
  const days = checkDays({ fromDate, toDate, today: todayFor(current) });
  const why = checkReason(reason);
  const approvers = await wfhApproversFor(user);
  const at = nowDate();
  const record = { userId: user.id, ...days, reason: why, status: 'pending' };
  // REPEATABLE READ: the overlap check locks the gap a second request (a double tap) would use.
  const id = await repo.transaction(
    async (trx) => {
      const clash = await repo.findOverlappingWfh({ userId: user.id, ...days }, trx, {
        forUpdate: true,
      });
      if (clash) throw overlapError(clash);
      const newId = await repo.insertWfh({ ...record, createdAt: at, updatedAt: at }, trx);
      await audit.log(
        {
          actorId: user.id,
          action: 'wfh_request.create',
          entityType: 'wfh_request',
          entityId: newId,
          after: { ...days, status: 'pending' },
          reason: why,
          ip,
        },
        trx,
      );
      await tellApprovers({ approvers, user, request: { ...record, id: newId } }, trx);
      return newId;
    },
    { isolationLevel: 'repeatable read' },
  );
  return findRequest(id);
}

/**
 * Work-from-home requests. Approvers (attendance.correct) get everyone's, an Admin's only when
 * they are an Admin; anyone else gets only their own. No viewer (a system read) gets everyone's.
 * @param {{ viewer?: { id: number, role: string, status?: string }, status?: 'pending' |
 *   'approved' | 'declined' | 'cancelled', userId?: number, handledSince?: string,
 *   limit?: number, offset?: number }} [options] handledSince 'YYYY-MM-DD' (the Attendance card:
 *   7 days back): pending requests whose last day is that day or later, plus those handled from
 *   that company day on. A pending request whose last day is before today is out of date: nobody
 *   decided in time (the card shows it as expired)
 * @returns {Promise<{ items: object[], total: number }>} pending first (soonest day first), then
 *   the most recently handled; items as toRequest()
 */
export async function listWfhRequests({
  viewer,
  status,
  userId,
  handledSince,
  limit = 50,
  offset = 0,
} = {}) {
  const approver = !viewer || can(viewer, 'attendance.correct');
  const since = handledSince
    ? { date: handledSince, at: clockOn(handledSince, '00:00', await settings.getAll()) }
    : null;
  const where = {
    status,
    userId: approver ? userId : viewer.id,
    hideAdmins: hidesAdmins(viewer),
    handledSince: since,
  };
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const [rows, total] = await Promise.all([
    repo.listWfh({ ...where, limit: size, offset: Math.max(Number(offset) || 0, 0) }),
    repo.countWfh(where),
  ]);
  return { items: rows.map(toRequest), total };
}

/**
 * Pending requests the viewer may decide on (the Attendance nav badge, with the corrections):
 * never their own, an Admin's only for an Admin, and 0 for someone without attendance.correct.
 * Only requests whose last day is today or later: one whose days are over can't be used any more.
 * No viewer counts every such request.
 * @param {{ viewer?: { id: number, role: string, status?: string } }} [options]
 * @returns {Promise<number>}
 */
export async function countPendingWfh({ viewer } = {}) {
  if (viewer && !can(viewer, 'attendance.correct')) return 0;
  return repo.countWfh({
    status: 'pending',
    endsFrom: todayFor(await settings.getAll()),
    exceptUserId: viewer?.id,
    hideAdmins: hidesAdmins(viewer),
  });
}

/**
 * A person's work-from-home state for a day (the Today card).
 * @param {number} userId
 * @param {string} workDate 'YYYY-MM-DD'
 * @param {{ user?: { role?: string, status?: string }, current?: object }} [options] the person
 *   and settings.getAll() when the caller has them (saves the lookups)
 * @returns {Promise<{ required: boolean, approved: object | null, pending: object[] }>}
 *   required: this person needs an approved request to check in as WFH (needsWfhApproval);
 *   approved: the approved request covering the day; pending: requests waiting for HR
 */
export async function getWfhForDay(userId, workDate, { user, current } = {}) {
  const [rows, values, person] = await Promise.all([
    repo.listWfhCovering(userId, workDate),
    current ?? settings.getAll(),
    user ?? users.findById(userId),
  ]);
  const requests = rows.map(toRequest);
  return {
    required: needsWfhApproval(person, values),
    approved: requests.find((request) => request.status === 'approved') ?? null,
    pending: requests.filter((request) => request.status === 'pending'),
  };
}
