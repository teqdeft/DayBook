// The day rules (CONTRACT 25): a holiday or leave write fixes only the attendance rows whose day
// it changed, locking them in work_date, user_id order and auditing each; recheckDayRules fixes
// rows created while the write ran; a leave note edit keeps the stored late minutes.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

// Local clock in India (UTC+5:30) on a date, as a Date.
const at = (clock, date) => new Date(`${date}T${clock}:00+05:30`);
const THU = '2026-11-12';
const FRI = '2026-11-13';
const MON = '2026-11-16';

let hr;
let asha;
let bilal;
let chitra;

async function addRow(user, date, clock, lateMinutes, extra = {}) {
  const [id] = await db('attendance').insert({
    userId: user.id,
    workDate: date,
    checkInAt: at(clock, date),
    checkOutAt: at('18:30', date),
    location: 'office',
    officeVerified: true,
    lateMinutes,
    isWorkingDay: true,
    checkoutStatus: 'checked_out',
    source: 'self',
    createdAt: at('09:00', '2026-11-01'),
    updatedAt: at('09:00', '2026-11-01'),
    ...extra,
  });
  return id;
}

const row = (id) => db('attendance').where({ id }).first();
const rulesAudits = () =>
  db('auditLogs').where({ action: 'attendance.day_rules' }).orderBy('id', 'asc');

function inTransaction(run) {
  return db.transaction((trx) => run(trx));
}

beforeAll(async () => {
  await resetDatabase();
  await setSettings({
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    wfh_requires_approval: false,
  });
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  asha = await createUser({ name: 'Asha' });
  bilal = await createUser({ name: 'Bilal' });
  chitra = await createUser({ name: 'Chitra' });
});

beforeEach(async () => {
  setNowForTests('2026-11-19T06:00:00Z');
  await db('auditLogs').delete();
  await db('attendance').delete();
  await db('holidays').delete();
  await db('leaveEntries').delete();
  await setSettings({ late_after: '09:30' });
});

describe('applyDayRules', () => {
  it('fixes only the rows whose day changed, in work_date, user_id order, and audits each', async () => {
    // Inserted out of order: Bilal's Friday row first.
    const bilalFri = await addRow(bilal, FRI, '09:52', 22);
    const ashaFri = await addRow(asha, FRI, '09:40', 10);
    const chitraThu = await addRow(chitra, THU, '09:45', 15);
    const ashaThu = await addRow(asha, THU, '09:31', 1);
    // Late after moved since Thursday's check-ins: Thursday's day doesn't change, so it keeps
    // its stored minutes.
    await setSettings({ late_after: '09:40' });

    const { result, changed } = await inTransaction((trx) =>
      attendance.applyDayRules(
        { from: THU, to: FRI, reason: 'Holiday added: Diwali', actorId: hr.id },
        trx,
        async (inner) => {
          const [id] = await inner('holidays').insert({ holidayDate: FRI, name: 'Diwali' });
          return id;
        },
      ),
    );
    expect(result).toBeGreaterThan(0);
    expect(changed.map((item) => item.rowId)).toEqual([ashaFri, bilalFri]);
    expect(changed[1]).toMatchObject({
      userId: bilal.id,
      workDate: FRI,
      before: { lateMinutes: 22, isWorkingDay: true },
      after: { lateMinutes: 0, isWorkingDay: false },
    });
    expect(await row(bilalFri)).toMatchObject({ lateMinutes: 0, isWorkingDay: false });
    expect(await row(chitraThu)).toMatchObject({ lateMinutes: 15, isWorkingDay: true });
    expect(await row(ashaThu)).toMatchObject({ lateMinutes: 1, isWorkingDay: true });
    const audits = await rulesAudits();
    expect(audits.map((item) => item.entityId)).toEqual([ashaFri, bilalFri]);
    expect(audits[0]).toMatchObject({
      actorId: hr.id,
      entityType: 'attendance',
      reason: 'Holiday added: Diwali',
    });
    expect(JSON.parse(audits[0].after)).toEqual({ lateMinutes: 0, isWorkingDay: false });

    // Deleting the holiday works the late minutes out again, with today's late mark (9:40).
    const back = await inTransaction((trx) =>
      attendance.applyDayRules(
        { from: FRI, to: FRI, reason: 'Holiday removed: Diwali', actorId: hr.id },
        trx,
        (inner) => inner('holidays').where({ holidayDate: FRI }).delete(),
      ),
    );
    expect(back.changed.map((item) => item.rowId)).toEqual([ashaFri, bilalFri]);
    expect(await row(bilalFri)).toMatchObject({ lateMinutes: 12, isWorkingDay: true });
    expect(await row(ashaFri)).toMatchObject({ lateMinutes: 0, isWorkingDay: true });
  });

  it('first-half leave added after a 13:45 check-in clears the late mark; deleting it restores it', async () => {
    const id = await addRow(asha, MON, '13:45', 255);
    const scope = { userIds: [asha.id], from: MON, to: MON, actorId: hr.id };
    let leaveId;
    await inTransaction((trx) =>
      attendance.applyDayRules({ ...scope, reason: 'Leave marked' }, trx, async (inner) => {
        [leaveId] = await inner('leaveEntries').insert({
          userId: asha.id,
          fromDate: MON,
          toDate: MON,
          part: 'first_half',
        });
      }),
    );
    expect(await row(id)).toMatchObject({ lateMinutes: 0, isWorkingDay: true });
    await inTransaction((trx) =>
      attendance.applyDayRules({ ...scope, reason: 'Leave removed' }, trx, (inner) =>
        inner('leaveEntries').where({ id: leaveId }).delete(),
      ),
    );
    expect(await row(id)).toMatchObject({ lateMinutes: 255 });
  });

  it('a leave note edit changes no row, even after Late after moved since the check-in', async () => {
    const id = await addRow(asha, MON, '09:52', 22);
    const [leaveId] = await db('leaveEntries').insert({
      userId: bilal.id,
      fromDate: MON,
      toDate: MON,
      part: 'full',
    });
    await setSettings({ late_after: '10:00' });
    const { changed } = await inTransaction((trx) =>
      attendance.applyDayRules(
        { userIds: [asha.id, bilal.id], from: MON, to: MON, reason: 'Leave changed' },
        trx,
        (inner) => inner('leaveEntries').where({ id: leaveId }).update({ note: 'Family' }),
      ),
    );
    expect(changed).toEqual([]);
    expect(await row(id)).toMatchObject({ lateMinutes: 22 });
    expect(await rulesAudits()).toHaveLength(0);
  });
});

