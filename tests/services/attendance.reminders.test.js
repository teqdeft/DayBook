// One Remind mechanism (CONTRACT 25, item 5): each kind sent (bell, Slack DM, audit for HR) and
// refused once it no longer applies, the 30-minute rule under five parallel reminds, the checks
// in order (self, an Admin for HR, deactivated, untracked), the route, the reminder list and
// cleanup, and the day table's reminder data.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { resetRateLimitsForTests } from '@/lib/route';
import { localToUtc, setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const jar = new Map();
const store = {
  get: (name) => (jar.has(name) ? { name, value: jar.get(name).value } : undefined),
  set: (name, value, options) => jar.set(name, { value, options }),
  delete: ({ name }) => jar.delete(name),
};
let sessionUser = null;
vi.mock('next/headers', () => ({ cookies: async () => store, headers: async () => new Headers() }));
vi.mock('@/modules/auth', () => ({ auth: { resolveSession: async () => sessionUser } }));

const { encodeSessionCookie } = await import('@/lib/session');
const { env } = await import('@/lib/env');
const { POST } = await import('@/app/api/attendance/reminders/route.js');
const { loadRemindData } = await import('@/app/(app)/attendance/remindData.js');
const { settings } = await import('@/modules/settings');

const TZ = 'Asia/Kolkata';
const TODAY = '2026-11-19'; // Thursday
const FRI = '2026-11-13';
const MON = '2026-11-16';
const at = (clock, date = TODAY) => localToUtc(date, clock, TZ).toDate();
const setClock = (clock, date = TODAY) => setNowForTests(at(clock, date).toISOString());

let hr;
let pm;

async function checkIn(user, clock, extra = {}) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: TODAY,
    checkInAt: at(clock),
    location: 'office',
    officeVerified: true,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: 'open',
    ...extra,
  });
  return id;
}

const missingRow = (user, date) =>
  checkIn(user, '09:32', {
    workDate: date,
    checkInAt: at('09:32', date),
    checkoutStatus: 'missing',
  });

const send = (actor, kind, people) =>
  attendance.remind({ actor, kind, userIds: people.map((p) => p.id), ip: '198.51.100.7' });
const skip = (person, message, reason = 'not_needed') => ({
  sent: [],
  skipped: [{ userId: person.id, name: person.name, reason, message }],
});
const count = async (table, where = {}) =>
  Number((await db(table).where(where).count({ n: '*' }).first()).n);

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr', slackUserId: 'UHR' });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
});

beforeEach(async () => {
  resetRateLimitsForTests();
  for (const table of ['attendanceReminders', 'notifications', 'auditLogs', 'slackOutbox']) {
    await db(table).del();
  }
  for (const table of ['attendanceCorrections', 'attendanceBreaks', 'leaveEntries']) {
    await db(table).del();
  }
  await db('attendance').del();
  await setSettings({
    timezone: TZ,
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    break_allowance_minutes: 60,
    slack_enabled: true,
    slack_attendance_remind: true,
  });
  setClock('10:00');
});

afterEach(() => vi.restoreAllMocks());

