// Missing check-outs (guide 7.3.4 and 7.10): the nightly job, the "Missing check-out" number on
// Attendance and HR's list. Only active people who track attendance count anywhere, the number
// looks back to the last working day, and the list's total matches what it can show.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

vi.mock('@/modules/reports', () => ({
  reports: {
    getDayStatus: vi.fn(async () => ({ reportId: null, status: 'none', totalMinutes: 0 })),
  },
}));

const HOME_IP = '198.51.100.7';
// Local clock in India (UTC+5:30) on a date, as an ISO string.
const at = (clock, date) => {
  const [h, m] = clock.split(':').map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m - 330);
  return d.toISOString();
};

let hr;
let admin;

async function checkInOn(user, date, clock = '09:30') {
  setNowForTests(at(clock, date));
  return attendance.checkIn({ user, ip: HOME_IP });
}

async function checkOutOn(user, date, clock = '18:30') {
  setNowForTests(at(clock, date));
  return attendance.checkOut({ user, ip: HOME_IP });
}

/** Runs the 00:05 job on the morning of `date`. */
async function midnightJob(date) {
  setNowForTests(at('00:05', date));
  return attendance.markMissingCheckouts();
}

function missingTitles() {
  return db('notifications')
    .where({ type: 'attendance.missing_checkout' })
    .orderBy('id')
    .select('userId', 'title');
}

function missingNotices() {
  return db('notifications')
    .where({ type: 'attendance.missing_checkout' })
    .orderBy('id')
    .select('userId', 'title', 'body', 'link');
}

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Gupta', role: 'hr' });
  admin = await createUser({ name: 'The Admin', role: 'admin', tracksAttendance: false });
});

beforeEach(async () => {
  await db('notifications').delete();
  await db('attendanceCorrections').delete();
  await db('attendance').delete();
  await db('holidays').delete();
  // People check in from home as WFH without asking HR first (CONTRACT 17 is tested elsewhere).
  await setSettings({
    auto_mark_missing_checkout: true,
    working_days: [1, 2, 3, 4, 5],
    wfh_requires_approval: false,
  });
});

describe('the "Missing check-out" number', () => {
  it("still shows Friday's missing check-outs on Monday after weekend work", async () => {
    const a = await createUser({ name: 'Asha' });
    const b = await createUser({ name: 'Bilal' });
    const weekend = await createUser({ name: 'Weekend' });
    await checkInOn(a, '2026-10-02'); // Friday
    await checkInOn(b, '2026-10-02');
    expect(await midnightJob('2026-10-03')).toEqual({ marked: 2 });
    await checkInOn(weekend, '2026-10-03'); // Saturday, checked out properly
    await checkOutOn(weekend, '2026-10-03', '13:00');
    // An untracked Admin checking in on Sunday doesn't move the day either.
    await checkInOn(admin, '2026-10-04');
    await checkOutOn(admin, '2026-10-04', '12:00');
    await midnightJob('2026-10-05');

    const monday = await attendance.getDaySummary('2026-10-05');
    expect(monday).toMatchObject({
      missingCheckouts: 2,
      missingFromDate: '2026-10-02',
      missingDays: 1,
    });
    const list = await attendance.listMissingCheckouts();
    expect(list.total).toBe(2);
    expect(list.items.map((row) => [row.user.name, row.workDate])).toEqual([
      ['Asha', '2026-10-02'],
      ['Bilal', '2026-10-02'],
    ]);
  });

  it('counts every day since the last working day, and only that far back', async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    await checkInOn(a, '2026-10-01'); // Thursday: older than the last working day
    await checkInOn(b, '2026-10-02'); // Friday
    await checkInOn(c, '2026-10-03'); // Saturday, forgot to check out too
    await midnightJob('2026-10-05');

    expect(await attendance.getDaySummary('2026-10-05')).toMatchObject({
      missingCheckouts: 2,
      missingFromDate: '2026-10-02',
      missingDays: 2,
    });
    // Tuesday looks at Monday only: nothing went missing then.
    expect(await attendance.getDaySummary('2026-10-06')).toMatchObject({
      missingCheckouts: 0,
      missingFromDate: '2026-10-05',
      missingDays: 0,
    });
    // On a usual weekday it is yesterday's.
    expect(await attendance.getDaySummary('2026-10-02')).toMatchObject({
      missingCheckouts: 1,
      missingFromDate: '2026-10-01',
      missingDays: 1,
    });
    // A fixed row no longer counts.
    await db('attendance')
      .where({ userId: b.id })
      .update({ checkoutStatus: 'corrected', checkOutAt: new Date(at('18:00', '2026-10-02')) });
    expect((await attendance.getDaySummary('2026-10-05')).missingCheckouts).toBe(1);
  });

  it('follows the working_days setting', async () => {
    await setSettings({ working_days: [1, 2, 3, 4, 5, 6] });
    const a = await createUser();
    const b = await createUser();
    await checkInOn(a, '2026-10-02'); // Friday
    await checkInOn(b, '2026-10-03'); // Saturday is a working day now
    await midnightJob('2026-10-05');
    expect(await attendance.getDaySummary('2026-10-05')).toMatchObject({
      missingCheckouts: 1,
      missingFromDate: '2026-10-03',
      missingDays: 1,
    });
  });
});

