// Screen time (CONTRACT section 11): heartbeats become segments, and the reads add them up.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { activity } from '@/modules/activity';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

let vishal;
let simran;
let hr;
let pm;
let untracked;
let leaver;
let admin;
let trackedAdmin;

beforeAll(async () => {
  await resetDatabase();
  vishal = await createUser({ name: 'Vishal Saini' });
  simran = await createUser({ name: 'Simran Kaur' });
  hr = await createUser({ name: 'Neha Gupta', role: 'hr', department: 'HR' });
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  untracked = await createUser({ name: 'Una Tracked', tracksAttendance: false });
  leaver = await createUser({ name: 'Lee Ver', status: 'deactivated' });
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  trackedAdmin = await createUser({ name: 'Tia Admin', role: 'admin' });
});

beforeEach(async () => {
  await db('activitySegments').delete();
  await setSettings({ activity_tracking_enabled: true, timezone: 'Asia/Kolkata' });
});

afterEach(() => setNowForTests(null));

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
  return error;
}

/** Sends a heartbeat at a pinned server time. */
async function beat(user, iso, state = 'active', source = 'system') {
  setNowForTests(iso);
  return activity.recordHeartbeat({ user, state, source });
}

const segmentsOf = (user) =>
  db('activitySegments')
    .where({ userId: user.id })
    .orderBy([{ column: 'startedAt' }, { column: 'id' }])
    .select('id', 'workDate', 'state', 'source', 'startedAt', 'endedAt');

const at = (iso) => new Date(iso);

/** Inserts a finished segment directly (for the read tests). */
function insertSegment(user, workDate, state, from, to, source = 'system') {
  return db('activitySegments').insert({
    userId: user.id,
    workDate,
    state,
    source,
    startedAt: at(from),
    endedAt: at(to),
  });
}

