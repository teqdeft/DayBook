// HR's decision on a correction request (guide 7.8): approve updates or creates the attendance
// row and audits it with the person's reason; reject needs a note. The person hears back either
// way, in the app and by Slack DM (slack_requests_notify).
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { formatDayShort, nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { escapeSlackText } from '@/modules/slack/format';
import { slack } from '@/modules/slack';
import { users } from '@/modules/users';
import { assertOrder, auditView } from './hr';
import * as repo from './repo';
import { computeLateMinutes, workingDayFlag } from './rules';
import { approvedDetail } from './wording';

function fieldError(field, message) {
  return validationError({ [field]: message }, message);
}

async function loadPending(id, actor, trx) {
  const correction = await repo.findCorrection(id, trx, { forUpdate: true });
  if (!correction) throw new AppError('NOT_FOUND', { message: 'That request no longer exists.' });
  // Nobody decides on their own attendance; another HR person or an Admin does.
  if (Number(correction.userId) === Number(actor.id)) {
    throw new AppError('FORBIDDEN', { message: "You can't handle your own correction request." });
  }
  if (correction.status !== 'pending') throw new AppError('REQUEST_ALREADY_HANDLED');
  return correction;
}

/** Applies an approved correction to the attendance row; returns [before, after] rows. */
async function applyCorrection(correction, current, trx) {
  const person = await users.findById(correction.userId);
  const late = (checkInAt) =>
    computeLateMinutes({
      checkInAt,
      workDate: correction.workDate,
      shiftStart: person?.shiftStart,
      settings: current,
    });
  const at = nowDate();
  if (correction.type === 'missing_day') {
    if (await repo.findByUserAndDate(correction.userId, correction.workDate, trx)) {
      throw new AppError('ATTENDANCE_EXISTS');
    }
    const id = await repo.insertRow(
      {
        userId: correction.userId,
        workDate: correction.workDate,
        checkInAt: correction.requestedTime,
        checkOutAt: correction.requestedEndTime,
        location: correction.requestedLocation ?? 'office',
        officeVerified: true,
        lateMinutes: late(correction.requestedTime),
        isWorkingDay: workingDayFlag(correction.workDate, current),
        checkoutStatus: 'corrected',
        source: 'hr',
        createdAt: at,
        updatedAt: at,
      },
      trx,
    );
    return [null, await repo.findById(id, trx)];
  }
  const row =
    (correction.attendanceId &&
      (await repo.findById(correction.attendanceId, trx, { forUpdate: true }))) ||
    (await repo.findByUserAndDate(correction.userId, correction.workDate, trx));
  if (!row) throw new AppError('NOT_FOUND', { message: 'That attendance row no longer exists.' });
  const changes = { updatedAt: at };
  if (correction.type === 'check_in') {
    assertOrder(correction.requestedTime, row.checkOutAt, 'checkIn');
    changes.checkInAt = correction.requestedTime;
    changes.lateMinutes = late(correction.requestedTime);
  } else {
    assertOrder(row.checkInAt, correction.requestedTime);
    changes.checkOutAt = correction.requestedTime;
    changes.checkoutStatus = 'corrected';
  }
  await repo.updateRow(row.id, changes, trx);
  return [row, await repo.findById(row.id, trx)];
}

async function tellRequester({ correction, approved, note, detail }, trx) {
  const day = formatDayShort(correction.workDate);
  const verdict = approved ? 'approved' : 'rejected';
  await notifications.notify(
    {
      userIds: [correction.userId],
      type: `attendance_correction.${verdict}`,
      title: `Your attendance correction was ${verdict}`,
      body: approved
        ? [detail, note ? `Note from HR: ${note}` : null].filter(Boolean).join(' ')
        : note,
      link: `/log?month=${correction.workDate.slice(0, 7)}`,
    },
    trx,
  );
  const person = await users.findById(correction.userId);
  const reasonLine = note ? `\n${approved ? 'Note' : 'Reason'}: ${escapeSlackText(note)}` : '';
  await slack.queueDm(
    {
      slackUserId: person?.slackUserId,
      text: `Your attendance correction for ${day} was ${verdict}.${reasonLine}`,
      settingKey: 'slackRequestsNotify',
      relatedType: 'attendance_correction',
      relatedId: correction.id,
    },
    trx,
  );
}

/**
 * HR approves a correction: updates the row (or creates it for a missing day), sets
 * checkout_status = corrected for check-outs and missing days, recomputes late minutes for a new
 * check-in, writes an 'attendance.correct' audit row with the person's reason, and tells them.
 * @param {{ actor: { id: number }, id: number, note?: string | null, ip?: string | null }} input
 * @returns {Promise<{ correction: object, row: AttendanceRow }>}
 * @throws NOT_FOUND, FORBIDDEN (their own request), REQUEST_ALREADY_HANDLED, ATTENDANCE_EXISTS,
 *   VALIDATION_FAILED (times clash)
 */
export async function approveCorrection({ actor, id, note = null, ip }) {
  const current = await settings.getAll();
  const rowId = await db.transaction(async (trx) => {
    const correction = await loadPending(id, actor, trx);
    const [before, after] = await applyCorrection(correction, current, trx);
    const handled = await repo.handleCorrection(
      correction.id,
      {
        status: 'approved',
        attendanceId: after.id,
        handledBy: actor.id,
        handledAt: nowDate(),
        handlerNote: note || null,
        updatedAt: nowDate(),
      },
      trx,
    );
    if (handled === 0) throw new AppError('REQUEST_ALREADY_HANDLED');
    await audit.log(
      {
        actorId: actor.id,
        action: 'attendance.correct',
        entityType: 'attendance',
        entityId: after.id,
        before: auditView(before),
        after: { ...auditView(after), correctionId: correction.id, handlerNote: note || null },
        reason: correction.reason,
        ip,
      },
      trx,
    );
    const detail = approvedDetail(correction, current.timezone);
    await tellRequester({ correction, approved: true, note, detail }, trx);
    return after.id;
  });
  return { correction: await repo.findCorrection(id), row: await repo.findById(rowId) };
}

/**
 * HR rejects a correction with a note (required); the person is told why. Audited.
 * @param {{ actor: { id: number }, id: number, note: string, ip?: string | null }} input
 * @returns {Promise<object>} the correction
 * @throws VALIDATION_FAILED (no note), NOT_FOUND, FORBIDDEN (their own request),
 *   REQUEST_ALREADY_HANDLED
 */
export async function rejectCorrection({ actor, id, note, ip }) {
  const text = String(note ?? '').trim();
  if (!text) throw fieldError('note', 'Add a note for them.');
  await db.transaction(async (trx) => {
    const correction = await loadPending(id, actor, trx);
    const at = nowDate();
    const handled = await repo.handleCorrection(
      correction.id,
      { status: 'rejected', handledBy: actor.id, handledAt: at, handlerNote: text, updatedAt: at },
      trx,
    );
    if (handled === 0) throw new AppError('REQUEST_ALREADY_HANDLED');
    await audit.log(
      {
        actorId: actor.id,
        action: 'attendance_correction.reject',
        entityType: 'attendance_correction',
        entityId: correction.id,
        before: { status: 'pending' },
        after: { status: 'rejected' },
        reason: text,
        ip,
      },
      trx,
    );
    await tellRequester({ correction, approved: false, note: text }, trx);
  });
  return repo.findCorrection(id);
}
