// Away time counts as a break (CONTRACT 25 A), on the real attendance and timers modules: the
// bug-away scenario (scratch/bug-away) now shows HR the removed lunch as a break, Remove on a
// finished entry, the four timer changes and the time each saves, Keep, no-data gaps, "I had
// left", the races (lockById, the notice decided in the transaction) and the 5-minute cache.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { activity } from '@/modules/activity';
import { attendance } from '@/modules/attendance';
import { timers } from '@/modules/timers';
import { loadAttendance } from '@/app/(app)/attendance/attendanceData';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { addSegment, at, caught, entriesOf, insertEntry, setClock, TODAY } from './timersKit.js';

let hr;
let pm;
let acme;
let beta;
let count = 0;

const OVER = 'attendance.break_over_allowance';
const notices = (user) => db('notifications').where({ userId: user.id, type: OVER });
const breaksOf = (user) => db('attendanceBreaks').where({ userId: user.id }).orderBy('startedAt');
const answer = (user, away, decision) =>
  timers.resolveAway({ user, entryId: away.entryId, from: away.from, to: away.to, decision });

/** A checked-in timer user (09:30) on acme and beta. */
async function person(name = 'Someone') {
  count += 1;
  const user = await createUser({ name: `${name} ${count}` });
  await addMembers(acme, [user]);
  await addMembers(beta, [user]);
  await checkIn(user, TODAY, { in: '09:30' });
  return user;
}

/** Lunch on screen time: active to 13:05, idle (5 min after the last input), locked to 13:45. */
async function lunch(user) {
  await addSegment(user, 'active', '09:35', '13:05');
  await addSegment(user, 'idle', '13:05', '13:10');
  await addSegment(user, 'locked', '13:10', '13:45');
  await addSegment(user, 'active', '13:46', '14:30');
}

const SETTINGS = {
  timers_mode: 'optional',
  timer_away_minutes: 25,
  activity_tracking_enabled: true,
  activity_idle_minutes: 5,
  break_allowance_minutes: 30,
};

const plus30s = (clock) => new Date(at(clock).getTime() + 30_000);

beforeAll(async () => {
  await resetDatabase();
  await setSettings(SETTINGS);
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  acme = await createProject(pm, { name: 'acme-app' });
  beta = await createProject(pm, { name: 'beta' });
});

beforeEach(async () => {
  await setSettings(SETTINGS);
  timers.forgetAway();
  setClock('14:30');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the bug-away scenario turns green', () => {
  let asha;
  let vishal;

  beforeAll(async () => {
    asha = await person('Asha');
    vishal = await person('Vishal');
    for (const user of [asha, vishal]) await insertEntry(user, acme, { from: '09:35' });
    setClock('13:00');
    await attendance.startBreak({ user: asha });
    setClock('13:45');
    await attendance.endBreak({ user: asha });
    await lunch(vishal);
  });

  it('asks Vishal about the lunch, idle start moved back, and Remove saves an away break', async () => {
    setClock('14:30');
    const { away } = await timers.getState({ user: vishal });
    expect(away).toMatchObject({ fromClock: '13:00', toClock: '13:45', minutes: 45, kind: 'away' });
    expect(away).toMatchObject({ running: true, left: null });
    const after = await answer(vishal, away, 'remove');
    expect(after.answer).toMatchObject({ decision: 'remove', minutes: 45, savedAsBreak: true });
    expect(after.removed).toEqual([
      expect.objectContaining({ fromClock: '13:00', toClock: '13:45', projectName: 'acme-app' }),
    ]);
    const [saved] = await breaksOf(vishal);
    expect(saved).toMatchObject({ source: 'away', endReason: 'away', pausedEntryId: null });
    expect(saved.startedAt).toEqual(at('13:00'));
    expect(saved.endedAt).toEqual(at('13:45'));
    // The timer split is the 1.09 one: the head's updated_at is the copy's created_at.
    const [head, copy] = await entriesOf(vishal);
    expect(head).toMatchObject({ stopReason: 'away' });
    expect(head.endedAt).toEqual(at('13:00'));
    expect(copy.startedAt).toEqual(at('13:45'));
    expect(copy.createdAt).toEqual(head.updatedAt);
    expect(saved.awayEntryId).toBe(head.id);
  });

  it('HR sees the same as for a real break: list, page row and Excel', async () => {
    const items = await attendance.listDay(TODAY, { viewer: hr });
    const pick = (user) => items.find((item) => item.user.id === user.id);
    for (const user of [asha, vishal]) {
      expect(pick(user)).toMatchObject({ presentMinutes: 300, breakMinutes: 45 });
      expect(pick(user)).toMatchObject({ workedMinutes: 255, overAllowanceMinutes: 15 });
    }
    const data = await loadAttendance({ user: hr, date: TODAY });
    const row = data.rows.find((item) => item.id === vishal.id);
    expect(row).toMatchObject({ present: '4h 15m', breaks: 'Breaks 45m', over: 'Over 15m' });
    const { sheets } = await attendance.exportDay(TODAY, { viewer: hr });
    const line = sheets[0].rows.find((item) => item.name === vishal.name);
    expect(line).toMatchObject({ breakMinutes: 45, workedHours: 4.25 });
  });

  it('tells Vishal once; a second break later sends no second notice', async () => {
    expect(await notices(vishal)).toHaveLength(1);
    setClock('15:00');
    await attendance.startBreak({ user: vishal });
    setClock('15:10');
    const ended = await attendance.endBreak({ user: vishal });
    expect(ended).toMatchObject({ breakMinutesToday: 55, overAllowanceMinutes: 25 });
    expect(await notices(vishal)).toHaveLength(1);
  });
});

