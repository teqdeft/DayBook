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

beforeAll(async () => {
  await resetDatabase();
  hr = await createUser({ name: 'Neha Gupta', role: 'hr' });
  admin = await createUser({ name: 'The Admin', role: 'admin', tracksAttendance: false });
});

beforeEach(async () => {
  await db('notifications').delete();
  await db('attendance').delete();
  await setSettings({ auto_mark_missing_checkout: true, working_days: [1, 2, 3, 4, 5] });
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
