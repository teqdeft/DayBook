// The Attendance page's "Work from home requests" card (CONTRACT 17): HR and Admins get the
// pending requests (soonest day first) and the ones handled in the last 7 days; HR never sees an
// Admin's request; the viewer's own has no buttons; PMs get no card, and with nothing to show the
// card is left out.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { loadAttendance } from '@/app/(app)/attendance/attendanceData';
import { createUser, resetDatabase } from '../helpers/db.js';

const NOW = '2026-10-13T04:42:00Z'; // Tuesday 13 October, 10:12 in India

let hr;
let hr2;
let ceo;
let ceo2;
let pm;
let vishal;
let karan;

const ask = (user, fromDate, toDate, reason = 'Plumber visit in the morning') =>
  attendance.requestWfh({ user, fromDate, toDate, reason });

/** A request someone decided on at `handledAt` (UTC). */
function addHandled(user, { status, handledAt, by, fromDate }) {
  return db('wfhRequests').insert({
    userId: user.id,
    fromDate,
    toDate: fromDate,
    reason: 'Earlier request',
    status,
    handledBy: by.id,
    handledAt: new Date(handledAt),
    declineReason: status === 'declined' ? 'Busy week' : null,
  });
}

const wfhFor = async (user) => (await loadAttendance({ user })).wfh;
const names = (items) => items.map((item) => item.user.name);

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(NOW);
  hr = await createUser({ name: 'Neha Gupta', role: 'hr' });
  hr2 = await createUser({ name: 'Sunita Rao', role: 'hr' });
  ceo = await createUser({ name: 'Ravi Kapoor', role: 'admin' });
  ceo2 = await createUser({ name: 'Anil Shah', role: 'admin' });
  pm = await createUser({ name: 'Priya Menon', role: 'pm', tracksAttendance: false });
  vishal = await createUser({ name: 'Vishal Saini' });
  karan = await createUser({ name: 'Karan Mehta' });
});

describe('Attendance: work from home requests card', () => {
  it('is left out while there are no requests', async () => {
    expect(await wfhFor(hr)).toBeNull();
    expect(await wfhFor(ceo)).toBeNull();
  });

  it("shows HR the pending requests, soonest first, without an Admin's", async () => {
    await ask(vishal, '2026-10-14', '2026-10-16');
    await ask(karan, '2026-10-13', null, 'Waiting for a delivery');
    await ask(hr2, '2026-10-20');
    await ask(ceo2, '2026-10-15');

    const card = await wfhFor(hr);
    expect(card.waiting).toBe(3);
    expect(names(card.pending)).toEqual(['Karan Mehta', 'Vishal Saini', 'Sunita Rao']);
    expect(card.pending[0]).toMatchObject({
      days: 'Tue, 13 Oct',
      reason: 'Waiting for a delivery',
      sent: 'Sent today at 10:12',
      today: true,
      own: false,
    });
    expect(card.pending[1]).toMatchObject({ days: 'Wed, 14 – Fri, 16 Oct', today: false });
    expect(card.handled).toEqual([]);
    expect(card.more).toBe(0);
  });

  it("marks the viewer's own request and leaves it out of their count", async () => {
    const card = await wfhFor(hr2);
    expect(card.waiting).toBe(2);
    const own = card.pending.find((item) => item.user.id === hr2.id);
    expect(own).toMatchObject({
      own: true,
      ownNote: 'Your own request. Another HR person or an Admin decides.',
    });
    expect(card.pending.filter((item) => item.own)).toHaveLength(1);
  });

  it("shows Admins every request, an Admin's own marked as theirs", async () => {
    const card = await wfhFor(ceo);
    expect(card.waiting).toBe(4);
    expect(names(card.pending)).toEqual(['Karan Mehta', 'Vishal Saini', 'Anil Shah', 'Sunita Rao']);
    const other = await wfhFor(ceo2);
    expect(other.waiting).toBe(3);
    expect(other.pending.find((item) => item.own)).toMatchObject({
      user: { id: ceo2.id },
      ownNote: 'Your own request. Another Admin decides.',
    });
  });

  it('lists decisions from the last 7 days, newest first, with their status', async () => {
    await addHandled(vishal, {
      status: 'approved',
      handledAt: '2026-10-10T06:00:00Z',
      by: hr,
      fromDate: '2026-10-12',
    });
    await addHandled(karan, {
      status: 'cancelled',
      handledAt: '2026-10-12T06:00:00Z',
      by: karan,
      fromDate: '2026-10-19',
    });
    await addHandled(vishal, {
      status: 'declined',
      handledAt: '2026-10-03T06:00:00Z', // 10 days ago: no longer on the card
      by: hr,
      fromDate: '2026-10-05',
    });
    await addHandled(ceo2, {
      status: 'approved',
      handledAt: '2026-10-12T07:00:00Z',
      by: ceo,
      fromDate: '2026-10-12',
    });

    const card = await wfhFor(hr);
    expect(card.pending).toHaveLength(3);
    expect(card.handled.map((item) => [item.user.name, item.status, item.line])).toEqual([
      ['Karan Mehta', 'cancelled', 'They cancelled it yesterday'],
      ['Vishal Saini', 'approved', 'Approved by you on Sat, 10 Oct'],
    ]);
    const admins = await wfhFor(ceo);
    expect(admins.handled.map((item) => [item.user.name, item.line])).toEqual([
      ['Anil Shah', 'Approved by you yesterday'],
      ['Karan Mehta', 'They cancelled it yesterday'],
      ['Vishal Saini', 'Approved by Neha Gupta on Sat, 10 Oct'],
    ]);
  });

  it('shows only handled ones once nothing is waiting, and the count follows decisions', async () => {
    const pending = await db('wfhRequests')
      .where({ status: 'pending' })
      .whereNot({ userId: ceo2.id });
    for (const row of pending) await attendance.approveWfh({ actor: ceo, id: row.id });
    const card = await wfhFor(hr);
    expect(card.waiting).toBe(0);
    expect(card.pending).toEqual([]);
    expect(card.handled.length).toBeGreaterThan(2);
    expect(card.handled[0]).toMatchObject({
      status: 'approved',
      line: 'Approved by Ravi Kapoor today',
    });
  });

  it('shows a pending request whose days are over as expired, for 7 days after them', async () => {
    const asked = (fromDate, toDate) => ({
      userId: karan.id,
      fromDate,
      toDate,
      reason: 'Nobody looked',
      status: 'pending',
      createdAt: new Date('2026-10-01T04:00:00Z'),
    });
    await db('wfhRequests').insert([
      asked('2026-10-08', '2026-10-09'),
      asked('2026-10-01', '2026-10-02'), // over for more than 7 days: off the card
    ]);
    const card = await wfhFor(hr);
    expect(card.waiting).toBe(0);
    expect(card.pending).toEqual([]);
    expect(card.handled[0]).toMatchObject({
      user: { name: 'Karan Mehta' },
      days: 'Thu, 8 – Fri, 9 Oct',
      status: 'expired',
      line: 'Not decided in time',
    });
    expect(card.handled.filter((item) => item.status === 'expired')).toHaveLength(1);
  });

  it('is not loaded for PMs, who see Attendance read-only', async () => {
    expect(await wfhFor(pm)).toBeNull();
  });
});
