// Project timers (CONTRACT 15): start, stop, switch and double click; who may use them and when;
// the one-running-timer guard; the state's shapes; stopRunning and resumeAfterBreak for breaks.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { timers } from '@/modules/timers';
import * as repo from '@/modules/timers/repo';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import {
  addTask,
  at,
  breakRow,
  caught,
  entriesOf,
  insertEntry,
  setClock,
  TODAY,
  YESTERDAY,
} from './timersKit.js';

// The reports module belongs to another owner; attendance and projects import it.
vi.mock('@/modules/reports', () => ({ reports: {} }));

let pm;
let emp; // checked in at 9:30, still in
let hr; // checked in, HR can time too
let notIn; // no check-in today
let left; // checked in and out
let untracked;
let gone;
let admin;
let acme;
let beta;
let done; // completed project
let held; // on-hold project
let taskP1; // acme, for anyone
let taskDone; // acme, done
let taskOther; // acme, for hr only
let taskBeta; // beta, for anyone

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  emp = await createUser({ name: 'Emma Dev' });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  notIn = await createUser({ name: 'Nia NotIn' });
  left = await createUser({ name: 'Leo Left' });
  untracked = await createUser({ name: 'Uma Untracked', tracksAttendance: false });
  gone = await createUser({ name: 'Gus Gone', status: 'deactivated' });
  acme = await createProject(pm, { name: 'acme-app', color: 'violet', isUrgent: true });
  beta = await createProject(pm, { name: 'beta' });
  done = await createProject(pm, { name: 'old-site', status: 'completed' });
  held = await createProject(pm, { name: 'paused', status: 'on_hold' });
  await addMembers(acme, [emp, hr, left]);
  await addMembers(beta, [emp, hr]);
  taskP1 = await addTask(acme, pm, { title: 'Fix login timeout' });
  taskDone = await addTask(acme, pm, { title: 'Old task', status: 'done' });
  taskOther = await addTask(acme, pm, { title: 'For HR', assigneeId: hr.id });
  taskBeta = await addTask(beta, pm, { title: 'Beta task', priority: 'p2' });
  for (const user of [emp, hr, untracked, gone]) await checkIn(user, TODAY, { in: '09:30' });
  await checkIn(left, TODAY, { in: '09:30', out: '10:00' });
});

