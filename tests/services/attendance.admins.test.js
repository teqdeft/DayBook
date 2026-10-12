// Company rule: an Admin's attendance is shown to Admins only. HR and PMs never see an Admin in the
// day view, its numbers, the missing check-outs, the Excel file or the correction requests; they
// can't change an Admin's rows or decide on an Admin's request (addressed by id, those look
// missing); notifications about an Admin's attendance go to the other active Admins (nobody when
// there is none), never to HR.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { pickRecipients } from '@/modules/attendance/recipients';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const DAY = '2026-09-30'; // a Wednesday
const YESTERDAY = '2026-09-29';
// Clock times in India (UTC+5:30).
const at = (clock, date = DAY) => {
  const [h, m] = clock.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m - 330);
  return d;
};

let hr;
let pm;
let ceo;
let cto;
let vishal;

async function code(promise) {
  try {
    await promise;
  } catch (error) {
    return error.code;
  }
  return 'OK';
}

async function addRow(user, date, { checkIn = '09:30', checkOut, ...extra } = {}) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(checkIn, date),
    checkOutAt: checkOut ? at(checkOut, date) : null,
    checkoutStatus: checkOut ? 'checked_out' : 'open',
    location: 'office',
    ...extra,
  });
  return id;
}

const idsOf = (items) => items.map((item) => item.user.id);
const toldAbout = async (title) =>
  (await db('notifications').where({ title })).map((note) => note.userId).sort();

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Gupta', role: 'hr', slackUserId: 'UHR' });
  pm = await createUser({ name: 'Pam Mehta', role: 'pm', tracksAttendance: false });
  ceo = await createUser({ name: 'Ravi Kapoor', role: 'admin', slackUserId: 'UCEO' });
  cto = await createUser({ name: 'Meera Pillai', role: 'admin', slackUserId: 'UCTO' });
  vishal = await createUser({ name: 'Vishal Saini', slackUserId: 'UVISHAL' });
  await setSettings({
    slack_enabled: true,
    slack_requests_notify: true,
    allow_unverified_office: true,
    auto_mark_missing_checkout: true,
    working_days: [1, 2, 3, 4, 5],
  });
  // Today: Vishal 97 minutes late, Ravi (Admin) at the office unverified, Meera not in yet.
  // Yesterday both Vishal and Ravi forgot to check out.
  await addRow(vishal, DAY, { checkIn: '11:07', lateMinutes: 97 });
  await addRow(ceo, DAY, { checkIn: '10:00', lateMinutes: 30, officeVerified: false });
  await addRow(vishal, YESTERDAY, { checkoutStatus: 'missing' });
  await addRow(ceo, YESTERDAY, { checkoutStatus: 'missing' });
});

beforeEach(() => setNowForTests(at('12:00')));

afterAll(() => setNowForTests(null));

describe('who hears about attendance', () => {
  it('about an Admin: the other Admins only; about anyone else: HR, else the Admins', () => {
    const pools = { hr: [hr], admins: [ceo, cto] };
    expect(pickRecipients(pools, ceo).map((p) => p.id)).toEqual([cto.id]);
    expect(pickRecipients({ hr: [hr], admins: [ceo] }, ceo)).toEqual([]);
    expect(pickRecipients(pools, vishal).map((p) => p.id)).toEqual([hr.id]);
    expect(pickRecipients(pools, hr).map((p) => p.id)).toEqual([ceo.id, cto.id]);
  });
});