describe('each kind', () => {
  it('check_in: the reminder row, the bell, the Slack DM and the audit; refused once checked in', async () => {
    const priya = await createUser({ name: 'Priya Sharma', slackUserId: 'UPRIYA1' });
    expect(await send(hr, 'check_in', [priya])).toEqual({
      sent: [{ userId: priya.id, name: 'Priya Sharma', sentAt: at('10:00') }],
      skipped: [],
    });
    const row = await db('attendanceReminders').first();
    expect(row).toMatchObject({ userId: priya.id, kind: 'check_in', workDate: TODAY });
    expect(row).toMatchObject({ sentBy: hr.id, autoKey: null });
    expect(await db('notifications').where({ userId: priya.id }).first()).toMatchObject({
      type: 'attendance.remind_check_in',
      title: 'Neha Kapoor reminded you to check in',
      link: '/today',
    });
    const dm = await db('slackOutbox').first();
    expect(dm).toMatchObject({ kind: 'dm', channel: 'UPRIYA1', relatedId: row.id });
    expect(dm.relatedType).toBe('attendance_reminder');
    expect(parseJson(dm.payload).text).toMatch(/^\*Neha Kapoor\* reminded you to check in\./);
    const log = await db('auditLogs').first();
    expect(log).toMatchObject({ actorId: hr.id, action: 'attendance.remind', entityId: row.id });
    expect(log).toMatchObject({ entityType: 'attendance_reminder', ip: '198.51.100.7' });
    expect(parseJson(log.after)).toEqual({ userId: priya.id, kind: 'check_in', workDate: TODAY });

    setClock('10:31');
    await checkIn(priya, '10:20');
    expect(await send(hr, 'check_in', [priya])).toEqual(
      skip(priya, 'Priya Sharma has checked in.'),
    );
  });

  it('check_in after the day end is skipped', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    setClock('18:45');
    expect(await send(hr, 'check_in', [priya])).toEqual(
      skip(priya, "Priya Sharma's day has ended."),
    );
  });

  it('break: over the allowance only; refused once the break ended', async () => {
    const karan = await createUser({ name: 'Karan Mehta' });
    const rowId = await checkIn(karan, '09:30');
    const [breakId] = await db('attendanceBreaks').insert({
      userId: karan.id,
      attendanceId: rowId,
      workDate: TODAY,
      startedAt: at('12:00'),
    });
    setClock('13:30');
    expect((await send(hr, 'break', [karan])).sent).toHaveLength(1);
    expect((await db('notifications').first()).body).toBe(
      "You've been on a break since 12:00 PM. Your breaks today are 1h 30m, over the 1h allowance.",
    );
    await db('attendanceBreaks')
      .where({ id: breakId })
      .update({ endedAt: at('13:31') });
    setClock('14:05');
    expect(await send(hr, 'break', [karan])).toEqual(
      skip(karan, "Karan Mehta isn't over the break allowance now."),
    );
  });

  it("check_out: after the day end only; refused once they've checked out", async () => {
    const rohit = await createUser({ name: 'Rohit Verma' });
    const rowId = await checkIn(rohit, '09:30');
    setClock('18:00');
    expect(await send(hr, 'check_out', [rohit])).toEqual(
      skip(rohit, "Rohit Verma's day hasn't ended yet."),
    );
    setClock('18:40');
    expect((await send(hr, 'check_out', [rohit])).sent).toHaveLength(1);
    await db('attendance')
      .where({ id: rowId })
      .update({ checkOutAt: at('18:45'), checkoutStatus: 'checked_out' });
    setClock('19:15');
    expect(await send(hr, 'check_out', [rohit])).toEqual(
      skip(rohit, 'Rohit Verma has checked out.'),
    );
  });

  it('missing_checkout: every unfixed day; not with a pending correction or on a leave day', async () => {
    const sam = await createUser({ name: 'Sam Lee' });
    const fri = await missingRow(sam, FRI);
    const mon = await missingRow(sam, MON);
    expect((await send(hr, 'missing_checkout', [sam])).sent).toHaveLength(1);
    expect(await db('notifications').first()).toMatchObject({
      type: 'attendance.remind_missing_checkout',
      body: "You didn't check out on Fri, 13 Nov and Mon, 16 Nov. Add the times you left on Today.",
      link: '/today?checkout=missing',
    });
    for (const [id, date] of [
      [fri, FRI],
      [mon, MON],
    ]) {
      await db('attendanceCorrections').insert({
        userId: sam.id,
        attendanceId: id,
        workDate: date,
        type: 'check_out',
        requestedTime: at('19:00', date),
        reason: 'Left at 7',
        status: 'pending',
      });
    }
    setClock('10:31');
    expect(await send(hr, 'missing_checkout', [sam])).toEqual(
      skip(sam, 'Sam Lee has no missing check-outs now.'),
    );

    const meera = await createUser({ name: 'Meera Nair' });
    await missingRow(meera, MON);
    await db('leaveEntries').insert({
      userId: meera.id,
      fromDate: TODAY,
      toDate: TODAY,
      part: 'full',
    });
    expect(await send(hr, 'missing_checkout', [meera])).toEqual(
      skip(meera, 'Meera Nair is on leave today.'),
    );
  });
});

