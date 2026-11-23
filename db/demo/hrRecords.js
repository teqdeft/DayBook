// The bell and audit rows behind the 1.10 demo (CONTRACT 25; hrTools.js picks the people): the
// midnight job's missing check-out marks, Vishal Saini's own check-out entered long after Daybook
// last saw him working, Neha Gupta's change of place on one of his days, and her reminder to
// Arjun Nair. Each row has the shape the app's own write leaves (attendance/hr.js auditView,
// missingSelf.js, reminders.js), so the person month's Changes and the lists read them as theirs.
import { toJson } from '@/lib/db';
import { addDays, formatDayShort } from '@/lib/time';
import { at } from './calendar.js';
import { OFFICE_IP } from './rows.js';

/** Vishal entered the check-out of offset 3 at 9:34 on offset 2: his shift end, 6:30 PM. */
export const SELF_ENTERED = { key: 'vishal', offset: 3, enteredOffset: 2, clock: '09:34' };
const LAST_SEEN = '13:05';
const HR_EDIT = {
  key: 'vishal',
  offset: 8,
  by: 'neha',
  at: [7, '10:12'],
  reason: 'Picked working from home by mistake. He was in the office all day.',
};
/** Neha reminded Arjun about his missing check-out at 10:05 today. */
export const REMINDED = { key: 'arjun', by: 'neha', clock: '10:05' };

/** What the audit log keeps of an attendance row (attendance/hr.js auditView). */
const view = (row) => ({
  workDate: row.workDate,
  checkInAt: row.checkInAt,
  checkOutAt: row.checkOutAt,
  location: row.location,
  officeVerified: row.officeVerified,
  lateMinutes: row.lateMinutes,
  checkoutStatus: row.checkoutStatus,
});

/** An audit_logs row; Daybook's own (no actor) has no IP. */
export function auditRow({ actor, action, entityType, entityId, before, after, reason, at: when }) {
  return {
    actorId: actor ?? null,
    action,
    entityType,
    entityId,
    before: before ? toJson(before) : null,
    after: after ? toJson(after) : null,
    reason: reason ?? null,
    ip: actor ? OFFICE_IP : null,
    createdAt: when,
    updatedAt: when,
  };
}

/** A bell notification, pushed when it was made (history, not news). */
export function bell({ userId, type, title, body, link, at: when, read }) {
  return {
    userId,
    type,
    title,
    body,
    link,
    readAt: read ? when : null,
    pushedAt: when,
    createdAt: when,
    updatedAt: when,
  };
}

/** The midnight job's mark on a row (00:05 the next day), with its bell to the person. */
export function markedMissing(row, ctx, out) {
  const when = at(addDays(row.workDate, 1), '00:05', ctx.tz);
  out.audit.push(
    auditRow({
      action: 'attendance.mark_missing',
      entityType: 'attendance',
      entityId: row.id,
      before: { checkoutStatus: 'open' },
      after: { checkoutStatus: 'missing' },
      at: when,
    }),
  );
  out.notifications.push(
    bell({
      userId: row.userId,
      type: 'attendance.missing_checkout',
      title: `You didn't check out on ${formatDayShort(row.workDate)}`,
      body: 'Add the time you left on Today.',
      link: '/today?checkout=missing',
      at: when,
      read: true,
    }),
  );
}

/**
 * Vishal's own check-out from Today's pop-up: within his limit (the shift end), more than 15
 * minutes after the suggestion he saw, so HR gets the "Check" tag. Sets the entered-by columns on
 * his attendance row, which isn't inserted yet.
 */
export function selfEnteredRows(ctx, out) {
  const row = ctx.index.attendance.get(`${SELF_ENTERED.key}|${SELF_ENTERED.offset}`);
  const enteredAt = ctx.when(SELF_ENTERED.enteredOffset, SELF_ENTERED.clock);
  markedMissing(row, ctx, out);
  Object.assign(row, {
    checkoutEnteredBy: row.userId,
    checkoutEnteredAt: enteredAt,
    checkoutSuggestedAt: at(row.workDate, LAST_SEEN, ctx.tz),
    updatedAt: enteredAt,
  });
  out.audit.push(
    auditRow({
      actor: row.userId,
      action: 'attendance.self_checkout',
      entityType: 'attendance',
      entityId: row.id,
      before: { ...view(row), checkOutAt: null, checkoutStatus: 'missing' },
      after: { ...view(row), suggestedClock: LAST_SEEN, limitClock: '18:30', pastLastSeen: true },
      reason: 'Entered from Today',
      at: enteredAt,
    }),
  );
}

/** Neha's Edit of one of Vishal's days: Place WFH to Office, with her reason; he is told. */
export function hrEditRows(ctx, out) {
  const row = ctx.index.attendance.get(`${HR_EDIT.key}|${HR_EDIT.offset}`);
  const editedAt = ctx.when(...HR_EDIT.at);
  const actor = ctx.users.get(HR_EDIT.by);
  out.audit.push(
    auditRow({
      actor: actor.id,
      action: 'attendance.edit',
      entityType: 'attendance',
      entityId: row.id,
      before: { ...view(row), location: 'wfh' },
      after: view(row),
      reason: HR_EDIT.reason,
      at: editedAt,
    }),
  );
  out.notifications.push(
    bell({
      userId: row.userId,
      type: 'attendance.edited',
      title: `${actor.name} changed your attendance for ${formatDayShort(row.workDate)}`,
      body: null,
      link: `/log?month=${row.workDate.slice(0, 7)}`,
      at: editedAt,
      read: true,
    }),
  );
}

/**
 * Neha's reminder to Arjun about his missing check-out at 10:05 today ("Reminded 10:05 by Neha"):
 * the reminder row, his bell and her audit line.
 * @param {number} offset the working-day offset of his missing check-out
 */
export function reminderRows(ctx, out, offset) {
  const person = ctx.users.get(REMINDED.key);
  const sender = ctx.users.get(REMINDED.by);
  const row = ctx.index.attendance.get(`${REMINDED.key}|${offset}`);
  const sentAt = ctx.when(0, REMINDED.clock);
  const workDate = ctx.today;
  out.reminders.push({
    id: 1,
    userId: person.id,
    kind: 'missing_checkout',
    workDate,
    sentBy: sender.id,
    sentAt,
    autoKey: null,
    createdAt: sentAt,
    updatedAt: sentAt,
  });
  const day = formatDayShort(row.workDate);
  out.notifications.push(
    bell({
      userId: person.id,
      type: 'attendance.remind_missing_checkout',
      title: `${sender.name} asked for your check-out time`,
      body: `You didn't check out on ${day}. Add the time you left on Today.`,
      link: '/today?checkout=missing',
      at: sentAt,
    }),
  );
  out.audit.push(
    auditRow({
      actor: sender.id,
      action: 'attendance.remind',
      entityType: 'attendance_reminder',
      entityId: 1,
      after: { userId: person.id, kind: 'missing_checkout', workDate },
      at: sentAt,
    }),
  );
}
