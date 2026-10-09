// Timers and breaks at the same moment (CONTRACT 15), on the real modules: a timer start, a break
// start or end and a check-out sent together by the same person must never deadlock (a 500) and
// must leave a consistent day: never a timer and a break open together, nothing open after
// check-out. Locks are taken attendance row, then break, then timer everywhere.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { timers } from '@/modules/timers';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { setClock, TODAY } from './timersKit.js';

// Answers a race may give: the other request got in first.
const EXPECTED = new Set(['CONFLICT', 'ALREADY_ON_BREAK', 'NOT_ON_BREAK', 'ALREADY_CHECKED_OUT']);
const ROUNDS = 12;

let pm;
let acme;
let beta;
let count = 0;

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
  beta = await createProject(pm, { name: 'beta' });
});

/** What is wrong with the person's day after a race, or null. */
async function inconsistency(user) {
  const running = await db('timeEntries').where({ userId: user.id }).whereNull('endedAt');
  const open = await db('attendanceBreaks').where({ userId: user.id }).whereNull('endedAt');
  const row = await db('attendance').where({ userId: user.id, workDate: TODAY }).first();
  if (running.length > 0 && open.length > 0) return 'a timer and a break are both open';
  if (row.checkOutAt && (running.length > 0 || open.length > 0)) return 'open after check-out';
  return null;
}

/**
 * Runs `calls` at once for a fresh checked-in person, ROUNDS times.
 * @returns {Promise<string[]>} unexpected failures and inconsistent days
 */
async function race(setup, calls) {
  const problems = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    count += 1;
    const user = await createUser({ name: `Racer ${count}` });
    await addMembers(acme, [user]);
    await checkIn(user, TODAY, { in: '09:00' });
    setClock('09:30');
    await setup(user);
    setClock('10:00');
    for (const result of await Promise.allSettled(calls(user))) {
      if (result.status === 'rejected' && !EXPECTED.has(result.reason?.code)) {
        problems.push(`${result.reason?.code ?? result.reason?.errno}: ${result.reason?.message}`);
      }
    }
    const wrong = await inconsistency(user);
    if (wrong) problems.push(wrong);
  }
  return problems;
}

const idle = async () => {};
const timing = (user) => timers.start({ user, projectId: acme.id });
const resting = async (user) => {
  await timers.start({ user, projectId: acme.id });
  await attendance.startBreak({ user });
};

describe('requests at the same moment', () => {
  it('timer start and break start', async () => {
    const calls = (user) => [
      timers.start({ user, projectId: beta.id }),
      attendance.startBreak({ user }),
    ];
    expect(await race(idle, calls)).toEqual([]);
    expect(await race(timing, calls)).toEqual([]);
  });

  it('timer start and check-out', async () => {
    const calls = (user) => [
      timers.start({ user, projectId: beta.id }),
      attendance.checkOut({ user, ip: null }),
    ];
    expect(await race(idle, calls)).toEqual([]);
    expect(await race(timing, calls)).toEqual([]);
  });

  it('break end and check-out, timer start or break start', async () => {
    const end = (user) => attendance.endBreak({ user });
    expect(
      await race(resting, (user) => [end(user), attendance.checkOut({ user, ip: null })]),
    ).toEqual([]);
    expect(
      await race(resting, (user) => [end(user), timers.start({ user, projectId: beta.id })]),
    ).toEqual([]);
    expect(await race(resting, (user) => [end(user), attendance.startBreak({ user })])).toEqual([]);
  });

  it('break start and check-out or timer stop', async () => {
    const pause = (user) => attendance.startBreak({ user });
    expect(
      await race(timing, (user) => [pause(user), attendance.checkOut({ user, ip: null })]),
    ).toEqual([]);
    expect(await race(timing, (user) => [pause(user), timers.stop({ user })])).toEqual([]);
  });
});