describe('the 30-minute rule', () => {
  it('five parallel reminds of one person and kind send one', async () => {
    const priya = await createUser({ name: 'Priya Sharma', slackUserId: 'UPRIYA2' });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => send(hr, 'check_in', [priya])),
    );
    expect(results.flatMap((result) => result.sent)).toHaveLength(1);
    expect(results.flatMap((result) => result.skipped).map((item) => item.reason)).toEqual(
      Array(4).fill('too_soon'),
    );
    expect(await count('attendanceReminders')).toBe(1);
    expect(await count('notifications')).toBe(1);
    expect(await count('slackOutbox')).toBe(1);
  });

  it('says when they can be reminded again; another kind is not blocked; after 31 minutes it sends', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    await missingRow(priya, MON);
    await send(hr, 'check_in', [priya]);
    setClock('10:20');
    const later = await send(hr, 'check_in', [priya]);
    expect(later.skipped).toEqual([
      {
        userId: priya.id,
        name: 'Priya Sharma',
        reason: 'too_soon',
        message: 'Priya Sharma was reminded at 10:00. You can remind again at 10:30.',
        nextAt: at('10:30'),
      },
    ]);
    expect((await send(hr, 'missing_checkout', [priya])).sent).toHaveLength(1);
    setClock('10:31');
    expect((await send(hr, 'check_in', [priya])).sent).toHaveLength(1);
    expect(await count('attendanceReminders', { kind: 'check_in' })).toBe(2);
  });
});