beforeEach(async () => {
  setClock('10:30');
  await setSettings({ timers_mode: 'optional', activity_tracking_enabled: true });
  await db('timeEntries').del();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('start and stop', () => {
  it('starts a timer and returns the state', async () => {
    const state = await timers.start({ user: emp, projectId: acme.id, note: '  Fix login  ' });
    expect(state).toMatchObject({ mode: 'optional', canUse: true, blocked: null, away: null });
    expect(state.running).toMatchObject({
      projectId: acme.id,
      projectName: 'acme-app',
      projectColor: 'violet',
      isUrgent: true,
      projectTaskId: null,
      note: 'Fix login',
      startedAt: at('10:30').toISOString(),
      endedAt: null,
      minutes: 0,
      source: 'timer',
      stopReason: null,
      startClock: '10:30',
      endClock: null,
    });
    expect(state.entries).toHaveLength(1);
    expect(state.serverNow).toBe(at('10:30').toISOString());
  });

  it('stops the running timer, and stopping again only returns the state', async () => {
    await timers.start({ user: emp, projectId: acme.id });
    setClock('11:15');
    const state = await timers.stop({ user: emp });
    expect(state.running).toBeNull();
    expect(state.entries[0]).toMatchObject({
      endClock: '11:15',
      stopReason: 'stopped',
      minutes: 45,
    });
    expect(state.totalMinutes).toBe(45);
    const again = await timers.stop({ user: emp });
    expect(again.entries).toHaveLength(1);
  });

  it('switching projects stops the first timer at the same moment', async () => {
    await timers.start({ user: emp, projectId: acme.id });
    setClock('11:00');
    const state = await timers.start({ user: emp, projectId: beta.id, note: 'Review' });
    expect(
      state.entries.map((e) => [e.projectName, e.startClock, e.endClock, e.stopReason]),
    ).toEqual([
      ['acme-app', '10:30', '11:00', 'switched'],
      ['beta', '11:00', null, null],
    ]);
    expect(state.running.projectName).toBe('beta');
    setClock('11:20');
    const later = await timers.getState({ user: emp });
    expect(later.byProject).toEqual([
      { projectId: acme.id, projectName: 'acme-app', projectColor: 'violet', minutes: 30 },
      { projectId: beta.id, projectName: 'beta', projectColor: 'blue', minutes: 20 },
    ]);
    expect(later.totalMinutes).toBe(50);
  });

  it('a double click on Start leaves the running timer as it is', async () => {
    const first = await timers.start({ user: emp, projectId: acme.id, projectTaskId: taskP1 });
    setClock('10:31');
    const second = await timers.start({ user: emp, projectId: acme.id, projectTaskId: taskP1 });
    expect(second.running.id).toBe(first.running.id);
    expect(second.entries).toHaveLength(1);
    // A different note is other work: the timer switches.
    const third = await timers.start({
      user: emp,
      projectId: acme.id,
      projectTaskId: taskP1,
      note: 'Tests',
    });
    expect(third.entries).toHaveLength(2);
    expect(third.running).toMatchObject({ note: 'Tests', startClock: '10:31' });
  });

  it('links an open priority task of the project for the person', async () => {
    const state = await timers.start({ user: emp, projectId: acme.id, projectTaskId: taskP1 });
    expect(state.running).toMatchObject({
      projectTaskId: taskP1,
      priority: 'p1',
      projectTaskTitle: 'Fix login timeout',
    });
    for (const projectTaskId of [taskDone, taskOther, taskBeta, 999999]) {
      const error = await caught(timers.start({ user: emp, projectId: acme.id, projectTaskId }));
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(error.fields)).toEqual(['projectTaskId']);
    }
    // HR is the assignee of taskOther.
    const hrState = await timers.start({ user: hr, projectId: acme.id, projectTaskId: taskOther });
    expect(hrState.running.projectTaskTitle).toBe('For HR');
  });

  it('starting on a break ends the break without resuming its timer', async () => {
    const end = vi.spyOn(attendance, 'endOpenBreak');
    await timers.start({ user: emp, projectId: acme.id });
    expect(end).toHaveBeenCalledTimes(1);
    const [input, trx] = end.mock.calls[0];
    expect(input).toEqual({ userId: emp.id, at: at('10:30'), reason: 'timer' });
    expect(trx).toBeTruthy();
  });
});

describe('when timers can be started', () => {
  it('needs timers on, an open check-in today and an active project', async () => {
    await setSettings({ timers_mode: 'off' });
    expect((await caught(timers.start({ user: emp, projectId: acme.id }))).code).toBe('TIMERS_OFF');
    await setSettings({ timers_mode: 'required' });
    expect((await caught(timers.start({ user: notIn, projectId: acme.id }))).code).toBe(
      'NOT_CHECKED_IN',
    );
    expect((await caught(timers.start({ user: left, projectId: acme.id }))).code).toBe(
      'ALREADY_CHECKED_OUT',
    );
    for (const projectId of [done.id, held.id, 999999]) {
      const error = await caught(timers.start({ user: emp, projectId }));
      expect(error.code).toBe('PROJECT_NOT_ACTIVE');
      expect(error.message).toBe('Only active projects can be timed.');
    }
    expect(await entriesOf(emp)).toHaveLength(0);
  });

  it('is only for people who check in and write reports', async () => {
    for (const user of [pm, admin, untracked, gone]) {
      expect((await caught(timers.start({ user, projectId: acme.id }))).code).toBe('FORBIDDEN');
      expect((await caught(timers.stop({ user }))).code).toBe('FORBIDDEN');
    }
    expect(await db('timeEntries').count({ count: '*' }).first()).toEqual({ count: 0 });
  });

  it('validates the input', async () => {
    const error = await caught(
      timers.start({ user: emp, projectId: 'abc', note: 'x'.repeat(201) }),
    );
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(error.fields).sort()).toEqual(['note', 'projectId']);
  });

  it('a timer can be stopped even when timers were turned off', async () => {
    await timers.start({ user: emp, projectId: acme.id });
    await setSettings({ timers_mode: 'off' });
    const state = await timers.stop({ user: emp });
    // While off the state lists no entries (timersOff.test.js); the row says it stopped.
    expect(state).toMatchObject({ blocked: 'off', running: null, entries: [] });
    expect((await entriesOf(emp))[0].stopReason).toBe('stopped');
  });
});

describe('one running timer per person', () => {
  it('the database refuses a second running timer with CONFLICT', async () => {
    await insertEntry(emp, acme, { from: '10:00' });
    const error = await caught(
      db.transaction((trx) =>
        repo.insertEntry(
          {
            userId: emp.id,
            workDate: TODAY,
            projectId: beta.id,
            startedAt: at('10:30'),
            source: 'timer',
          },
          trx,
        ),
      ),
    );
    expect(error).toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'Another timer just started. Refresh to see it.',
    });
    // Finished entries never collide.
    await insertEntry(emp, beta, { from: '09:30', to: '09:45' });
    await insertEntry(emp, beta, { from: '09:45', to: '09:50' });
    expect(await entriesOf(emp)).toHaveLength(3);
  });

  it('two starts at once leave exactly one running timer', async () => {
    const results = await Promise.allSettled([
      timers.start({ user: emp, projectId: acme.id }),
      timers.start({ user: emp, projectId: beta.id }),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason.code).toBe('CONFLICT');
    }
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    const running = (await entriesOf(emp)).filter((row) => row.endedAt === null);
    expect(running).toHaveLength(1);
  });
});