describe('the day view leaves Admins out for HR and PMs', () => {
  it('lists, counts, filters and exports Admins only for an Admin viewer', async () => {
    for (const viewer of [hr, pm]) {
      const items = await attendance.listDay(DAY, { viewer });
      expect(idsOf(items)).toEqual([hr.id, vishal.id]);
      expect(await attendance.getDaySummary(DAY, { items, viewer })).toMatchObject({
        tracked: 2,
        present: 1,
        inOffice: 1,
        late: 1,
        lateAverageMinutes: 97,
        unverified: 0,
        notCheckedIn: 1,
        missingCheckouts: 1,
        missingDays: 1,
      });
      const waiting = await attendance.listForDay({ date: DAY, filter: 'not_checked_in', viewer });
      expect(idsOf(waiting.items)).toEqual([hr.id]);
      const missing = await attendance.listMissingCheckouts({ viewer });
      expect(missing.items.map((row) => row.userId)).toEqual([vishal.id]);
      expect(missing.total).toBe(1);
      const sheet = (await attendance.exportDay(DAY, { viewer })).sheets[0];
      expect(sheet.rows.map((row) => row.name)).toEqual(['Neha Gupta', 'Vishal Saini']);
    }

    // Admins see everyone, other Admins included; so does a system read (no viewer).
    for (const viewer of [ceo, undefined]) {
      const items = await attendance.listDay(DAY, { viewer });
      expect(idsOf(items)).toEqual([hr.id, ceo.id, cto.id, vishal.id]);
      expect(await attendance.getDaySummary(DAY, { viewer })).toMatchObject({
        tracked: 4,
        present: 2,
        late: 2,
        unverified: 1,
        notCheckedIn: 2,
        missingCheckouts: 2,
      });
      expect((await attendance.listMissingCheckouts({ viewer })).total).toBe(2);
      expect((await attendance.exportDay(DAY, { viewer })).sheets[0].rows).toHaveLength(4);
    }
    const unverified = await attendance.listForDay({
      date: DAY,
      filter: 'unverified',
      viewer: cto,
    });
    expect(idsOf(unverified.items)).toEqual([ceo.id]);
  });
});

describe("changing an Admin's attendance", () => {
  it('looks missing (by id) or is FORBIDDEN (by person) for HR, and works for another Admin', async () => {
    const rowId = (await db('attendance').where({ userId: ceo.id, workDate: DAY }).first()).id;
    const edit = (actor, id = rowId) =>
      attendance.updateRow({ actor, id, checkIn: '09:40', reason: 'Badge log' });
    const confirm = (actor) => attendance.confirmOffice({ actor, id: rowId, reason: 'Seen him' });
    const add = (actor) =>
      attendance.createForUser({
        actor,
        userId: cto.id,
        workDate: YESTERDAY,
        checkIn: '09:30',
        checkOut: '18:30',
        location: 'office',
        reason: 'Forgot to check in',
      });
    const missingId = rowId + 1000;
    for (const actor of [hr, pm]) {
      // An Admin's row answers exactly like a row that doesn't exist, so HR can't probe ids.
      const error = (promise) => promise.then(null, (caught) => caught);
      const [byAdminRow, byNoRow] = [await error(edit(actor)), await error(edit(actor, missingId))];
      expect([byAdminRow.code, byAdminRow.message]).toEqual([byNoRow.code, byNoRow.message]);
      expect(byAdminRow.code).toBe('NOT_FOUND');
      expect(await code(confirm(actor))).toBe('NOT_FOUND');
      expect(await code(add(actor))).toBe('FORBIDDEN');
    }
    const unchanged = await db('attendance').where({ id: rowId }).first();
    expect(unchanged).toMatchObject({ lateMinutes: 30, officeVerified: false });
    expect(await db('attendance').where({ userId: cto.id })).toHaveLength(0);

    expect(await edit(cto)).toMatchObject({ id: rowId, lateMinutes: 10 });
    expect(await confirm(cto)).toMatchObject({ id: rowId, officeVerified: true });
    expect(await add(ceo)).toMatchObject({ userId: cto.id, workDate: YESTERDAY });
  });
});