describe('Remove on a finished entry', () => {
  /** acme from 09:35 with the lunch; `finish` ends it, then the question is still asked. */
  async function finished(finish) {
    const user = await person('Finished');
    await insertEntry(user, acme, { from: '09:35' });
    await lunch(user);
    setClock('14:30');
    await finish(user);
    const { away } = await timers.getState({ user });
    expect(away).toMatchObject({ fromClock: '13:00', toClock: '13:45', running: false });
    return { user, away };
  }

  it('after Stop: split, the copy ends at the old end with the old stop reason', async () => {
    const { user, away } = await finished((u) => timers.stop({ user: u }));
    await answer(user, away, 'remove');
    const [head, copy] = await entriesOf(user);
    expect(head.endedAt).toEqual(at('13:00'));
    expect(copy).toMatchObject({ stopReason: 'stopped' });
    expect(copy.endedAt).toEqual(at('14:30'));
    expect(await breaksOf(user)).toHaveLength(1);
  });

  it('after Switch project', async () => {
    const { user, away } = await finished((u) => timers.start({ user: u, projectId: beta.id }));
    await answer(user, away, 'remove');
    const rows = await entriesOf(user);
    expect(rows.map((row) => row.stopReason)).toEqual(['away', null, 'switched']);
  });

  it('after Start break: End break still resumes the timer', async () => {
    const { user, away } = await finished((u) => attendance.startBreak({ user: u }));
    await answer(user, away, 'remove');
    setClock('14:40');
    await attendance.endBreak({ user });
    const state = await timers.getState({ user });
    expect(state.running).toMatchObject({ projectName: 'acme-app', startClock: '14:40' });
  });

  it('after Check out', async () => {
    const { user, away } = await finished((u) => attendance.checkOut({ user: u }));
    const after = await answer(user, away, 'remove');
    expect(after.blocked).toBe('checked_out');
    const [saved] = await breaksOf(user);
    const row = await attendance.getForUserOnDate(user.id, TODAY);
    expect(saved.endedAt <= row.checkOutAt).toBe(true);
  });
});

