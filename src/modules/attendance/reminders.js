// One Remind mechanism (CONTRACT 25, item 5). HR and Admins remind people from Attendance about
// one kind (check in, the break, check out, a missing check-out); Daybook sends its own check-in
// reminder (checkinReminders.js). Every remind goes through claimAndSend(): one attendance_reminders
// row, a bell notification (so a desktop push) and a Slack DM (slack_attendance_remind), and for
// HR an audit row, all in one transaction. At most one per person per kind in 30 minutes, the
// automatic one included. Reminders never lock attendance, breaks or timers: the state is read
// just before the claim, so one that crosses a check-in by a second is accepted.
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { formatTime, now, workDate as localDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { slack } from '@/modules/slack';
import { users } from '@/modules/users';
import { loadCalendar } from './calendarReads';
import { listDay } from './day';
import { guard018Read, guard018Write } from './migration018';
import { missingCheckoutsFor } from './missingHr';
import { parseBody, reminderSchema } from './missingSchemas';
import { reminderMessage } from './reminderMessages';
import * as reminderRepo from './reminderRepo';
import { REMIND_EVERY_MINUTES, nextRemindAt, remindSkipFor } from './remindRules';
import { transaction } from './repo';
import { nowToSecond, showsAttendanceOf, todayFor } from './rules';

const DUPLICATE = 1062;
const NOT_FOUND = "We couldn't find that person.";

/** The bell row (so the desktop push), the Slack DM and, for HR, the audit row of one remind. */
async function deliver({ id, person, kind, actor, ip, workDate, message }, trx) {
  const { type, title, body, link, slack: text } = message;
  await notifications.notify({ userIds: [person.id], type, title, body, link }, trx);
  await slack.queueDm(
    {
      slackUserId: person.slackUserId,
      text,
      settingKey: 'slackAttendanceRemind',
      relatedType: 'attendance_reminder',
      relatedId: id,
    },
    trx,
  );
  if (!actor) return;
  await audit.log(
    {
      actorId: actor.id,
      action: 'attendance.remind',
      entityType: 'attendance_reminder',
      entityId: id,
      after: { userId: person.id, kind, workDate },
      ip,
    },
    trx,
  );
}

/**
 * Sends one remind unless the person had one of this kind since `since` (the only way a
 * reminder is sent). REPEATABLE READ: the locked range read and its gap make two sends at once
 * wait or deadlock, and the retry sees the first (repo.transaction retries 3 deadlocks).
 * @param {{ person: { id: number, slackUserId?: string | null }, kind: string,
 *   actor?: { id: number, name: string } | null, since: Date, autoKey?: string | null,
 *   ip?: string | null }} input actor = HR or an Admin (none = Daybook); since = now − 30 min
 *   for HR, the start of today for the automatic check-in reminder; autoKey for automatic ones
 * @param {object} [details] what the message needs (reminderMessage())
 * @returns {Promise<{ status: 'sent', id: number, sentAt: Date } | { status: 'too_soon',
 *   sentAt: Date } | { status: 'busy', message: string }>} busy: an automatic reminder already
 *   sent (auto_key) or three deadlocks
 * @throws UPDATE_NEEDED (503) before migration 018
 */
export async function claimAndSend(
  { person, kind, actor = null, since, autoKey = null, ip = null },
  details,
) {
  const { timezone } = await settings.getAll();
  const message = reminderMessage({
    kind,
    sender: actor?.name ?? null,
    details: { ...details, tz: timezone },
    origin: env.appOrigin,
  });
  const send = async (trx) => {
    const where = { userId: person.id, kind, since };
    const [recent] = await reminderRepo.findRecentForUpdate(where, trx);
    if (recent) return { status: 'too_soon', sentAt: recent.sentAt };
    const at = nowToSecond();
    const workDate = localDate(timezone, at);
    const id = await reminderRepo.insertReminder(
      { userId: person.id, kind, workDate, sentBy: actor?.id ?? null, sentAt: at, autoKey },
      trx,
    );
    await deliver({ id, person, kind, actor, ip, workDate, message }, trx);
    return { status: 'sent', id, sentAt: at };
  };
  try {
    return await guard018Write('reminders', () =>
      transaction(send, { isolationLevel: 'repeatable read' }),
    );
  } catch (error) {
    if (error?.errno === DUPLICATE) return { status: 'busy', message: 'Already sent today.' };
    if (error instanceof AppError && error.code === 'CONFLICT') {
      return { status: 'busy', message: error.message };
    }
    throw error;
  }
}

/** What each kind's message needs from today's listDay() item. */
function detailsFor(kind, item, ctx) {
  if (kind === 'break') {
    return {
      onBreakSince: item.onBreakSince,
      breakMinutes: item.breakMinutes,
      allowanceMinutes: ctx.settings.breakAllowanceMinutes,
    };
  }
  if (kind === 'missing_checkout') {
    return { dates: (ctx.missing?.get(Number(item.user.id)) ?? []).map((row) => row.workDate) };
  }
  return kind === 'check_in' ? { expectedStart: item.day?.expectedStart } : {};
}

/** The person, today's listDay() item and (for missing_checkout) their unfixed rows. */
async function loadState({ kind, userIds }, today) {
  const people = await users.findByIds(userIds);
  const calendar = await loadCalendar({ from: today, to: today, userIds });
  const [items, missing] = await Promise.all([
    listDay(today, { calendar }),
    kind === 'missing_checkout' ? missingCheckoutsFor(userIds) : null,
  ]);
  return {
    people: new Map(people.map((person) => [Number(person.id), person])),
    items: new Map(items.map((item) => [Number(item.user.id), item])),
    missing,
  };
}

/**
 * The checks before the claim, in this order (so HR learns nothing about an Admin from which
 * message comes back): exists and active, may be seen, not the actor, tracks attendance, and
 * the kind applies now. Returns the skip, or null.
 */
function checkPerson({ id, person, item, actor, kind, ctx }) {
  if (!person || person.status !== 'active' || !showsAttendanceOf(actor, person)) {
    return { userId: id, name: null, reason: 'not_allowed', message: NOT_FOUND };
  }
  const base = { userId: id, name: person.name };
  if (person.id === actor.id) {
    return { ...base, reason: 'not_allowed', message: "You can't remind yourself." };
  }
  if (!person.tracksAttendance) {
    return { ...base, reason: 'not_needed', message: `${person.name} doesn't check in.` };
  }
  const why = item ? remindSkipFor(kind, item, ctx) : "Today isn't a working day.";
  return why ? { ...base, reason: 'not_needed', message: why } : null;
}

function tooSoon(person, sentAt, tz) {
  const nextAt = nextRemindAt(sentAt);
  return {
    userId: person.id,
    name: person.name,
    reason: 'too_soon',
    message:
      `${person.name} was reminded at ${formatTime(sentAt, tz)}. ` +
      `You can remind again at ${formatTime(nextAt, tz)}.`,
    nextAt,
  };
}

/** One person: the checks, then the claim. Returns { sent } or { skipped }. */
async function remindPerson({ id, kind, actor, ip, since, state, recentAt, ctx }) {
  const person = state.people.get(id);
  const item = state.items.get(id);
  const tz = ctx.settings.timezone;
  const skip = checkPerson({ id, person, item, actor, kind, ctx });
  if (skip) return { skipped: skip };
  if (recentAt.has(id)) return { skipped: tooSoon(person, recentAt.get(id), tz) };
  const details = detailsFor(kind, item, ctx);
  const outcome = await claimAndSend({ person, kind, actor, since, ip }, details);
  if (outcome.status === 'sent') {
    return { sent: { userId: id, name: person.name, sentAt: outcome.sentAt } };
  }
  if (outcome.status === 'too_soon') return { skipped: tooSoon(person, outcome.sentAt, tz) };
  return {
    skipped: { userId: id, name: person.name, reason: 'too_soon', message: outcome.message },
  };
}

/**
 * HR or an Admin reminds people about one kind (POST /api/attendance/reminders). Each person is
 * checked and sent on their own; one skip never stops the others.
 * @param {{ actor: { id: number, name: string, role: string, status?: string },
 *   kind: 'check_in' | 'break' | 'check_out' | 'missing_checkout', userIds: number[],
 *   ip?: string | null }} input 1 to 50 distinct ids
 * @returns {Promise<{ sent: Array<{ userId: number, name: string, sentAt: Date }>,
 *   skipped: Array<{ userId: number, name: string | null, reason: 'too_soon' | 'not_needed' |
 *   'not_allowed', message: string, nextAt?: Date }> }>} name is null for someone the actor
 *   can't see
 * @throws FORBIDDEN (no attendance.correct), VALIDATION_FAILED (kind, userIds), UPDATE_NEEDED
 *   (503) before migration 018
 */
export async function remind({ actor, kind, userIds, ip = null }) {
  if (!can(actor, 'attendance.correct')) throw new AppError('FORBIDDEN');
  const input = parseBody(reminderSchema, { kind, userIds });
  const current = await settings.getAll();
  const today = todayFor(current);
  const at = now();
  const since = at.subtract(REMIND_EVERY_MINUTES, 'minute').toDate();
  const sinceDate = localDate(current.timezone, since);
  const where = { since, sinceDate, userIds: input.userIds, kinds: [input.kind] };
  // Before migration 018 this first read answers UPDATE_NEEDED, before any check.
  const recent = await guard018Write('reminders', () => reminderRepo.listSince(where));
  const recentAt = new Map(recent.map((row) => [Number(row.userId), row.sentAt]).reverse());
  const state = await loadState(input, today);
  const ctx = { now: at.toDate(), today, date: today, settings: current, missing: state.missing };
  const result = { sent: [], skipped: [] };
  for (const id of input.userIds) {
    const one = { id, kind: input.kind, actor, ip, since, state, recentAt, ctx };
    const { sent, skipped } = await remindPerson(one);
    if (sent) result.sent.push(sent);
    else result.skipped.push(skipped);
  }
  return result;
}

/**
 * Reminders sent at or after `since`, newest first ([] before migration 018). Filters the
 * company date of `since` first (KEY work_date), so the day page never scans 180 days.
 * @param {{ since: Date | string, userIds?: number[], kinds?: string[] }} input
 * @returns {Promise<Array<{ userId: number, kind: string, workDate: string, sentAt: Date,
 *   sentBy: { id: number, name: string } | null }>>} sentBy null = Daybook
 */
export async function listReminders({ since, userIds, kinds } = {}) {
  const ids = userIds ? [...new Set(userIds.map(Number).filter((id) => id > 0))] : undefined;
  if (ids?.length === 0 || kinds?.length === 0) return [];
  const { timezone } = await settings.getAll();
  const from = new Date(since);
  const where = { since: from, sinceDate: localDate(timezone, from), userIds: ids, kinds };
  const rows = await guard018Read(
    'reminders',
    () => reminderRepo.listSince(where),
    () => [],
  );
  return rows.map((row) => ({
    userId: Number(row.userId),
    kind: row.kind,
    workDate: row.workDate,
    sentAt: row.sentAt,
    sentBy: row.sentBy ? { id: Number(row.sentBy), name: row.senderName ?? '' } : null,
  }));
}

/**
 * Deletes reminders of company dates before `before` (the daily cleanup, 180 days back). 0
 * before migration 018.
 * @param {string | Date} before 'YYYY-MM-DD', or a moment (its company date)
 * @returns {Promise<number>}
 */
export async function deleteOldReminders(before) {
  const { timezone } = await settings.getAll();
  const date = typeof before === 'string' ? before : localDate(timezone, before);
  return Number(
    await guard018Read(
      'reminders',
      () => reminderRepo.deleteBefore(date),
      () => 0,
    ),
  );
}