describe('activity.recordHeartbeat', () => {
  it('starts a segment at server time and extends it while reports keep coming', async () => {
    const first = await beat(vishal, '2026-09-30T04:30:00.400Z');
    expect(first).toEqual({ state: 'active', segmentId: expect.any(Number) });
    const second = await beat(vishal, '2026-09-30T04:31:00Z');
    const third = await beat(vishal, '2026-09-30T04:33:30Z'); // exactly 150 s later
    expect(second.segmentId).toBe(first.segmentId);
    expect(third.segmentId).toBe(first.segmentId);
    expect(await segmentsOf(vishal)).toEqual([
      {
        id: first.segmentId,
        workDate: '2026-09-30',
        state: 'active',
        source: 'system',
        startedAt: at('2026-09-30T04:30:00Z'), // whole seconds
        endedAt: at('2026-09-30T04:33:30Z'),
      },
    ]);
  });

  it('starts a new segment after a gap longer than 150 s and never counts the gap', async () => {
    const first = await beat(vishal, '2026-09-30T04:30:00Z');
    const second = await beat(vishal, '2026-09-30T04:32:31Z'); // 151 s later
    expect(second.segmentId).not.toBe(first.segmentId);
    const segments = await segmentsOf(vishal);
    expect(segments.map((s) => [s.startedAt, s.endedAt])).toEqual([
      [at('2026-09-30T04:30:00Z'), at('2026-09-30T04:30:00Z')],
      [at('2026-09-30T04:32:31Z'), at('2026-09-30T04:32:31Z')],
    ]);
    await beat(vishal, '2026-09-30T04:33:31Z');
    const day = await activity.getDay(vishal.id, '2026-09-30');
    expect(day.activeMinutes).toBe(1);
  });

  it('starts a new segment when the state or the source changes', async () => {
    await beat(vishal, '2026-09-30T04:30:00Z', 'active');
    await beat(vishal, '2026-09-30T04:31:00Z', 'active');
    await beat(vishal, '2026-09-30T04:32:30Z', 'idle');
    await beat(vishal, '2026-09-30T04:33:30Z', 'idle');
    await beat(vishal, '2026-09-30T04:34:30Z', 'locked');
    await beat(vishal, '2026-09-30T04:36:00Z', 'locked', 'window');
    expect(
      (await segmentsOf(vishal)).map((s) => [s.state, s.source, s.startedAt, s.endedAt]),
    ).toEqual([
      ['active', 'system', at('2026-09-30T04:30:00Z'), at('2026-09-30T04:31:00Z')],
      ['idle', 'system', at('2026-09-30T04:32:30Z'), at('2026-09-30T04:33:30Z')],
      ['locked', 'system', at('2026-09-30T04:34:30Z'), at('2026-09-30T04:34:30Z')],
      ['locked', 'window', at('2026-09-30T04:36:00Z'), at('2026-09-30T04:36:00Z')],
    ]);
  });

  it('lets active win when two devices disagree within the same minute', async () => {
    // Laptop active, desktop idle (reports 20 s apart): one active segment, no flapping.
    const laptop = await beat(vishal, '2026-09-30T04:30:00Z', 'active');
    const desktop = await beat(vishal, '2026-09-30T04:30:20Z', 'idle');
    expect(desktop).toEqual({ state: 'active', segmentId: laptop.segmentId });
    await beat(vishal, '2026-09-30T04:31:00Z', 'active');
    await beat(vishal, '2026-09-30T04:31:20Z', 'locked');
    await beat(vishal, '2026-09-30T04:32:00Z', 'active');
    expect((await segmentsOf(vishal)).map((s) => [s.state, s.startedAt, s.endedAt])).toEqual([
      ['active', at('2026-09-30T04:30:00Z'), at('2026-09-30T04:32:00Z')],
    ]);

    // Idle first, then active from the other device within the minute: active starts at once.
    const idle = await beat(simran, '2026-09-30T04:30:00Z', 'idle');
    const active = await beat(simran, '2026-09-30T04:30:30Z', 'active');
    expect(active.state).toBe('active');
    expect(active.segmentId).not.toBe(idle.segmentId);

    // A real change on one device shows up once the active reports stop for a minute.
    const later = await beat(vishal, '2026-09-30T04:33:05Z', 'idle');
    expect(later.state).toBe('idle');
    expect((await segmentsOf(vishal)).map((s) => s.state)).toEqual(['active', 'idle']);
  });

  it('splits a segment at company midnight', async () => {
    // 23:59 and 00:00:30 IST (midnight IST is 18:30 UTC)
    await beat(vishal, '2026-09-30T18:29:00Z');
    const after = await beat(vishal, '2026-09-30T18:30:30Z');
    const segments = await segmentsOf(vishal);
    expect(segments.map((s) => [s.workDate, s.startedAt, s.endedAt])).toEqual([
      ['2026-09-30', at('2026-09-30T18:29:00Z'), at('2026-09-30T18:30:00Z')],
      ['2026-10-01', at('2026-09-30T18:30:00Z'), at('2026-09-30T18:30:30Z')],
    ]);
    expect(after.segmentId).toBe(segments[1].id);
    expect((await activity.getDay(vishal.id, '2026-09-30')).activeMinutes).toBe(1);
    expect((await activity.getDay(vishal.id, '2026-10-01')).activeMinutes).toBe(1); // 30 s rounds up
  });

  it('records tracked HR and employees, and refuses PMs, untracked and deactivated people', async () => {
    expect((await beat(hr, '2026-09-30T04:30:00Z')).state).toBe('active');
    for (const user of [pm, untracked, leaver, admin]) {
      await expectAppError(beat(user, '2026-09-30T04:30:00Z'), 'FORBIDDEN');
    }
    await expectAppError(
      activity.recordHeartbeat({ user: null, state: 'active', source: 'system' }),
      'FORBIDDEN',
    );
    expect(
      await db('activitySegments').whereIn('userId', [pm.id, untracked.id]).count({ n: '*' }),
    ).toEqual([{ n: 0 }]);
  });

  it('allows a tracked Admin', async () => {
    expect((await beat(trackedAdmin, '2026-09-30T04:30:00Z')).state).toBe('active');
  });

  it('does nothing when screen time is turned off', async () => {
    await setSettings({ activity_tracking_enabled: false });
    expect(await beat(vishal, '2026-09-30T04:30:00Z')).toEqual({ state: 'off', segmentId: null });
    expect(await segmentsOf(vishal)).toEqual([]);
  });

  it('rejects an unknown state or source', async () => {
    setNowForTests('2026-09-30T04:30:00Z');
    const error = await expectAppError(
      activity.recordHeartbeat({ user: vishal, state: 'asleep', source: 'system' }),
      'VALIDATION_FAILED',
    );
    expect(error.fields).toHaveProperty('state');
    await expectAppError(
      activity.recordHeartbeat({ user: vishal, state: 'idle', source: 'camera' }),
      'VALIDATION_FAILED',
    );
    // The source defaults to the system (Idle Detection).
    await activity.recordHeartbeat({ user: vishal, state: 'idle' });
    expect((await segmentsOf(vishal))[0].source).toBe('system');
  });
});