describe('the four timer changes and the time each saves', () => {
  it('move (no head) saves [startedAt, to]; the entry starts at to', async () => {
    const user = await person('Move');
    await insertEntry(user, acme, { from: '13:00', startedAt: plus30s('13:00') });
    await addSegment(user, 'locked', '13:00', '13:40');
    await addSegment(user, 'active', '13:41', '14:30');
    const { away } = await timers.getState({ user });
    await answer(user, away, 'remove');
    const [entry] = await entriesOf(user);
    expect(entry.startedAt).toEqual(at('13:40'));
    const [saved] = await breaksOf(user);
    expect(saved.startedAt).toEqual(plus30s('13:00'));
    expect(saved.endedAt).toEqual(at('13:40'));
  });

  it('trim (no tail) saves [from, endedAt]; the entry keeps its stop reason', async () => {
    const user = await person('Trim');
    await insertEntry(user, acme, { from: '10:00', to: '13:40', endedAt: plus30s('13:40') });
    await addSegment(user, 'active', '10:00', '13:00');
    await addSegment(user, 'locked', '13:00', '13:40');
    await addSegment(user, 'active', '13:41', '14:30');
    const { away } = await timers.getState({ user });
    await answer(user, away, 'remove');
    const [entry] = await entriesOf(user);
    expect(entry).toMatchObject({ stopReason: 'stopped' });
    expect(entry.endedAt).toEqual(at('13:00'));
    const [saved] = await breaksOf(user);
    expect(saved.endedAt).toEqual(plus30s('13:40'));
    expect(saved.awayEntryId).toBe(entry.id);
  });

  it('drop (nothing left) saves the whole entry and deletes it', async () => {
    const user = await person('Drop');
    await insertEntry(user, acme, { from: '13:00', to: '13:40' });
    await addSegment(user, 'locked', '12:59', '13:40');
    await addSegment(user, 'active', '13:41', '14:30');
    const { away } = await timers.getState({ user });
    const after = await answer(user, away, 'remove');
    expect(await entriesOf(user)).toHaveLength(0);
    const [saved] = await breaksOf(user);
    expect(saved).toMatchObject({ awayEntryId: null, source: 'away' });
    expect(after.removed).toEqual([]); // no entries left today, so nothing is listed
  });

  it('Keep on a finished entry: not asked again', async () => {
    const user = await person('Keep');
    await insertEntry(user, acme, { from: '09:35', to: '14:20' });
    await lunch(user);
    const { away } = await timers.getState({ user });
    const after = await answer(user, away, 'keep');
    expect(after.away).toBeNull();
    expect(after.answer).toMatchObject({ decision: 'keep', savedAsBreak: false });
    expect(await breaksOf(user)).toHaveLength(0);
  });
});

describe('no-data gaps', () => {
  /** Active screen time with a 40-minute hole 13:00 to 13:40 (laptop asleep). */
  async function hole(source = 'system') {
    const user = await person('Hole');
    await insertEntry(user, acme, { from: '09:35' });
    await addSegment(user, 'active', '09:35', '13:00', TODAY, source);
    await addSegment(user, 'active', '13:40', '14:30', TODAY, source);
    return user;
  }

  it('asks only when someone else was seen during it (Idle Detection only)', async () => {
    const user = await hole();
    await db('activitySegments').whereNot({ userId: user.id }).del();
    expect((await timers.getState({ user })).away).toBeNull();
    const other = await createUser({ name: 'Seen Elsewhere' });
    await addSegment(other, 'active', '13:10', '13:15');
    const seen = vi.spyOn(activity, 'anyoneSeenBetween');
    const { away } = await timers.getState({ user });
    expect(away).toMatchObject({ fromClock: '13:00', toClock: '13:40', kind: 'no_data' });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(
      await activity.anyoneSeenBetween({
        workDate: TODAY,
        from: at('13:00'),
        to: at('13:40'),
        exceptUserId: other.id,
      }),
    ).toBe(false);
  });

  it('never for window-only screen time', async () => {
    const user = await hole('window');
    expect((await timers.getState({ user })).away).toBeNull();
  });
});

