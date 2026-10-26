// Auto check-out (CONTRACT 19), who counts as working and when the others are checked out: people
// who leave soon after office end are checked out when they left (working late = seen working
// after office end and in the hour before the check), the check-out time takes timers and breaks
// into account, window-mode idle can be work elsewhere, nothing happens while screen time is off,
// and the check happens when each row is locked. The basic check and the job are in
// attendance.autoCheckout.test.js.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { activity } from '@/modules/activity';
import { attendance } from '@/modules/attendance';
import { timers } from '@/modules/timers';
import { forgetHandledKeysForTests } from '@/worker/runOnce';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { checkIn, createProject } from './dashboardKit.js';
import { addSegment, at, entriesOf, insertEntry, setClock, TODAY } from './timersKit.js';

let acme;

beforeAll(async () => {
  await resetDatabase();
  const pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
});

beforeEach(async () => {
  forgetHandledKeysForTests();
  for (const table of ['jobRuns', 'notifications', 'timeEntries', 'activitySegments']) {
    await db(table).del();
  }
  await db('auditLogs').where({ action: 'attendance.auto_checkout' }).del();
  await db('attendanceBreaks').del();
  await db('attendance').del();
  await setSettings({
    auto_checkout_enabled: true,
    auto_checkout_at: '20:00',
    office_end: '18:30',
    timers_mode: 'optional',
    activity_tracking_enabled: true,
  });
  setClock('20:00');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A new employee checked in today at 09:30. */
async function person(name) {
  const user = await createUser({ name });
  await checkIn(user, TODAY, { in: '09:30' });
  return user;
}

const rowOf = (user) => db('attendance').where({ userId: user.id, workDate: TODAY }).first();

/** A break of today straight into the database; `to` null means still on it. */
async function addBreak(user, from, to = null) {
  await db('attendanceBreaks').insert({
    userId: user.id,
    attendanceId: (await rowOf(user)).id,
    workDate: TODAY,
    startedAt: at(from),
    endedAt: to ? at(to) : null,
    endReason: to ? 'self' : null,
  });
}

/** Expects each [user, 'HH:mm'] to be checked out automatically at that time. */
async function expectAutoAt(pairs) {
  for (const [user, out] of pairs) {
    expect(await rowOf(user), user.name).toMatchObject({
      checkoutStatus: 'auto',
      checkOutAt: at(out),
    });
  }
}

describe('people who leave soon after office end', () => {
  it('are checked out when they left; working late means seen in the hour before', async () => {
    const leaver = await person('Lee Leaver');
    await addSegment(leaver, 'active', '09:30', '18:35');
    await addSegment(leaver, 'locked', '18:35', '20:00');
    const stopper = await person('Stu Stopper'); // stops the timer on the way out
    await addSegment(stopper, 'active', '09:30', '18:29');
    await insertEntry(stopper, acme, { from: '09:30', to: '18:31' });
    const reader = await person('Rita Reader'); // wakes the screen to read the 6:30 reminder
    await addSegment(reader, 'locked', '18:20', '18:30');
    await addSegment(reader, 'active', '18:30', '18:31');
    await addSegment(reader, 'locked', '18:31', '20:00');
    const edge = await person('Hal Hour'); // last seen exactly an hour before the check
    await addSegment(edge, 'active', '18:00', '19:00');
    const dinner = await person('Lena Late'); // working late, at dinner since 19:25
    await addSegment(dinner, 'active', '09:30', '19:25');
    await addSegment(dinner, 'locked', '19:25', '20:00');

    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 4, kept: 1 });

    await expectAutoAt([
      [leaver, '18:35'],
      [stopper, '18:31'],
      [reader, '18:31'],
      [edge, '19:00'],
    ]);
    expect((await rowOf(dinner)).checkoutStatus).toBe('open');
    const note = await db('notifications')
      .where({ type: 'attendance.auto_checkout', userId: leaver.id })
      .first();
    expect(note).toMatchObject({
      title: 'You were checked out at 6:35 PM',
      body:
        'There was no activity on your computer after 6:35 PM. ' +
        'If you were working, request a correction.',
    });
    const log = await db('auditLogs')
      .where({ action: 'attendance.auto_checkout', entityId: (await rowOf(leaver)).id })
      .first();
    expect(log.reason).toBe('No activity after 6:35 PM');
  });

  it('a late run looks at the hour before it runs', async () => {
    setClock('23:00');
    const late = await person('Wil Working');
    await addSegment(late, 'active', '18:00', '22:10');
    await addSegment(late, 'locked', '22:10', '23:00');
    const gone = await person('Ola Gone');
    await addSegment(gone, 'active', '09:30', '21:30');
    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 1, kept: 1 });
    expect((await rowOf(late)).checkoutStatus).toBe('open');
    await expectAutoAt([[gone, '21:30']]);
  });
});

