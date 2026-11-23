// HR approves a check-in correction while a holiday or leave write for that day is still open
// (CONTRACT 25, "The person's day": applyDayRules). The write inserts the leave, then locks and
// rewrites the day's rows; the approval waits on the same row lock. The approval reads the
// person's day only once it holds the row, so its late minutes follow the leave that committed
// first, never the calendar from before it.
import knex from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { localToUtc, setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { buildKnexConfig } from '../../knexfile.js';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const TZ = 'Asia/Kolkata';
const TUESDAY = '2026-11-17';
const at = (clock, date = TUESDAY) => localToUtc(date, clock, TZ).toDate();

let writer; // the leave write's own connection
let neha;
let karan;

/** Transactions of this database waiting on a row lock. */
async function lockWaits() {
  const [rows] = await db.raw(
    'SELECT t.trx_id FROM information_schema.INNODB_TRX t ' +
      'JOIN information_schema.PROCESSLIST p ON p.ID = t.trx_mysql_thread_id ' +
      "WHERE p.DB = DATABASE() AND t.trx_state = 'LOCK WAIT'",
  );
  return rows.length;
}

/** Karan's Tuesday (in 9:30, out 6:30) and his request to move the check-in to 2:05 PM. */
async function karansRequest() {
  const [rowId] = await db('attendance').insert({
    userId: karan.id,
    workDate: TUESDAY,
    checkInAt: at('09:30'),
    checkOutAt: at('18:30'),
    location: 'office',
    officeVerified: true,
    lateMinutes: 0,
    isWorkingDay: true,
    checkoutStatus: 'checked_out',
  });
  const correction = await attendance.requestCorrection({
    user: karan,
    type: 'check_in',
    workDate: TUESDAY,
    checkIn: '14:05',
    reason: 'I came in after my morning off',
  });
  return { rowId, correction };
}

beforeAll(async () => {
  writer = knex(buildKnexConfig());
  await resetDatabase();
  // Office 9:30 to 6:30, late after 9:30: the half-day split is 2:00 PM.
  await setSettings({ office_start: '09:30', office_end: '18:30', late_after: '09:30' });
  neha = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  karan = await createUser({ name: 'Karan Mehta' });
  setNowForTests(at('11:00', '2026-11-19').toISOString());
});

afterAll(async () => {
  await writer.destroy();
});

describe('approving a check-in correction while first-half leave is being marked', () => {
  it('counts late minutes from the leave that committed first (5, not 275)', async () => {
    const { rowId, correction } = await karansRequest();
    // The leave write: the leave first, then the day's row, locked by primary key.
    const leave = await writer.transaction();
    await leave('leaveEntries').insert({
      userId: karan.id,
      fromDate: TUESDAY,
      toDate: TUESDAY,
      part: 'first_half',
      createdBy: neha.id,
      updatedBy: neha.id,
    });
    await leave('attendance').where({ id: rowId }).first('id').forUpdate();

    const approval = attendance.approveCorrection({ actor: neha, id: correction.id });
    await vi.waitFor(async () => expect(await lockWaits()).toBe(1), {
      timeout: 10_000,
      interval: 50,
    });
    await leave.commit();
    await approval;

    expect(await db('attendance').where({ id: rowId }).first()).toMatchObject({
      checkInAt: at('14:05'),
      lateMinutes: 5,
    });
  });
});