describe('refusals', () => {
  it('an entry of another day is BAD_REQUEST', async () => {
    const user = await person('Old');
    const id = await insertEntry(user, acme, { from: '10:00', to: '11:00', date: '2026-09-29' });
    const error = await caught(
      timers.resolveAway({
        user,
        entryId: id,
        from: at('10:10').toISOString(),
        to: at('10:50').toISOString(),
        decision: 'remove',
      }),
    );
    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: "Only today's timers can be changed.",
    });
  });

  it('a span over a break HR changed is CONFLICT', async () => {
    const user = await person('Overlap');
    await insertEntry(user, acme, { from: '09:35', to: '12:50', stopReason: 'break' });
    await insertEntry(user, acme, { from: '13:20' });
    await lunch(user);
    const row = await attendance.getForUserOnDate(user.id, TODAY);
    await db('attendanceBreaks').insert({
      userId: user.id,
      attendanceId: row.id,
      workDate: TODAY,
      startedAt: at('12:50'),
      endedAt: at('13:30'),
      endReason: 'hr',
      changedById: hr.id,
      changedAt: at('14:00'),
      createdAt: at('14:00'),
      updatedAt: at('14:00'),
    });
    const { away } = await timers.getState({ user });
    expect(away).toMatchObject({ fromClock: '13:20', toClock: '13:45' });
    const error = await caught(answer(user, away, 'remove'));
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: 'That time overlaps a break. Keep it, or ask HR.',
    });
  });
});

