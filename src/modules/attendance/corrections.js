// Attendance correction requests (guide 7.8): a person asks HR to fix a check-in time, a
// forgotten check-out or a whole missing day, and HR sees the list. Decisions are in decisions.js.
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, validationError } from '@/lib/errors';
import { nowDate } from '@/lib/time';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { escapeSlackText } from '@/modules/slack/format';
import { slack } from '@/modules/slack';
import { users } from '@/modules/users';
import { assertOrder, requireReason, resolveTimes } from './hr';
import { hrRecipients } from './recipients';
import * as repo from './repo';
import { describeCorrection } from './wording';
import { todayFor } from './rules';

function fieldError(field, message) {
  return validationError({ [field]: message }, message);
}

/** The fields each kind of request needs (the API schema checks the same). */
function checkRequestFields({ type, checkIn, checkOut, location }) {
  if (!['check_in', 'check_out', 'missing_day'].includes(type)) {
    throw fieldError('type', 'Pick what needs fixing.');
  }
  if (type !== 'check_out' && !checkIn) throw fieldError('checkIn', 'Enter the check-in time.');
  if (type !== 'check_in' && !checkOut) throw fieldError('checkOut', 'Enter the check-out time.');
  if (type === 'missing_day' && !['office', 'wfh'].includes(location)) {
    throw fieldError('location', 'Pick Office or WFH.');
  }
}

/** Checks a request against the day's row; returns the attendance id it corrects (or null). */
function checkAgainstRow({ type, row, times }) {
  if (type === 'missing_day') {
    if (row) {
      throw fieldError(
        'type',
        'You have a check-in on that day. Ask to fix the check-in or check-out time instead.',
      );
    }
    assertOrder(times.checkInAt, times.checkOutAt);
    return null;
  }
  if (!row) {
    throw fieldError(
      'workDate',
      'You have no check-in on that day. Ask for a missing day instead.',
    );
  }
  if (type === 'check_in') assertOrder(times.checkInAt, row.checkOutAt, 'checkIn');
  if (type === 'check_out') assertOrder(row.checkInAt, times.checkOutAt);
  return row.id;
}

async function tellHr({ user, correction, summary }, trx) {
  const hr = await hrRecipients(user.id);
  await notifications.notify(
    {
      userIds: hr.map((person) => person.id),
      type: 'attendance_correction.requested',
      title: `${user.name} asked for a correction`,
      body: correction.reason,
      link: '/attendance',
    },
    trx,
  );
  const text =
    `*${escapeSlackText(user.name)}* asked for an attendance correction: ` +
    `${summary.replace(/^Says /, 'says ')}\n` +
    `Reason: ${escapeSlackText(correction.reason)}\n` +
    `<${env.appOrigin}/attendance|Open Attendance>`;
  for (const person of hr) {
    await slack.queueDm(
      {
        slackUserId: person.slackUserId,
        text,
        settingKey: 'slackRequestsNotify',
        relatedType: 'attendance_correction',
        relatedId: correction.id,
      },
      trx,
    );
  }
}

/**
 * A person asks HR to fix their attendance (POST /api/attendance-corrections).
 * check_in and check_out need that day's row; missing_day needs no row and stores the check-in
 * time, the check-out time (requested_end_time) and the place. Times are clocks in company time
 * and can't be in the future. Notifies HR in the app and by Slack DM (slack_requests_notify).
 * @param {{ user: { id: number, name: string }, type: 'check_in' | 'check_out' | 'missing_day',
 *   workDate: string, checkIn?: string, checkOut?: string, location?: 'office' | 'wfh',
 *   reason: string }} input
 * @returns {Promise<object>} the new correction
 * @throws VALIDATION_FAILED, REQUEST_ALREADY_PENDING
 */
export async function requestCorrection({
  user,
  type,
  workDate,
  checkIn,
  checkOut,
  location,
  reason,
}) {
  const why = requireReason(reason);
  checkRequestFields({ type, checkIn, checkOut, location });
  const current = await settings.getAll();
  if (workDate > todayFor(current)) throw fieldError('workDate', "That day hasn't come yet.");
  const times = resolveTimes({
    workDate,
    checkIn: type === 'check_out' ? null : checkIn,
    checkOut: type === 'check_in' ? null : checkOut,
    current,
  });
  const row = await repo.findByUserAndDate(user.id, workDate);
  const attendanceId = checkAgainstRow({ type, row, times });
  if (await repo.findPendingCorrection({ userId: user.id, workDate, type })) {
    throw new AppError('REQUEST_ALREADY_PENDING');
  }
  const at = nowDate();
  const record = {
    userId: user.id,
    attendanceId,
    workDate,
    type,
    requestedTime: type === 'check_out' ? times.checkOutAt : times.checkInAt,
    requestedEndTime: type === 'missing_day' ? times.checkOutAt : null,
    requestedLocation: type === 'missing_day' ? location : null,
    reason: why,
    status: 'pending',
    createdAt: at,
    updatedAt: at,
  };
  const id = await db.transaction(async (trx) => {
    const newId = await repo.insertCorrection(record, trx);
    const correction = { ...record, id: newId };
    const summary = describeCorrection(correction, row, current.timezone);
    await tellHr({ user, correction, summary }, trx);
    return newId;
  });
  return repo.findCorrection(id);
}

/**
 * Corrections by status with the person, the day's row and the card sentence, for HR.
 * @param {{ status?: 'pending' | 'approved' | 'rejected', userId?: number, limit?: number,
 *   offset?: number }} [options]
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function listCorrections({ status = 'pending', userId, limit = 50, offset = 0 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const [rows, total, current] = await Promise.all([
    repo.listCorrections({ status, userId, limit: size, offset: Math.max(Number(offset) || 0, 0) }),
    repo.countCorrections({ status, userId }),
    settings.getAll(),
  ]);
  const attendanceIds = [...new Set(rows.map((row) => row.attendanceId).filter(Boolean))];
  const [people, attendanceRows] = await Promise.all([
    users.findByIds([...new Set(rows.map((row) => row.userId))]),
    repo.findByIds(attendanceIds),
  ]);
  const byId = new Map(people.map((person) => [person.id, person]));
  const rowById = new Map(attendanceRows.map((row) => [row.id, row]));
  const items = rows.map((correction) => {
    const row = rowById.get(correction.attendanceId) ?? null;
    const person = byId.get(correction.userId);
    return {
      ...correction,
      user: person ? pickUser(person) : { id: correction.userId, name: 'Former teammate' },
      attendance: row,
      summary: describeCorrection(correction, row, current.timezone),
    };
  });
  return { items, total };
}

function pickUser(person) {
  const { id, name, initials, avatarUrl, role, status, designation } = person;
  return { id, name, initials, avatarUrl, role, status, designation };
}
