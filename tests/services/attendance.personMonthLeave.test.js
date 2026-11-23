// The person month's Changes for leave that left the month (CONTRACT 25, items 8 and 9, Risks): a
// leave HR deleted shows through its leave.delete audit row, with the reason, and a leave moved to
// another month keeps its rows in the old month. Found by the snapshot's person and dates, so
// another person's leave and leave of another month stay out; the person's own month has no note.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

const NOW = '2026-11-19T06:30:00Z'; // Thu, 19 Nov, 12:00 in India
const LATER = '2026-11-19T07:30:00Z'; // an hour later, so the newest change is first

let neha;
let admin;
let vishal;
let priya;

const titles = (month) => month.changes.map((change) => change.title);

const mark = (input) =>
  attendance.createLeave({
    actor: neha,
    part: 'full',
    paid: true,
    leaveType: 'casual',
    ip: null,
    ...input,
  });

const novemberOf = (viewer, person) =>
  attendance.getPersonMonth({ viewer, userId: person.id, month: '2026-11' });

beforeAll(async () => {
  await resetDatabase();
  await setSettings({
    working_days: [1, 2, 3, 4, 5],
    office_start: '09:30',
    office_end: '18:30',
    late_after: '09:30',
    payroll_month_start_day: 1,
  });
  neha = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  admin = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
  vishal = await createUser({ name: 'Vishal Saini' });
  priya = await createUser({ name: 'Priya Sharma' });
});

beforeEach(async () => {
  setNowForTests(NOW);
  await db('leaveEntries').delete();
  await db('auditLogs').delete();
  await db('notifications').delete();
});

afterEach(() => setNowForTests(null));

describe('getPersonMonth changes for leave that left the month', () => {
  it('lists a deleted leave through its leave.delete row, with the reason and the note', async () => {
    const entry = await mark({
      userId: vishal.id,
      fromDate: '2026-11-09',
      toDate: '2026-11-10',
      note: 'Family function out of town',
    });
    // Another person's deleted leave, and Vishal's deleted leave in October, stay out.
    const other = await mark({ userId: priya.id, fromDate: '2026-11-09' });
    const october = await mark({ userId: vishal.id, fromDate: '2026-10-12' });
    setNowForTests(LATER);
    await attendance.deleteLeave({ actor: neha, id: entry.id, reason: 'Came in after all' });
    await attendance.deleteLeave({ actor: neha, id: other.id, reason: 'Came in' });
    await attendance.deleteLeave({ actor: neha, id: october.id, reason: 'Came in' });

    const month = await novemberOf(neha, vishal);
    expect(titles(month)).toEqual([
      'Neha Kapoor removed leave for Mon, 9 – Tue, 10 Nov',
      'Neha Kapoor marked leave for Mon, 9 – Tue, 10 Nov',
    ]);
    expect(month.changes[0]).toMatchObject({
      action: 'leave.delete',
      actor: { id: neha.id, name: 'Neha Kapoor' },
      details: ['Casual, paid, full day'],
      reason: 'Came in after all',
      note: 'Family function out of town',
    });
  });

  it("keeps a deleted leave in the person's own month without the note", async () => {
    const entry = await attendance.createLeave({
      actor: admin,
      userId: neha.id,
      fromDate: '2026-11-16',
      part: 'full',
      paid: false,
      leaveType: 'sick',
      note: 'Private note about Neha',
      ip: null,
    });
    setNowForTests(LATER);
    await attendance.deleteLeave({ actor: admin, id: entry.id, reason: 'Wrong day' });

    const month = await novemberOf(neha, neha);
    expect(titles(month)).toEqual([
      'Ravi Kapoor removed leave for Mon, 16 Nov',
      'Ravi Kapoor marked leave for Mon, 16 Nov',
    ]);
    expect(month.changes.map((change) => change.note)).toEqual([null, null]);
    expect(JSON.stringify(month)).not.toContain('Private note');
  });

  it('keeps the rows of a leave moved to another month in the old month', async () => {
    const entry = await mark({ userId: vishal.id, fromDate: '2026-11-09' });
    setNowForTests(LATER);
    await attendance.updateLeave({
      actor: neha,
      id: entry.id,
      fromDate: '2026-12-07',
      toDate: '2026-12-07',
      reason: 'Moved to December',
    });

    const november = await novemberOf(neha, vishal);
    expect(titles(november)).toEqual([
      'Neha Kapoor changed leave for Mon, 7 Dec',
      'Neha Kapoor marked leave for Mon, 9 Nov',
    ]);
    expect(november.changes[0]).toMatchObject({
      action: 'leave.update',
      reason: 'Moved to December',
    });

    // December, once it is the current month, lists the entry's whole trail (it touches it now).
    setNowForTests('2026-12-08T06:30:00Z');
    const december = await attendance.getPersonMonth({
      viewer: neha,
      userId: vishal.id,
      month: '2026-12',
    });
    expect(titles(december)).toEqual([
      'Neha Kapoor changed leave for Mon, 7 Dec',
      'Neha Kapoor marked leave for Mon, 9 Nov',
    ]);
  });
});