describe('races', () => {
  it('Remove and Check out at once: both finish and the break is inside the row', async () => {
    for (let round = 0; round < 4; round += 1) {
      const user = await person('Racer');
      await insertEntry(user, acme, { from: '09:35' });
      await lunch(user);
      const { away } = await timers.getState({ user });
      const results = await Promise.allSettled([
        answer(user, away, 'remove'),
        attendance.checkOut({ user }),
      ]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      const [saved] = await breaksOf(user);
      const row = await attendance.getForUserOnDate(user.id, TODAY);
      expect(saved.startedAt >= row.checkInAt && saved.endedAt <= row.checkOutAt).toBe(true);
    }
  });

  it('two Removes of one span give one break; the other is CONFLICT', async () => {
    const user = await person('Twice');
    await insertEntry(user, acme, { from: '09:35' });
    await lunch(user);
    const { away } = await timers.getState({ user });
    const results = await Promise.allSettled([
      answer(user, away, 'remove'),
      answer(user, away, 'remove'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.code).toBe('CONFLICT');
    expect(await breaksOf(user)).toHaveLength(1);
  });

  it('a Stop that commits between the read and the lock gives no false CONFLICT', async () => {
    const user = await person('Stopper');
    await insertEntry(user, acme, { from: '09:35' });
    await lunch(user);
    const { away } = await timers.getState({ user });
    const realLock = attendance.lockDay;
    vi.spyOn(attendance, 'lockDay').mockImplementationOnce(async (input, trx) => {
      await timers.stop({ user });
      return realLock(input, trx);
    });
    const after = await answer(user, away, 'remove');
    expect(after.answer.savedAsBreak).toBe(true);
    const rows = await entriesOf(user);
    expect(rows.map((row) => row.stopReason)).toEqual(['away', 'stopped']);
  });

  it('a Remove and an End break that cross the allowance together send one notice', async () => {
    for (let round = 0; round < 4; round += 1) {
      const user = await person('Crossing');
      await insertEntry(user, acme, { from: '09:35', to: '13:00', stopReason: 'stopped' });
      await addSegment(user, 'active', '09:35', '10:00');
      await addSegment(user, 'locked', '10:00', '10:26');
      await addSegment(user, 'active', '10:27', '13:00');
      setClock('13:00');
      await attendance.startBreak({ user });
      setClock('13:20');
      const { away } = await timers.getState({ user });
      expect(away).toMatchObject({ fromClock: '10:00', toClock: '10:26' });
      await Promise.all([answer(user, away, 'remove'), attendance.endBreak({ user })]);
      expect(await notices(user)).toHaveLength(1);
    }
  });

  it('a deadlock retried once sends one notice', async () => {
    const user = await person('Retry');
    await insertEntry(user, acme, { from: '09:35' });
    await lunch(user);
    const { away } = await timers.getState({ user });
    const real = attendance.breakTotalsIn;
    vi.spyOn(attendance, 'breakTotalsIn').mockImplementationOnce(async (input, trx) => {
      await real(input, trx);
      throw Object.assign(new Error('Deadlock found'), { errno: 1213 });
    });
    await answer(user, away, 'remove');
    expect(await breaksOf(user)).toHaveLength(1);
    expect(await notices(user)).toHaveLength(1);
  });
});

describe('I had left', () => {
  /** acme from 09:35, away from 18:42 to 20:52 after the 18:30 day end; now 20:55. */
  async function evening({ checkedOut = false } = {}) {
    const user = await person('Evening');
    await insertEntry(user, acme, { from: '09:35' });
    await addSegment(user, 'active', '09:35', '18:42');
    await addSegment(user, 'locked', '18:42', '20:52');
    await addSegment(user, 'active', '20:53', '20:55');
    setClock('20:55');
    if (checkedOut) await attendance.checkOut({ user });
    return user;
  }

  it('checks an open row out at the span start, with the timer, audited', async () => {
    const user = await evening();
    const { away } = await timers.getState({ user });
    expect(away.left).toEqual({ clock: '18:42', shiftEndClock: '18:30' });
    const after = await timers.resolveAway({ user, ...away, decision: 'left', ip: '10.0.0.9' });
    expect(after.answer).toMatchObject({
      decision: 'left',
      checkedOutAt: at('18:42').toISOString(),
    });
    const row = await attendance.getForUserOnDate(user.id, TODAY);
    expect(row).toMatchObject({ checkoutStatus: 'checked_out', checkOutIp: '10.0.0.9' });
    expect(row.checkOutAt).toEqual(at('18:42'));
    const [entry] = await entriesOf(user);
    expect(entry).toMatchObject({ stopReason: 'checkout' });
    expect(entry.endedAt).toEqual(at('18:42'));
    expect(await breaksOf(user)).toHaveLength(0);
    const logged = await db('auditLogs').where({
      action: 'attendance.away_checkout',
      entityId: row.id,
    });
    expect(logged).toHaveLength(1);
    expect(logged[0].actorId).toBe(user.id);
  });

  it('moves the person’s own later check-out back', async () => {
    const user = await evening({ checkedOut: true });
    const { away, blocked } = await timers.getState({ user });
    expect(blocked).toBe('checked_out');
    expect(away.left).toEqual({ clock: '18:42', shiftEndClock: '18:30' });
    await timers.resolveAway({ user, ...away, decision: 'left' });
    const row = await attendance.getForUserOnDate(user.id, TODAY);
    expect(row.checkOutAt).toEqual(at('18:42'));
  });

  it('is not offered with a later entry or a corrected row, and refused when asked', async () => {
    const later = await person('Later');
    await insertEntry(later, acme, { from: '09:35', to: '20:53' });
    await insertEntry(later, beta, { from: '20:53', to: '20:55' });
    await addSegment(later, 'active', '09:35', '18:42');
    await addSegment(later, 'locked', '18:42', '20:52');
    await addSegment(later, 'active', '20:53', '20:55');
    setClock('20:55');
    const first = await timers.getState({ user: later });
    expect(first.away).toMatchObject({ left: null });
    expect(
      await caught(timers.resolveAway({ user: later, ...first.away, decision: 'left' })),
    ).toMatchObject({ code: 'CONFLICT' });
    const corrected = await evening({ checkedOut: true });
    await db('attendance').where({ userId: corrected.id }).update({ checkoutStatus: 'corrected' });
    timers.forgetAway(corrected.id);
    expect((await timers.getState({ user: corrected })).away).toMatchObject({ left: null });
  });
});

describe('the away part after check-out', () => {
  it('is read at most every 5 minutes', async () => {
    const user = await person('Cached');
    await insertEntry(user, acme, { from: '09:35' });
    await lunch(user);
    await attendance.checkOut({ user });
    const reads = vi.spyOn(activity, 'getDay');
    for (let poll = 0; poll < 3; poll += 1) {
      expect((await timers.getState({ user })).away).toMatchObject({ fromClock: '13:00' });
    }
    expect(reads).toHaveBeenCalledTimes(1);
    setClock('14:36');
    await timers.getState({ user });
    expect(reads).toHaveBeenCalledTimes(2);
  });
});