describe('activity.getDay and getRange', () => {
  beforeEach(async () => {
    // Wed 30 Sep (IST 10:00-12:00 with an idle break, a gap and a lock), Tue 29 Sep, and a day
    // outside the range.
    await insertSegment(
      vishal,
      '2026-09-30',
      'active',
      '2026-09-30T04:30:00Z',
      '2026-09-30T05:30:00Z',
    );
    await insertSegment(
      vishal,
      '2026-09-30',
      'idle',
      '2026-09-30T05:30:00Z',
      '2026-09-30T05:41:00Z',
    );
    await insertSegment(
      vishal,
      '2026-09-30',
      'active',
      '2026-09-30T05:50:00Z',
      '2026-09-30T06:20:30Z',
    );
    await insertSegment(
      vishal,
      '2026-09-30',
      'locked',
      '2026-09-30T06:20:30Z',
      '2026-09-30T06:30:00Z',
      'window',
    );
    await insertSegment(
      vishal,
      '2026-09-29',
      'active',
      '2026-09-29T04:00:00Z',
      '2026-09-29T11:00:00Z',
    );
    await insertSegment(
      vishal,
      '2026-09-29',
      'idle',
      '2026-09-29T11:00:00Z',
      '2026-09-29T11:20:00Z',
    );
    await insertSegment(
      vishal,
      '2026-08-31',
      'active',
      '2026-08-31T04:00:00Z',
      '2026-08-31T05:00:00Z',
    );
    await insertSegment(
      simran,
      '2026-09-30',
      'active',
      '2026-09-30T04:00:00Z',
      '2026-09-30T09:00:00Z',
    );
  });

  it('adds up one day in whole minutes, with the first activity and last report', async () => {
    expect(await activity.getDay(vishal.id, '2026-09-30')).toEqual({
      workDate: '2026-09-30',
      activeMinutes: 91, // 60 + 30.5, rounded
      idleMinutes: 11,
      lockedMinutes: 10, // 9.5, rounded
      firstActiveAt: at('2026-09-30T04:30:00Z'),
      lastActiveAt: at('2026-09-30T06:20:30Z'),
      lastSeenAt: at('2026-09-30T06:30:00Z'),
      source: 'window',
      segments: [
        {
          state: 'active',
          source: 'system',
          startedAt: at('2026-09-30T04:30:00Z'),
          endedAt: at('2026-09-30T05:30:00Z'),
        },
        {
          state: 'idle',
          source: 'system',
          startedAt: at('2026-09-30T05:30:00Z'),
          endedAt: at('2026-09-30T05:41:00Z'),
        },
        {
          state: 'active',
          source: 'system',
          startedAt: at('2026-09-30T05:50:00Z'),
          endedAt: at('2026-09-30T06:20:30Z'),
        },
        {
          state: 'locked',
          source: 'window',
          startedAt: at('2026-09-30T06:20:30Z'),
          endedAt: at('2026-09-30T06:30:00Z'),
        },
      ],
    });
    expect(await activity.getDay(vishal.id, '2026-09-28')).toMatchObject({
      activeMinutes: 0,
      firstActiveAt: null,
      lastSeenAt: null,
      source: null,
      segments: [],
    });
  });

  it('gives the days with data in a range, oldest first, and the totals', async () => {
    expect(await activity.getRange(vishal.id, '2026-09-01', '2026-09-30')).toEqual({
      days: [
        {
          workDate: '2026-09-29',
          activeMinutes: 420,
          idleMinutes: 20,
          lockedMinutes: 0,
          firstActiveAt: at('2026-09-29T04:00:00Z'),
          lastSeenAt: at('2026-09-29T11:20:00Z'),
        },
        {
          workDate: '2026-09-30',
          activeMinutes: 91,
          idleMinutes: 11,
          lockedMinutes: 10,
          firstActiveAt: at('2026-09-30T04:30:00Z'),
          lastSeenAt: at('2026-09-30T06:30:00Z'),
        },
      ],
      totals: { activeMinutes: 511, idleMinutes: 31, lockedMinutes: 10, daysWithData: 2 },
    });
    expect(await activity.getRange(vishal.id, '2026-09-30', '2026-09-01')).toEqual({
      days: [],
      totals: { activeMinutes: 0, idleMinutes: 0, lockedMinutes: 0, daysWithData: 0 },
    });
  });

  it('fills in and checks ranges for the API', async () => {
    setNowForTests('2026-09-30T04:00:00Z');
    expect(await activity.resolveRange({})).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(await activity.resolveRange({ to: '2026-08-15' })).toEqual({
      from: '2026-08-01',
      to: '2026-08-15',
    });
    await expectAppError(activity.resolveRange({ from: '2026-10-02' }), 'VALIDATION_FAILED');
    await expectAppError(
      activity.resolveRange({ from: '2025-01-01', to: '2026-09-30' }),
      'VALIDATION_FAILED',
    );
    expect(await activity.resolveDate()).toBe('2026-09-30');
    const mine = await activity.getMyRange({ user: vishal });
    expect(mine).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      totals: { daysWithData: 2 },
    });
    const theirs = await activity.getUserRange({ userId: simran.id });
    expect(theirs.user).toMatchObject({ id: simran.id, name: 'Simran Kaur', initials: 'SK' });
    expect(theirs.totals).toEqual({
      activeMinutes: 300,
      idleMinutes: 0,
      lockedMinutes: 0,
      daysWithData: 1,
    });
    await expectAppError(activity.getUserRange({ userId: 999999 }), 'NOT_FOUND');
  });
});

