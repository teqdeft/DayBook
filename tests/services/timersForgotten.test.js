// A timer still running from an earlier day when the person works again (CONTRACT 15): the
// midnight job didn't close it (worker down). Start, stop, a break and check-out close it by the
// midnight rule first (check-out, else last active screen time, else its start), so it never
// counts as today's timer or runs on into the evening.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { timers } from '@/modules/timers';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { addSegment, at, entriesOf, insertEntry, setClock, TODAY, YESTERDAY } from './timersKit.js';

vi.mock('@/modules/reports', () => ({
  reports: {
    getDayStatus: vi.fn(async () => ({ reportId: null, status: 'none', totalMinutes: 0 })),
  },
}));

let pm;
let acme;
let count = 0;

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
});

beforeEach(async () => {
  await setSettings({ timers_mode: 'optional', activity_tracking_enabled: true });
});

/**
 * Someone who checked in yesterday (out at `out`, or never) and left a timer on acme running from
 * 17:00, with screen time active 17:00-19:30 then locked to 23:50; checked in today at 9:00.
 */
async function forgot({ out = null } = {}) {
  count += 1;
  const user = await createUser({ name: `Forgot ${count}` });
  await addMembers(acme, [user]);
  await checkIn(user, YESTERDAY, {
    in: '09:00',
    out,
    checkoutStatus: out ? 'checked_out' : 'missing',
  });
  const id = await insertEntry(user, acme, { date: YESTERDAY, from: '17:00' });
  await addSegment(user, 'active', '17:00', '19:30', YESTERDAY);
  await addSegment(user, 'locked', '19:30', '23:50', YESTERDAY);
  await checkIn(user, TODAY, { in: '09:00' });
  setClock('10:00');
  return { user, id };
}

const rowOf = (id) => db('timeEntries').where({ id }).first();
const midnightNotes = (user) =>
  db('notifications').where({ userId: user.id, type: 'timer.stopped_midnight' });

describe('a timer left running from yesterday', () => {
  it('Start on the same work closes it and starts a new timer today', async () => {
    const { user, id } = await forgot({ out: '18:00' });
    const state = await timers.start({ user, projectId: acme.id });

    expect(await rowOf(id)).toMatchObject({
      endedAt: at('18:00', YESTERDAY),
      stopReason: 'midnight',
    });
    expect(state.running).toMatchObject({ startClock: '10:00', projectId: acme.id });
    expect(state.running.id).not.toBe(id);
    expect(state.entries).toHaveLength(1);
    const [note] = await midnightNotes(user);
    expect(note).toMatchObject({
      title: 'Your timer on acme-app was still running',
      body: 'We stopped it at 6:00 PM, when you checked out. Check your report before it locks.',
      link: `/report?date=${YESTERDAY}`,
    });
  });

  it('Stop ends it at the last active screen time, not at midnight', async () => {
    const { user, id } = await forgot();
    const state = await timers.stop({ user });

    expect(await rowOf(id)).toMatchObject({
      endedAt: at('19:30', YESTERDAY),
      stopReason: 'midnight',
    });
    expect(state.running).toBeNull();
    expect(await midnightNotes(user)).toHaveLength(1);
  });

  it('a break today closes it and pauses nothing', async () => {
    const { user, id } = await forgot();
    const result = await attendance.startBreak({ user });

    expect(result.pausedEntryId).toBeNull();
    expect(await rowOf(id)).toMatchObject({
      endedAt: at('19:30', YESTERDAY),
      stopReason: 'midnight',
    });
    setClock('10:30');
    await attendance.endBreak({ user });
    expect(await entriesOf(user)).toHaveLength(1); // nothing resumed
  });

  it('check-out today closes it by the midnight rule', async () => {
    const { user, id } = await forgot({ out: '18:00' });
    setClock('18:30');
    await attendance.checkOut({ user, ip: null });

    expect(await rowOf(id)).toMatchObject({
      endedAt: at('18:00', YESTERDAY),
      stopReason: 'midnight',
    });
  });

  it('is never asked about as away time today', async () => {
    const { user } = await forgot();
    await addSegment(user, 'idle', '09:00', '09:40');
    await addSegment(user, 'active', '09:41', '10:00');
    expect((await timers.getState({ user })).away).toBeNull();
  });
});