describe('people who are not on the Attendance screen', () => {
  it("marks a leaver's open check-out missing without counting, listing or announcing it", async () => {
    // Created first, so on the same day the leaver's row would sort first in HR's list.
    const leaver = await createUser({ name: 'Leaver' });
    const a = await createUser({ name: 'Asha' });
    const b = await createUser({ name: 'Bilal' });
    for (const person of [leaver, a, b]) await checkInOn(person, '2026-09-30');
    await db('users')
      .where({ id: leaver.id })
      .update({ status: 'deactivated', deactivatedAt: new Date(at('15:00', '2026-09-30')) });

    expect(await midnightJob('2026-10-01')).toEqual({ marked: 3 });
    const leaverRow = await db('attendance').where({ userId: leaver.id }).first();
    expect(leaverRow.checkoutStatus).toBe('missing');
    const audited = await db('auditLogs').where({
      action: 'attendance.mark_missing',
      entityId: leaverRow.id,
    });
    expect(audited).toHaveLength(1);

    const sent = await missingTitles();
    expect(sent).toEqual([
      { userId: hr.id, title: "Asha didn't check out on Wed, 30 Sep" },
      { userId: a.id, title: "You didn't check out on Wed, 30 Sep" },
      { userId: hr.id, title: "Bilal didn't check out on Wed, 30 Sep" },
      { userId: b.id, title: "You didn't check out on Wed, 30 Sep" },
    ]);

    expect((await attendance.getDaySummary('2026-10-01')).missingCheckouts).toBe(2);
    const list = await attendance.listMissingCheckouts({ limit: 2 });
    expect(list.items.map((row) => row.user.name)).toEqual(['Asha', 'Bilal']);
    expect(list.total).toBe(2);
  });

  it("leaves out untracked people (a PM, an Admin who doesn't track attendance)", async () => {
    const pm = await createUser({ name: 'Pam', role: 'pm', tracksAttendance: false });
    const a = await createUser({ name: 'Asha' });
    // A PM's row from before PMs stopped checking in, and an untracked Admin's own check-in.
    await db('attendance').insert({
      userId: pm.id,
      workDate: '2026-09-30',
      checkInAt: new Date(at('09:30', '2026-09-30')),
      location: 'office',
    });
    await checkInOn(admin, '2026-09-30');
    await checkInOn(a, '2026-09-30');

    expect(await midnightJob('2026-10-01')).toEqual({ marked: 3 });
    const sent = await missingTitles();
    expect(sent.map((row) => row.title)).toEqual([
      "Asha didn't check out on Wed, 30 Sep",
      "You didn't check out on Wed, 30 Sep",
    ]);
    expect(sent.map((row) => row.userId)).not.toContain(pm.id);
    expect(sent.map((row) => row.userId)).not.toContain(admin.id);

    expect((await attendance.getDaySummary('2026-10-01')).missingCheckouts).toBe(1);
    const list = await attendance.listMissingCheckouts();
    expect(list).toMatchObject({ total: 1 });
    expect(list.items.map((row) => row.userId)).toEqual([a.id]);
  });
});

describe('the midnight notification and the holiday rule (CONTRACT 25)', () => {
  it('asks the person to add the time on Today, with the pop-up link', async () => {
    const a = await createUser({ name: 'Asha' });
    await checkInOn(a, '2026-09-30');
    await midnightJob('2026-10-01');
    const sent = await missingNotices();
    expect(sent).toEqual([
      {
        userId: hr.id,
        title: "Asha didn't check out on Wed, 30 Sep",
        body: 'Marked as a missing check-out at midnight.',
        link: '/attendance',
      },
      {
        userId: a.id,
        title: "You didn't check out on Wed, 30 Sep",
        body: 'Add the time you left on Today.',
        link: '/today?checkout=missing',
      },
    ]);
  });

  it("skips a Monday holiday: Tuesday's number still shows Friday's, and the total is all still to fix", async () => {
    const a = await createUser({ name: 'Asha' });
    const b = await createUser({ name: 'Bilal' });
    const c = await createUser({ name: 'Chitra' });
    await checkInOn(a, '2026-10-01'); // Thursday: before the window
    await checkInOn(b, '2026-10-02'); // Friday
    await midnightJob('2026-10-03');
    await db('holidays').insert({ holidayDate: '2026-10-05', name: 'Holiday Monday' });
    await checkInOn(c, '2026-10-05'); // worked on the holiday, forgot to check out
    await midnightJob('2026-10-06');

    expect(await attendance.getDaySummary('2026-10-06')).toMatchObject({
      missingCheckouts: 2,
      missingFromDate: '2026-10-02',
      missingDays: 2,
      missingTotal: 3,
    });
    expect(await attendance.lastWorkingDayBefore('2026-10-06')).toBe('2026-10-02');
    // Without the holiday the Tuesday looks at Monday only.
    await db('holidays').delete();
    expect(await attendance.getDaySummary('2026-10-06')).toMatchObject({
      missingCheckouts: 1,
      missingFromDate: '2026-10-05',
      missingTotal: 3,
    });
  });
});

