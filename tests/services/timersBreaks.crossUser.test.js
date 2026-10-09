// Timers and breaks of different people at the same moment (CONTRACT 15). Each person's writes are
// ordered by their own attendance row lock; different people must never wait for each other, and a
// deadlock between them must never reach the person (a 500, or a false "Another timer just
// started"). Covers people with no rows yet (launch day, new hires) and people with earlier rows.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { transaction as attendanceTransaction } from '@/modules/attendance/repo';
import { timers } from '@/modules/timers';
import { transaction as timerTransaction } from '@/modules/timers/repo';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { caught, insertEntry, setClock, TODAY } from './timersKit.js';

const ROUNDS = 8;
const PEOPLE = 4;

let pm;
let acme;
let count = 0;
/** Everyone the latest race used. */
let racers = [];

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
});

/** PEOPLE fresh checked-in people, each set up with `setup`. */
async function crowd(setup) {
  const people = [];
  for (let index = 0; index < PEOPLE; index += 1) {
    count += 1;
    const user = await createUser({ name: `Person ${count}` });
    await addMembers(acme, [user]);
    const rowId = await checkIn(user, TODAY, { in: '09:00' });
    await setup(user, rowId);
    people.push(user);
  }
  return people;
}

/**
 * Runs one call per person at once, ROUNDS times with fresh people.
 * @returns {Promise<string[]>} every failure (none is expected: the people are different)
 */
async function race(setup, call) {
  const failures = [];
  racers = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    setClock('08:00');
    const people = await crowd(setup);
    racers.push(...people);
    setClock('13:00');
    const results = await Promise.allSettled(people.map((user) => call(user)));
    for (const result of results) {
      if (result.status === 'rejected') {
        const { code, errno, message } = result.reason ?? {};
        failures.push(`${code ?? errno}: ${message}`);
      }
    }
  }
  return failures;
}

const nothing = async () => {};

/** An earlier finished entry and an earlier finished break, as on a normal afternoon. */
async function morning(user, rowId) {
  await insertEntry(user, acme, { from: '09:05', to: '11:00' });
  await db('attendanceBreaks').insert({
    userId: user.id,
    attendanceId: rowId,
    workDate: TODAY,
    startedAt: new Date('2026-09-30T05:45:00Z'),
    endedAt: new Date('2026-09-30T06:15:00Z'),
    endReason: 'self',
  });
}

const startTimer = (user) => timers.start({ user, projectId: acme.id });
const startBreak = (user) => attendance.startBreak({ user });

describe('different people at the same moment', () => {
  it('first-ever timers start for everyone', async () => {
    expect(await race(nothing, startTimer)).toEqual([]);
    const running = await db('timeEntries').whereNull('endedAt').count({ total: '*' }).first();
    expect(running.total).toBe(ROUNDS * PEOPLE);
  });

  it('breaks start for everyone, with or without earlier breaks', async () => {
    expect(await race(nothing, startBreak)).toEqual([]);
    expect(await race(morning, startBreak)).toEqual([]);
    expect(
      await race(morning, async (user) => (await startTimer(user)) && startBreak(user)),
    ).toEqual([]);
  });

  it('a mix of starts, breaks, check-outs and added time', async () => {
    let turn = 0;
    const mixed = (user) => {
      turn += 1;
      if (turn % 4 === 0) return attendance.checkOut({ user, ip: null });
      if (turn % 4 === 1) return startBreak(user);
      if (turn % 4 === 2) return startTimer(user);
      return timers.addEntry({
        user,
        input: { projectId: acme.id, startClock: '12:00', endClock: '12:30' },
      });
    };
    expect(await race(nothing, mixed)).toEqual([]);
    expect(await race(morning, mixed)).toEqual([]);
  });

  it('breaks end and timers resume for everyone', async () => {
    const resting = async (user, rowId) => {
      await morning(user, rowId);
      setClock('12:00');
      await startTimer(user);
      setClock('12:30');
      await startBreak(user);
    };
    expect(await race(resting, (user) => attendance.endBreak({ user }))).toEqual([]);
    const ids = racers.map((user) => user.id);
    const open = await db('attendanceBreaks').whereIn('userId', ids).whereNull('endedAt');
    const running = await db('timeEntries').whereIn('userId', ids).whereNull('endedAt');
    expect(open).toEqual([]);
    expect(running).toHaveLength(ROUNDS * PEOPLE);
  });
});

describe('the transaction helpers', () => {
  it('try a deadlocked transaction again, and give up with CONFLICT on the third', async () => {
    for (const transaction of [timerTransaction, attendanceTransaction]) {
      let calls = 0;
      const result = await transaction(async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error('Deadlock found'), { errno: 1213 });
        return 'done';
      });
      expect([result, calls]).toEqual(['done', 3]);
      const error = await caught(
        transaction(async () => {
          throw Object.assign(new Error('Deadlock found'), { errno: 1213 });
        }),
      );
      expect(error).toMatchObject({
        code: 'CONFLICT',
        message: 'Something else changed at the same moment. Try again.',
      });
      const other = await caught(
        transaction(async () => {
          throw Object.assign(new Error('Duplicate'), { errno: 1062 });
        }),
      );
      expect(other.errno).toBe(1062);
    }
  });

  it('run at READ COMMITTED', async () => {
    for (const transaction of [timerTransaction, attendanceTransaction]) {
      const level = await transaction(async (trx) => {
        await trx('settings').first('key').forUpdate();
        const [rows] = await trx.raw(
          'SELECT trx_isolation_level AS level FROM information_schema.innodb_trx ' +
            'WHERE trx_mysql_thread_id = CONNECTION_ID()',
        );
        return rows[0]?.level;
      });
      expect(level).toBe('READ COMMITTED');
    }
  });
});