describe('who can be reminded', () => {
  it('never yourself, an Admin for HR, someone deactivated or someone who does not check in', async () => {
    const admin = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
    const quiet = await createUser({ name: 'Asha Rao', role: 'admin', tracksAttendance: false });
    const gone = await createUser({ name: 'Old Hand', status: 'deactivated' });
    const rahul = await createUser({ name: 'Rahul Verma', tracksAttendance: false });
    const unknown = { id: 999999 };
    const result = await send(hr, 'check_in', [hr, admin, quiet, gone, rahul, unknown]);
    const hidden = (person) => ({
      userId: person.id,
      name: null,
      reason: 'not_allowed',
      message: "We couldn't find that person.",
    });
    expect(result).toEqual({
      sent: [],
      skipped: [
        {
          userId: hr.id,
          name: 'Neha Kapoor',
          reason: 'not_allowed',
          message: "You can't remind yourself.",
        },
        hidden(admin),
        hidden(quiet),
        hidden(gone),
        {
          userId: rahul.id,
          name: 'Rahul Verma',
          reason: 'not_needed',
          message: "Rahul Verma doesn't check in.",
        },
        hidden(unknown),
      ],
    });
    // An Admin may remind another Admin.
    const other = await createUser({ name: 'Mira Admin', role: 'admin' });
    expect((await send(other, 'check_in', [admin])).sent).toHaveLength(1);
    await expect(send(pm, 'check_in', [admin])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('Slack only with slack_attendance_remind on and a Slack ID; the bell every time', async () => {
    const noSlack = await createUser({ name: 'No Slack' });
    const priya = await createUser({ name: 'Priya Sharma', slackUserId: 'UPRIYA3' });
    await send(hr, 'check_in', [noSlack]);
    await setSettings({ slack_attendance_remind: false });
    await send(hr, 'check_in', [priya]);
    expect(await count('notifications')).toBe(2);
    expect(await count('slackOutbox')).toBe(0);
    expect(await count('auditLogs', { action: 'attendance.remind' })).toBe(2);
  });
});

describe('POST /api/attendance/reminders', () => {
  const EXPIRES = new Date('2026-12-26T04:00:00Z');
  function call(user, body) {
    sessionUser = user && { ...user, sessionExpiresAt: EXPIRES };
    jar.set(env.SESSION_COOKIE_NAME, { value: encodeSessionCookie('tok', EXPIRES) });
    const request = new Request('http://localhost:3000/api/attendance/reminders', {
      method: 'POST',
      headers: { Origin: env.appOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return POST(request, { params: Promise.resolve({}) });
  }

  it('reminds for HR, refuses PMs, checks the body and limits 30 a minute', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const ok = await call(hr, { kind: 'check_in', userIds: [priya.id, priya.id] });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.sent).toEqual([
      { userId: priya.id, name: 'Priya Sharma', sentAt: at('10:00').toISOString() },
    ]);
    expect((await call(pm, { kind: 'check_in', userIds: [priya.id] })).status).toBe(403);
    const bad = await call(hr, { kind: 'wave', userIds: [priya.id] });
    expect((await bad.json()).error.message).toBe('Pick what to remind them about.');
    const many = Array.from({ length: 51 }, (_, index) => index + 1);
    const tooMany = await call(hr, { kind: 'check_in', userIds: many });
    expect((await tooMany.json()).error.message).toBe('Remind up to 50 people at a time.');
    for (let index = 0; index < 29; index += 1) {
      await call(hr, { kind: 'check_in', userIds: [priya.id] });
    }
    expect((await call(hr, { kind: 'check_in', userIds: [priya.id] })).status).toBe(429);
  });
});

describe('the list, cleanup and the day table', () => {
  it('listReminders is newest first with the sender; deleteOldReminders goes by work date', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    await missingRow(priya, MON);
    await send(hr, 'check_in', [priya]);
    setClock('10:05');
    await send(hr, 'missing_checkout', [priya]);
    const all = await attendance.listReminders({ since: at('00:00'), userIds: [priya.id] });
    expect(all.map((item) => item.kind)).toEqual(['missing_checkout', 'check_in']);
    expect(all[0]).toMatchObject({
      sentAt: at('10:05'),
      sentBy: { id: hr.id, name: 'Neha Kapoor' },
    });
    expect(
      await attendance.listReminders({ since: at('00:00'), kinds: ['check_in'] }),
    ).toHaveLength(1);
    expect(await attendance.listReminders({ since: at('10:01') })).toHaveLength(1);
    expect(await attendance.listReminders({ since: at('00:00'), userIds: [] })).toEqual([]);
    await db('attendanceReminders').update({ workDate: '2026-05-22' }).where({ kind: 'check_in' });
    expect(await attendance.deleteOldReminders('2026-05-23')).toBe(1);
    expect(await count('attendanceReminders')).toBe(1);
  });

  it('loadRemindData: the kind, the latest reminder and when HR can remind again', async () => {
    const priya = await createUser({ name: 'Priya Sharma' });
    const current = await settings.getAll();
    const load = async (date = TODAY) => {
      const items = await attendance.listDay(date, { viewer: hr });
      return loadRemindData({ items, date, today: TODAY, viewer: hr, settings: current });
    };
    expect((await load()).get(priya.id)).toEqual({
      kind: 'check_in',
      reminded: null,
      nextAt: null,
    });
    expect((await load()).has(hr.id)).toBe(false);
    await send(hr, 'check_in', [priya]);
    setClock('10:10');
    expect((await load()).get(priya.id)).toEqual({
      kind: 'check_in',
      reminded: { sentAt: at('10:00'), sentBy: { id: hr.id, name: 'Neha Kapoor' }, tz: TZ },
      nextAt: at('10:30'),
    });

    await missingRow(priya, MON);
    setClock('10:40');
    await send(hr, 'missing_checkout', [priya]);
    setClock('11:20');
    expect((await load(MON)).get(priya.id)).toMatchObject({
      kind: 'missing_checkout',
      reminded: { sentAt: at('10:40') },
      nextAt: null,
    });
    const items = await attendance.listDay(TODAY, { viewer: pm });
    const forPm = await loadRemindData({
      items,
      date: TODAY,
      today: TODAY,
      viewer: pm,
      settings: current,
    });
    expect(forPm.size).toBe(0);
  });
});
