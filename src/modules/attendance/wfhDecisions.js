// Decisions on work-from-home requests (CONTRACT 17): HR or an Admin approves or declines a
// pending request (never their own; an Admin's only an Admin sees), and the person may cancel
// their own, or end an approved one early once it has started. The person hears about a decision
// in the app and by Slack DM (slack_requests_notify).
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { addDays, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { escapeSlackText } from '@/modules/slack/format';
import { slack } from '@/modules/slack';
import { users } from '@/modules/users';
import * as repo from './repo';
import { showsAttendanceOf, todayFor } from './rules';
import { findRequest } from './wfh';
import { formatDayRange } from './wording';

function notFound() {
  return new AppError('NOT_FOUND', { message: 'That request no longer exists.' });
}

/**
 * The pending request (locked) and the person who asked, once the actor may decide on it. An
 * Admin's request looks missing to anyone but an Admin, pending or not, so probing ids never
 * confirms that an Admin asked.
 */
async function loadPending(id, actor, trx) {
  if (!can(actor, 'attendance.correct')) throw new AppError('FORBIDDEN');
  const request = await repo.lockWfh(id, trx);
  const person = request && (await users.findById(request.userId));
  if (!request || !showsAttendanceOf(actor, person)) throw notFound();
  if (Number(request.userId) === Number(actor.id)) {
    throw new AppError('FORBIDDEN', { message: "You can't handle your own request." });
  }
  if (request.status !== 'pending') throw new AppError('REQUEST_ALREADY_HANDLED');
  return { request, person };
}

async function tellPerson({ request, person, approved, reason }, trx) {
  const days = formatDayRange(request.fromDate, request.toDate);
  const verdict = approved ? 'approved' : 'declined';
  await notifications.notify(
    {
      userIds: [request.userId],
      type: `wfh_request.${verdict}`,
      title: `Working from home ${verdict} for ${days}`,
      body: approved ? null : reason,
      link: '/today',
    },
    trx,
  );
  const reasonLine = approved ? '' : `\nReason: ${escapeSlackText(reason)}`;
  await slack.queueDm(
    {
      slackUserId: person?.slackUserId,
      text: `Working from home ${verdict} for ${days}.${reasonLine}`,
      settingKey: 'slackRequestsNotify',
      relatedType: 'wfh_request',
      relatedId: request.id,
    },
    trx,
  );
}

/**
 * Approves (no reason) or declines (with one) a pending request, audited, and tells the person.
 * A request whose days are over can still be declined, but not approved: the person would hear
 * "yes" for days they can no longer use.
 */
async function decide({ actor, id, ip, approved, reason = null }) {
  const today = todayFor(await settings.getAll());
  await db.transaction(async (trx) => {
    const pending = await loadPending(id, actor, trx);
    const { request } = pending;
    if (approved && request.toDate < today) {
      throw new AppError('CONFLICT', { message: "Those days are over, so it can't be approved." });
    }
    const at = nowDate();
    const status = approved ? 'approved' : 'declined';
    const changes = {
      status,
      handledBy: actor.id,
      handledAt: at,
      declineReason: reason,
      updatedAt: at,
    };
    if ((await repo.updateWfhStatus(request.id, 'pending', changes, trx)) === 0) {
      throw new AppError('REQUEST_ALREADY_HANDLED');
    }
    await audit.log(
      {
        actorId: actor.id,
        action: approved ? 'wfh_request.approve' : 'wfh_request.decline',
        entityType: 'wfh_request',
        entityId: request.id,
        before: { status: 'pending' },
        after: { status, fromDate: request.fromDate, toDate: request.toDate },
        reason,
        ip,
      },
      trx,
    );
    await tellPerson({ ...pending, approved, reason }, trx);
  });
  return findRequest(id);
}

/**
 * HR (or an Admin) approves a pending request; on those days the person can check in as WFH.
 * @param {{ actor: { id: number, role: string, status?: string }, id: number,
 *   ip?: string | null }} input
 * @returns {Promise<object>} the request (toRequest() in wfh.js)
 * @throws FORBIDDEN (no attendance.correct, or their own request), NOT_FOUND (also an Admin's
 *   request when the actor isn't one), REQUEST_ALREADY_HANDLED, CONFLICT (its last day is
 *   before today)
 */
export async function approveWfh({ actor, id, ip }) {
  return decide({ actor, id, ip, approved: true });
}

/**
 * HR (or an Admin) declines a pending request with a reason (2-300 characters) the person sees.
 * @param {{ actor: { id: number, role: string, status?: string }, id: number, reason: string,
 *   ip?: string | null }} input
 * @returns {Promise<object>} the request (toRequest() in wfh.js)
 * @throws VALIDATION_FAILED (reason), FORBIDDEN (no attendance.correct, or their own request),
 *   NOT_FOUND (also an Admin's request when the actor isn't one), REQUEST_ALREADY_HANDLED
 */
export async function declineWfh({ actor, id, reason, ip }) {
  const text = String(reason ?? '').trim();
  const reasonError = (message) => validationError({ reason: message }, message);
  if (text.length < 2) throw reasonError('Add a reason for them.');
  if (text.length > 300) throw reasonError('Keep it to 300 characters or fewer.');
  return decide({ actor, id, ip, approved: false, reason: text });
}

/**
 * The last day an approved request that has started keeps when the person cancels the rest:
 * today when they already checked in from home today (that day is used), otherwise yesterday
 * (before fromDate: nothing is kept, the whole request is cancelled).
 * @throws CONFLICT when nothing is left to cancel (its days are over, or today is its last day
 *   and they checked in from home)
 */
async function lastKeptDay(request, today, trx) {
  const nothingLeft = (message) => new AppError('CONFLICT', { message });
  if (request.toDate < today) {
    throw nothingLeft("Those days are over, so there's nothing to cancel.");
  }
  const row = await repo.findByUserAndDate(request.userId, today, trx);
  const last = row?.location === 'wfh' ? today : addDays(today, -1);
  if (last >= request.toDate) {
    throw nothingLeft("Today is the last day and you've checked in from home, so it stays.");
  }
  return last;
}

/**
 * The person cancels their own request: a pending one, or an approved one before it starts. An
 * approved request that has started ends early instead: it stays approved up to lastKeptDay()
 * (toDate moves there) and is cancelled outright when that is before its first day. Audited as
 * wfh_request.cancel; nobody is notified. A cancelled request's handledBy is the person.
 * @param {{ user: { id: number }, id: number, ip?: string | null }} input
 * @returns {Promise<object>} the request (toRequest() in wfh.js): status 'cancelled', or
 *   'approved' with its new toDate
 * @throws NOT_FOUND (no such request, or someone else's), REQUEST_ALREADY_HANDLED (declined or
 *   cancelled), CONFLICT (approved and nothing is left to cancel, see lastKeptDay())
 */
export async function cancelWfh({ user, id, ip }) {
  const today = todayFor(await settings.getAll());
  await db.transaction(async (trx) => {
    const request = await repo.lockWfh(id, trx);
    if (!request || Number(request.userId) !== Number(user.id)) throw notFound();
    if (!['pending', 'approved'].includes(request.status)) {
      throw new AppError('REQUEST_ALREADY_HANDLED');
    }
    const started = request.status === 'approved' && request.fromDate <= today;
    const last = started ? await lastKeptDay(request, today, trx) : null;
    const at = nowDate();
    const shortens = last !== null && last >= request.fromDate;
    const [changes, before, after] = shortens
      ? [
          { toDate: last, updatedAt: at },
          { status: 'approved', toDate: request.toDate },
          { status: 'approved', toDate: last },
        ]
      : [
          { status: 'cancelled', handledBy: user.id, handledAt: at, updatedAt: at },
          { status: request.status, handledBy: request.handledBy },
          { status: 'cancelled' },
        ];
    if ((await repo.updateWfhStatus(request.id, request.status, changes, trx)) === 0) {
      throw new AppError('REQUEST_ALREADY_HANDLED');
    }
    const entry = { entityType: 'wfh_request', entityId: request.id, before, after, ip };
    await audit.log({ actorId: user.id, action: 'wfh_request.cancel', ...entry }, trx);
  });
  return findRequest(id);
}
