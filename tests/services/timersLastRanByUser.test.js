// timers.lastRanByUser (CONTRACT 25): when each person's last finished entry of a work date ended,
// the timer sign of the suggested check-out time for a past date. A timer still running from that
// date gives no sign (lastRanAt would answer "now").
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { timers } from '@/modules/timers';
import { createUser, resetDatabase } from '../helpers/db.js';
import { createProject } from './dashboardKit.js';
import { at, insertEntry, setClock, TODAY, YESTERDAY } from './timersKit.js';

vi.mock('@/modules/reports', () => ({ reports: {} }));

let pm;
let acme;
let twoEntries;
let stillRunning;
let onlyRunning;
let otherDay;
let byHand;

beforeAll(async () => {
  await resetDatabase();
  setClock('11:00');
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
  twoEntries = await createUser({ name: 'Priya Sharma' });
  stillRunning = await createUser({ name: 'Vishal Saini' });
  onlyRunning = await createUser({ name: 'Karan Mehta' });
  otherDay = await createUser({ name: 'Otis Other' });
  byHand = await createUser({ name: 'Hana Hand' });
  const day = { date: YESTERDAY };
  await insertEntry(twoEntries, acme, { ...day, from: '10:00', to: '13:00' });
  await insertEntry(twoEntries, acme, { ...day, from: '14:00', to: '18:42' });
  await insertEntry(stillRunning, acme, { ...day, from: '10:00', to: '17:15' });
  await insertEntry(stillRunning, acme, { ...day, from: '17:20' }); // left running overnight
  await insertEntry(onlyRunning, acme, { ...day, from: '09:30' });
  await insertEntry(otherDay, acme, { from: '09:30', to: '10:30' }); // today, not yesterday
  await insertEntry(byHand, acme, { ...day, from: '15:00', to: '19:05', source: 'manual' });
});

describe('lastRanByUser', () => {
  it('answers the latest end of a finished entry of that date, per person, in one query', async () => {
    const ids = [twoEntries, stillRunning, onlyRunning, otherDay, byHand].map((u) => u.id);
    const queries = [];
    const count = (query) => queries.push(query.sql);
    db.on('query', count);
    const found = await timers.lastRanByUser({ workDate: YESTERDAY, userIds: ids });
    db.off('query', count);
    expect(queries).toHaveLength(1);
    expect(found).toBeInstanceOf(Map);
    expect([...found.keys()]).toEqual(ids.map(Number));
    expect(found.get(Number(twoEntries.id))).toEqual(at('18:42', YESTERDAY));
    // The running entry gives no sign; the finished one before it still does.
    expect(found.get(Number(stillRunning.id))).toEqual(at('17:15', YESTERDAY));
    expect(found.get(Number(onlyRunning.id))).toBeNull();
    expect(found.get(Number(otherDay.id))).toBeNull();
    // Any finished entry counts, as in lastRanAt (auto check-out's sign of work).
    expect(found.get(Number(byHand.id))).toEqual(at('19:05', YESTERDAY));
  });

  it('keys by number, ignores repeated ids and asks nothing for no one', async () => {
    const id = Number(twoEntries.id);
    const found = await timers.lastRanByUser({ workDate: YESTERDAY, userIds: [String(id), id] });
    expect([...found.entries()]).toEqual([[id, at('18:42', YESTERDAY)]]);
    const queries = [];
    const count = (query) => queries.push(query.sql);
    db.on('query', count);
    const none = await timers.lastRanByUser({ workDate: TODAY, userIds: [] });
    db.off('query', count);
    expect(none.size).toBe(0);
    expect(queries).toHaveLength(0);
  });
});