describe('who entered a missing check-out (CONTRACT 25, item 7)', () => {
  it('names HR for a fix of a missing row; an approved correction clears it', async () => {
    const a = await createUser({ name: 'Asha' });
    await checkInOn(a, '2026-09-30');
    await midnightJob('2026-10-01');
    const row = await db('attendance').where({ userId: a.id }).first();
    setNowForTests(at('10:00', '2026-10-01'));
    await attendance.updateRow({ actor: hr, id: row.id, checkOut: '18:40', reason: 'Badge log' });
    const fixed = await db('attendance').where({ id: row.id }).first();
    expect(fixed).toMatchObject({
      checkoutStatus: 'corrected',
      checkoutEnteredBy: hr.id,
      checkoutSuggestedAt: null,
    });
    expect(fixed.checkoutEnteredAt).toBeInstanceOf(Date);
    const entered = await attendance.checkoutEnteredFor([row.id]);
    expect(entered.get(row.id)).toMatchObject({
      by: { id: hr.id, name: 'Neha Gupta' },
      self: false,
      pastLastSeen: false,
    });
    const item = (await attendance.listDay('2026-09-30')).find((one) => one.user.id === a.id);
    expect(item.checkoutEnteredBy).toMatchObject({ id: hr.id, name: 'Neha Gupta', self: false });

    await attendance.requestCorrection({
      user: a,
      type: 'check_out',
      workDate: '2026-09-30',
      checkOut: '19:00',
      reason: 'I left later',
    });
    const pending = await db('attendanceCorrections')
      .where({ userId: a.id, status: 'pending' })
      .first();
    await attendance.approveCorrection({ actor: hr, id: pending.id });
    expect(await db('attendance').where({ id: row.id }).first()).toMatchObject({
      checkoutEnteredBy: null,
      checkoutEnteredAt: null,
      checkoutSuggestedAt: null,
    });
  });

  it("leaves an ordinary row's check-out edit unnamed", async () => {
    const a = await createUser({ name: 'Asha' });
    await checkInOn(a, '2026-09-30');
    await checkOutOn(a, '2026-09-30', '18:00');
    const row = await db('attendance').where({ userId: a.id }).first();
    setNowForTests(at('10:00', '2026-10-01'));
    await attendance.updateRow({ actor: hr, id: row.id, checkOut: '18:20', reason: 'Badge log' });
    expect((await db('attendance').where({ id: row.id }).first()).checkoutEnteredBy).toBeNull();
  });

  it('shows the Check flag of a self-entered time to HR only', async () => {
    const a = await createUser({ name: 'Asha Rao' });
    const pm = await createUser({ name: 'Pam', role: 'pm', tracksAttendance: false });
    await checkInOn(a, '2026-09-30');
    await checkOutOn(a, '2026-09-30', '18:30');
    const row = await db('attendance').where({ userId: a.id }).first();
    await db('attendance')
      .where({ id: row.id })
      .update({
        checkoutStatus: 'corrected',
        checkoutEnteredBy: a.id,
        checkoutEnteredAt: new Date(at('09:00', '2026-10-01')),
        checkoutSuggestedAt: new Date(at('13:05', '2026-09-30')),
      });
    const forHr = (await attendance.listDay('2026-09-30', { viewer: hr })).find(
      (one) => one.user.id === a.id,
    );
    expect(forHr.checkoutEnteredBy).toMatchObject({ id: a.id, self: true, pastLastSeen: true });
    expect(forHr.checkoutEnteredBy.suggestedAt).toBeInstanceOf(Date);
    const forPm = (await attendance.listDay('2026-09-30', { viewer: pm })).find(
      (one) => one.user.id === a.id,
    );
    expect(forPm.checkoutEnteredBy).toMatchObject({
      name: 'Asha Rao',
      self: true,
      pastLastSeen: false,
      suggestedAt: null,
    });
  });
});