describe('the check-out time', () => {
  it('is the latest of screen time, timers and breaks', async () => {
    const timed = await person('Amy Afternoon'); // screen time stopped at noon, timers went on
    await addSegment(timed, 'active', '09:30', '12:00');
    await insertEntry(timed, acme, { from: '13:00', to: '15:30' });
    await insertEntry(timed, acme, { from: '15:30', to: '18:00' });
    const rested = await person('Ben Break');
    await addSegment(rested, 'active', '09:30', '16:00');
    await addBreak(rested, '16:00', '17:10');
    const onBreak = await person('Cara Coffee'); // started a break, then left
    await addSegment(onBreak, 'active', '09:30', '17:00');
    await addBreak(onBreak, '17:20');

    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 3, kept: 0 });

    await expectAutoAt([
      [timed, '18:00'],
      [rested, '17:10'],
      [onBreak, '17:20'],
    ]);
    expect((await entriesOf(timed)).at(-1).endedAt).toEqual(at('18:00'));
    const [ended] = await db('attendanceBreaks').where({ userId: onBreak.id });
    expect(ended).toMatchObject({ endedAt: at('17:20'), endReason: 'checkout' });
  });
});

describe('window-mode screen time (no Idle Detection)', () => {
  it('idle in the Daybook window may be work in another app; Idle Detection idle is not', async () => {
    const coding = await person('Vik VSCode');
    await addSegment(coding, 'active', '09:30', '18:10', TODAY, 'window');
    await addSegment(coding, 'idle', '18:10', '20:00', TODAY, 'window');
    const closed = await person('Wyn Window'); // Daybook open until 18:50, then nothing
    await addSegment(closed, 'active', '09:30', '18:10', TODAY, 'window');
    await addSegment(closed, 'idle', '18:10', '18:50', TODAY, 'window');
    const system = await person('Sia System');
    await addSegment(system, 'active', '09:30', '18:10');
    await addSegment(system, 'idle', '18:10', '20:00');

    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 2, kept: 1 });

    expect((await rowOf(coding)).checkoutStatus).toBe('open');
    await expectAutoAt([
      [closed, '18:50'],
      [system, '18:10'],
    ]);
  });
});

describe('screen time off', () => {
  it('checks nobody out: nothing tells idle from working', async () => {
    const late = await person('Wanda Working');
    const stale = await person('Fiona Fullday');
    await addSegment(stale, 'active', '09:30', '12:00'); // then Admin turned screen time off
    await setSettings({ activity_tracking_enabled: false });

    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 0, kept: 0 });

    for (const user of [late, stale]) {
      expect(await rowOf(user), user.name).toMatchObject({
        checkoutStatus: 'open',
        checkOutAt: null,
      });
    }
    expect(await db('notifications').where({ type: 'attendance.auto_checkout' })).toHaveLength(0);
  });
});

describe('the moment of the check', () => {
  it('counts a heartbeat or timer start that came in while the job worked on others', async () => {
    const first = await person('Abe First');
    const back = await person('Bea Back');
    await addSegment(back, 'active', '09:30', '18:00');
    await addSegment(back, 'locked', '18:00', '20:00');
    const realGetDay = activity.getDay;
    let fired = false;
    vi.spyOn(activity, 'getDay').mockImplementation(async (userId, date) => {
      if (userId === first.id && !fired) {
        fired = true; // while the job checks Abe, Bea comes back and starts a timer
        setClock('20:00:05');
        await activity.recordHeartbeat({ user: back, state: 'active', source: 'system' });
        await timers.start({ user: back, projectId: acme.id });
      }
      return realGetDay(userId, date);
    });

    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 1, kept: 1 });

    await expectAutoAt([[first, '18:30']]);
    expect((await rowOf(back)).checkoutStatus).toBe('open');
    expect((await entriesOf(back))[0]).toMatchObject({ endedAt: null, stopReason: null });
  });
});