describe('getState', () => {
  it('says why the person is blocked, and never throws', async () => {
    await insertEntry(left, acme, { from: '09:35', to: '09:50', note: 'Standup' });
    const off = async (user) => (await timers.getState({ user })).blocked;
    expect(await off(emp)).toBeNull();
    expect(await off(notIn)).toBe('not_checked_in');
    expect(await off(pm)).toBe('not_allowed');
    expect(await off(untracked)).toBe('not_allowed');
    const leftState = await timers.getState({ user: left });
    expect(leftState).toMatchObject({ blocked: 'checked_out', running: null, totalMinutes: 15 });
    expect(leftState.entries[0]).toMatchObject({ note: 'Standup', startClock: '09:35' });
    const pmState = await timers.getState({ user: pm });
    expect(pmState).toMatchObject({ canUse: false, entries: [], byProject: [], away: null });
    await setSettings({ timers_mode: 'off' });
    expect(await off(emp)).toBe('off');
    expect(await off(pm)).toBe('off');
  });

  it('shows a break that is on', async () => {
    vi.spyOn(attendance, 'getOpenBreak').mockResolvedValue(breakRow(emp, '10:10'));
    const state = await timers.getState({ user: emp });
    expect(state).toMatchObject({ onBreak: true, breakStartedAt: at('10:10').toISOString() });
  });

  it('lists only today, oldest first, with a timer forgotten yesterday as running', async () => {
    await insertEntry(emp, acme, { date: YESTERDAY, from: '17:00' });
    await insertEntry(emp, beta, { from: '10:00', to: '10:20' });
    await insertEntry(emp, acme, { from: '09:30', to: '09:40' });
    const state = await timers.getState({ user: emp });
    expect(state.entries.map((entry) => entry.startClock)).toEqual(['09:30', '10:00']);
    // Yesterday's timer counts up to its midnight only (7 hours), not into today.
    expect(state.running).toMatchObject({ startClock: '17:00', minutes: 7 * 60 });
    expect(state.totalMinutes).toBe(30);
  });
});

describe('stopRunning and resumeAfterBreak (used by breaks and check-out)', () => {
  it('stops the running timer with the given reason inside the transaction', async () => {
    await timers.start({ user: emp, projectId: acme.id, note: 'Work' });
    setClock('11:00');
    const stopped = await db.transaction((trx) =>
      timers.stopRunning({ userId: emp.id, at: at('10:50'), reason: 'break' }, trx),
    );
    expect(stopped).toMatchObject({ endClock: '10:50', stopReason: 'break', minutes: 20 });
    expect(await timers.stopRunning({ userId: emp.id, at: at('11:00'), reason: 'break' })).toBe(
      null,
    );
    await expect(timers.stopRunning({ userId: emp.id, reason: 'lunch' })).rejects.toThrow();
  });

  it('never ends before the start; a timer from an earlier day ends by the midnight rule', async () => {
    await insertEntry(emp, acme, { from: '10:20' });
    const early = await timers.stopRunning({ userId: emp.id, at: at('10:00'), reason: 'checkout' });
    expect(early).toMatchObject({ startClock: '10:20', endClock: '10:20', minutes: 0 });
    // No check-out or screen time yesterday: it ends at its start, and nothing ran today.
    const old = await insertEntry(emp, beta, { date: YESTERDAY, from: '18:00' });
    const late = await timers.stopRunning({ userId: emp.id, at: at('10:30'), reason: 'stopped' });
    expect(late).toBeNull();
    expect(await db('timeEntries').where({ id: old }).first()).toMatchObject({
      endedAt: at('18:00', YESTERDAY),
      stopReason: 'midnight',
    });
  });

  it('resumes the paused work at the given moment', async () => {
    const paused = await insertEntry(emp, acme, {
      from: '10:00',
      to: '10:10',
      stopReason: 'break',
      note: 'Work',
      projectTaskId: taskP1,
    });
    const resumed = await db.transaction((trx) =>
      timers.resumeAfterBreak({ userId: emp.id, entryId: paused, at: at('10:25') }, trx),
    );
    expect(resumed).toMatchObject({
      projectId: acme.id,
      projectTaskId: taskP1,
      note: 'Work',
      startClock: '10:25',
      endClock: null,
      source: 'timer',
    });
    // A timer already runs: nothing starts.
    expect(
      await timers.resumeAfterBreak({ userId: emp.id, entryId: paused, at: at('10:26') }),
    ).toBeNull();
  });

  it('skips work that is gone and drops a task that is no longer open', async () => {
    const other = await insertEntry(hr, acme, { from: '10:00', to: '10:10' });
    expect(await timers.resumeAfterBreak({ userId: emp.id, entryId: other })).toBeNull();
    expect(await timers.resumeAfterBreak({ userId: emp.id, entryId: 999999 })).toBeNull();
    const onHeld = await insertEntry(emp, held, { from: '09:40', to: '09:50' });
    expect(await timers.resumeAfterBreak({ userId: emp.id, entryId: onHeld })).toBeNull();
    const withDone = await insertEntry(emp, acme, {
      from: '10:00',
      to: '10:10',
      projectTaskId: taskDone,
      note: 'Old work',
    });
    const resumed = await timers.resumeAfterBreak({
      userId: emp.id,
      entryId: withDone,
      at: at('10:30'),
    });
    expect(resumed).toMatchObject({ projectTaskId: null, note: 'Old work', startClock: '10:30' });
  });
});