describe('activity.getTeamDay', () => {
  it('lists every active tracked person by name with what they are doing now', async () => {
    await beat(vishal, '2026-09-30T04:30:00Z', 'active');
    await beat(vishal, '2026-09-30T04:31:00Z', 'active');
    await beat(simran, '2026-09-30T04:30:30Z', 'locked');
    await beat(hr, '2026-09-30T04:31:00Z', 'idle');

    setNowForTests('2026-09-30T04:32:00Z');
    const team = await activity.getTeamDay('2026-09-30');
    // Neha (HR), Simran, Vishal and the tracked Admin; never the PM, untracked or deactivated
    // people.
    expect(team.map((item) => item.user.name)).toEqual([
      'Neha Gupta',
      'Simran Kaur',
      'Tia Admin',
      'Vishal Saini',
    ]);
    const byName = Object.fromEntries(team.map((item) => [item.user.name, item]));
    expect(byName['Vishal Saini']).toEqual({
      user: {
        id: vishal.id,
        name: 'Vishal Saini',
        email: vishal.email,
        designation: 'Developer',
        departmentName: 'Development',
        role: 'employee',
        status: 'active',
        avatarUrl: null,
        initials: 'VS',
      },
      currentState: 'active',
      lastSeenAt: at('2026-09-30T04:31:00Z'),
      activeMinutes: 1,
      idleMinutes: 0,
      lockedMinutes: 0,
      firstActiveAt: at('2026-09-30T04:30:00Z'),
      lastActiveAt: at('2026-09-30T04:31:00Z'),
      source: 'system',
      segments: [
        {
          state: 'active',
          source: 'system',
          startedAt: at('2026-09-30T04:30:00Z'),
          endedAt: at('2026-09-30T04:31:00Z'),
        },
      ],
    });
    expect(byName['Simran Kaur'].currentState).toBe('locked');
    expect(byName['Neha Gupta'].currentState).toBe('idle');
    expect(byName['Tia Admin']).toMatchObject({
      currentState: 'offline',
      activeMinutes: 0,
      lastSeenAt: null,
      segments: [],
    });
  });

  it('is offline once the last report is older than 150 s, and on any other day', async () => {
    await beat(vishal, '2026-09-30T04:30:00Z', 'active');
    setNowForTests('2026-09-30T04:32:30Z');
    expect(await stateOf('Vishal Saini', '2026-09-30')).toBe('active');
    setNowForTests('2026-09-30T04:32:31Z');
    expect(await stateOf('Vishal Saini', '2026-09-30')).toBe('offline');
    setNowForTests('2026-10-01T04:30:10Z');
    expect(await stateOf('Vishal Saini', '2026-09-30')).toBe('offline');
  });

  async function stateOf(name, date) {
    const team = await activity.getTeamDay(date);
    return team.find((item) => item.user.name === name).currentState;
  }

  it('builds the Excel export from the same numbers', async () => {
    await insertSegment(
      vishal,
      '2026-09-30',
      'active',
      '2026-09-30T04:30:00Z',
      '2026-09-30T06:00:00Z',
    );
    await insertSegment(
      vishal,
      '2026-09-30',
      'idle',
      '2026-09-30T06:00:00Z',
      '2026-09-30T06:15:00Z',
    );
    setNowForTests('2026-09-30T12:00:00Z');
    const workbook = await activity.exportDay('2026-09-30');
    expect(workbook.filename).toBe('screen-time-2026-09-30.xlsx');
    const [summary, segments] = workbook.sheets;
    expect(summary.rows.find((row) => row.name === 'Vishal Saini')).toMatchObject({
      firstActive: '10:00',
      lastActive: '11:30',
      lastSeen: '11:45',
      active: 1.5,
      idle: 0.25,
      locked: 0,
      source: 'Idle detection',
    });
    expect(segments.rows).toEqual([
      {
        name: 'Vishal Saini',
        state: 'Active',
        source: 'Idle detection',
        start: '10:00',
        end: '11:30',
        minutes: 90,
      },
      {
        name: 'Vishal Saini',
        state: 'Idle',
        source: 'Idle detection',
        start: '11:30',
        end: '11:45',
        minutes: 15,
      },
    ]);
  });
});

describe('activity.deleteOlderThan', () => {
  it('deletes segments of work dates before the given date only', async () => {
    await insertSegment(
      vishal,
      '2025-09-29',
      'active',
      '2025-09-29T04:00:00Z',
      '2025-09-29T05:00:00Z',
    );
    await insertSegment(
      vishal,
      '2025-09-30',
      'idle',
      '2025-09-30T04:00:00Z',
      '2025-09-30T05:00:00Z',
    );
    await insertSegment(
      simran,
      '2025-09-30',
      'active',
      '2025-09-30T04:00:00Z',
      '2025-09-30T05:00:00Z',
    );
    await insertSegment(
      vishal,
      '2025-10-01',
      'active',
      '2025-10-01T04:00:00Z',
      '2025-10-01T05:00:00Z',
    );
    expect(await activity.deleteOlderThan('2025-10-01')).toBe(3);
    expect(await db('activitySegments').select('workDate')).toEqual([{ workDate: '2025-10-01' }]);
    expect(await activity.deleteOlderThan('2025-10-01')).toBe(0);
  });
});