describe('recheckDayRules', () => {
  it('fixes rows created since the write started and leaves older ones alone', async () => {
    const since = at('11:00', '2026-11-19');
    const older = await addRow(asha, FRI, '09:52', 22);
    // A check-in that committed while the holiday was being added: it read the old calendar.
    const during = await addRow(bilal, FRI, '09:52', 22, { createdAt: at('11:00', '2026-11-19') });
    await db('holidays').insert({ holidayDate: FRI, name: 'Diwali' });

    const { changed } = await inTransaction((trx) =>
      attendance.recheckDayRules(
        { from: FRI, to: FRI, since, reason: 'Holiday added: Diwali', actorId: hr.id },
        trx,
      ),
    );
    expect(changed.map((item) => item.rowId)).toEqual([during]);
    expect(await row(during)).toMatchObject({ lateMinutes: 0, isWorkingDay: false });
    expect(await row(older)).toMatchObject({ lateMinutes: 22, isWorkingDay: true });
    expect((await rulesAudits()).map((item) => item.entityId)).toEqual([during]);
  });
});

describe('check-in on a holiday (getDay)', () => {
  it('saves the row as not a working day with no late minutes', async () => {
    await db('holidays').insert({ holidayDate: '2026-11-19', name: 'Guru Nanak Jayanti' });
    setNowForTests(at('11:10', '2026-11-19'));
    const saved = await attendance.checkIn({ user: chitra, ip: '198.51.100.7' });
    expect(saved).toMatchObject({ isWorkingDay: false, lateMinutes: 0 });
    const items = await attendance.listDay('2026-11-19');
    const summary = await attendance.getDaySummary('2026-11-19', { items });
    expect(summary).toMatchObject({ notCheckedIn: 0, holiday: { name: 'Guru Nanak Jayanti' } });
    expect(items.find((item) => item.user.id === asha.id).where).toBe('holiday');
    expect(await attendance.companyDay('2026-11-19')).toMatchObject({
      weekday: true,
      isWorkingDay: false,
      holiday: { name: 'Guru Nanak Jayanti' },
    });
  });
});