describe("an Admin's correction requests", () => {
  it('go to the other Admins only, and nobody when there is no other Admin', async () => {
    await db('users').where({ id: cto.id }).update({ status: 'deactivated' });
    try {
      await attendance.requestCorrection({
        user: ceo,
        type: 'check_out',
        workDate: YESTERDAY,
        checkOut: '18:40',
        reason: 'Left at 6:40 PM',
      });
    } finally {
      await db('users').where({ id: cto.id }).update({ status: 'active' });
    }
    const title = 'Ravi Kapoor asked for a correction';
    expect(await toldAbout(title)).toEqual([]);
    expect(await db('slackOutbox').where({ kind: 'dm' })).toHaveLength(0);

    await attendance.requestCorrection({
      user: ceo,
      type: 'check_in',
      workDate: DAY,
      checkIn: '09:35',
      reason: 'Meeting downstairs',
    });
    expect(await toldAbout(title)).toEqual([cto.id]);
    const dms = await db('slackOutbox').where({ kind: 'dm' });
    expect(dms.map((dm) => dm.channel)).toEqual(['UCTO']);
    expect(parseJson(dms[0].payload).text).toContain('Ravi Kapoor');

    // Everyone else's still go to HR.
    await attendance.requestCorrection({
      user: vishal,
      type: 'check_out',
      workDate: YESTERDAY,
      checkOut: '18:30',
      reason: 'Forgot',
    });
    expect(await toldAbout('Vishal Saini asked for a correction')).toEqual([hr.id]);
  });

  it('are listed and counted for Admins only', async () => {
    for (const viewer of [hr, pm]) {
      const { items, total } = await attendance.listCorrections({ viewer });
      expect(items.map((item) => item.userId)).toEqual([vishal.id]);
      expect(total).toBe(1);
      expect(await attendance.countPendingCorrections({ viewer })).toBe(1);
      const theirs = await attendance.listCorrections({ userId: ceo.id, viewer });
      expect(theirs).toEqual({ items: [], total: 0 });
    }
    const all = await attendance.listCorrections({ viewer: cto });
    expect(all.items.map((item) => item.userId)).toEqual([ceo.id, ceo.id, vishal.id]);
    expect(await attendance.countPendingCorrections({ viewer: cto })).toBe(3);
    // A person's own list on Today (no viewer) is unchanged.
    expect((await attendance.listCorrections({ userId: ceo.id })).total).toBe(2);
  });

  it('can be approved or rejected by another Admin only', async () => {
    const [checkOut, checkIn] = await db('attendanceCorrections')
      .where({ userId: ceo.id })
      .orderBy('id');
    for (const actor of [hr, pm]) {
      expect(await code(attendance.approveCorrection({ actor, id: checkIn.id }))).toBe('NOT_FOUND');
      expect(await code(attendance.rejectCorrection({ actor, id: checkOut.id, note: 'No' }))).toBe(
        'NOT_FOUND',
      );
    }
    const statuses = await db('attendanceCorrections').where({ userId: ceo.id }).pluck('status');
    expect(statuses).toEqual(['pending', 'pending']);

    const { row } = await attendance.approveCorrection({ actor: cto, id: checkIn.id });
    expect(row).toMatchObject({ userId: ceo.id, workDate: DAY, lateMinutes: 5 });
    const rejected = await attendance.rejectCorrection({
      actor: cto,
      id: checkOut.id,
      note: 'Check the badge log first',
    });
    expect(rejected.status).toBe('rejected');
    expect(await toldAbout('Your attendance correction was approved')).toEqual([ceo.id]);
    // Once decided, it still looks missing to HR (not "already handled"), and to an Admin it is
    // already handled.
    expect(
      await code(attendance.rejectCorrection({ actor: hr, id: checkOut.id, note: 'No' })),
    ).toBe('NOT_FOUND');
    expect(
      await code(attendance.rejectCorrection({ actor: ceo, id: checkOut.id, note: 'No' })),
    ).toBe('FORBIDDEN');
    expect(
      await code(attendance.rejectCorrection({ actor: cto, id: checkOut.id, note: 'No' })),
    ).toBe('REQUEST_ALREADY_HANDLED');
  });
});

describe("notifications about an Admin's attendance", () => {
  it('an unverified office check-in tells the other Admins, not HR', async () => {
    await attendance.checkIn({
      user: cto,
      ip: '198.51.100.7',
      location: 'office',
      unverifiedOffice: true,
    });
    expect(await toldAbout('Meera Pillai checked in at the office, unverified')).toEqual([ceo.id]);
  });

  it('a missing check-out tells the other Admins and the Admin, never HR', async () => {
    setNowForTests(at('00:05', '2026-10-01'));
    expect((await attendance.markMissingCheckouts()).marked).toBe(3);
    expect(await toldAbout("Meera Pillai didn't check out on Wed, 30 Sep")).toEqual([ceo.id]);
    expect(await toldAbout("Ravi Kapoor didn't check out on Wed, 30 Sep")).toEqual([cto.id]);
    expect(await toldAbout("Vishal Saini didn't check out on Wed, 30 Sep")).toEqual([hr.id]);
    // Each person who forgot is told, Admins included (unchanged).
    expect(await toldAbout("You didn't check out on Wed, 30 Sep")).toEqual(
      [ceo.id, cto.id, vishal.id].sort(),
    );
  });
});
