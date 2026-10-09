// Away time while a timer runs (CONTRACT 15): when the state offers it, keep and remove, a stale
// answer, and the day summary that fills the daily report.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { activity } from '@/modules/activity';
import { timers } from '@/modules/timers';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import {
  addSegment,
  addTask,
  at,
  caught,
  entriesOf,
  insertEntry,
  setClock,
  TODAY,
} from './timersKit.js';

vi.mock('@/modules/reports', () => ({ reports: {} }));

let pm;
let emp;
let acme;
let beta;
let gamma;
let taskP1;

/** A timer on acme since 10:00 with 32 min of idle-then-locked screen time from 10:30 to 11:02. */
async function awayDay() {
  const id = await insertEntry(emp, acme, {
    from: '10:00',
    note: 'Build',
    projectTaskId: taskP1,
  });
  await addSegment(emp, 'active', '10:00', '10:30');
  await addSegment(emp, 'idle', '10:30', '10:45');
  await addSegment(emp, 'locked', '10:46', '11:02');
  await addSegment(emp, 'active', '11:03', '11:10');
  setClock('11:10');
  return id;
}

const answer = (away, decision, overrides = {}) =>
  timers.resolveAway({
    user: emp,
    entryId: away.entryId,
    from: away.from,
    to: away.to,
    decision,
    ...overrides,
  });

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  emp = await createUser({ name: 'Emma Dev' });
  acme = await createProject(pm, { name: 'acme-app' });
  beta = await createProject(pm, { name: 'beta', color: 'green' });
  gamma = await createProject(pm, { name: 'gamma', isUrgent: true });
  await addMembers(acme, [emp]);
  taskP1 = await addTask(acme, pm, { title: 'Fix login timeout' });
  await checkIn(emp, TODAY, { in: '09:00' });
});

beforeEach(async () => {
  setClock('11:10');
  await setSettings({
    timers_mode: 'optional',
    timer_away_minutes: 25,
    activity_tracking_enabled: true,
  });
  await db('timeEntries').del();
  await db('activitySegments').del();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('away time in the state', () => {
  it('offers ended idle or locked time of the running timer, merged within 150 s', async () => {
    const id = await awayDay();
    const { away } = await timers.getState({ user: emp });
    expect(away).toEqual({
      entryId: id,
      from: at('10:30').toISOString(),
      to: at('11:02').toISOString(),
      minutes: 32,
      fromClock: '10:30',
      toClock: '11:02',
      projectName: 'acme-app',
    });
  });

  it('waits until the away time has ended and is long enough', async () => {
    await insertEntry(emp, acme, { from: '10:00' });
    await addSegment(emp, 'active', '10:00', '10:30');
    await addSegment(emp, 'idle', '10:30', '11:10'); // may still be going on
    expect((await timers.getState({ user: emp })).away).toBeNull();
    await db('activitySegments').del();
    await addSegment(emp, 'idle', '10:30', '10:45');
    await addSegment(emp, 'idle', '10:48', '11:00'); // 3 min apart: two short spans
    await addSegment(emp, 'active', '11:00', '11:10');
    expect((await timers.getState({ user: emp })).away).toBeNull();
  });

  it('asks nothing without a running timer, with screen time off or when blocked', async () => {
    await awayDay();
    await setSettings({ activity_tracking_enabled: false });
    expect((await timers.getState({ user: emp })).away).toBeNull();
    await setSettings({ activity_tracking_enabled: true, timers_mode: 'off' });
    expect((await timers.getState({ user: emp })).away).toBeNull();
    await setSettings({ timers_mode: 'optional' });
    await timers.stop({ user: emp });
    expect((await timers.getState({ user: emp })).away).toBeNull();
  });

  it('never asks about window-only screen time (no Idle Detection)', async () => {
    await insertEntry(emp, acme, { from: '10:00' });
    await addSegment(emp, 'active', '10:00', '10:30', TODAY, 'window');
    await addSegment(emp, 'idle', '10:30', '11:02', TODAY, 'window');
    await addSegment(emp, 'active', '11:03', '11:10', TODAY, 'window');
    expect((await timers.getState({ user: emp })).away).toBeNull();
    // Idle Detection idle time ends when window-only screen time takes over.
    await db('activitySegments').del();
    await addSegment(emp, 'active', '10:00', '10:30');
    await addSegment(emp, 'locked', '10:30', '11:02');
    await addSegment(emp, 'active', '11:03', '11:10', TODAY, 'window');
    expect((await timers.getState({ user: emp })).away).toMatchObject({
      fromClock: '10:30',
      toClock: '11:02',
      minutes: 32,
    });
  });

  it('a screen-time failure only loses the prompt', async () => {
    await awayDay();
    vi.spyOn(activity, 'getDay').mockRejectedValue(new Error('database gone'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const state = await timers.getState({ user: emp });
    expect(state.away).toBeNull();
    expect(state.running).not.toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('resolveAway', () => {
  it('keep: the time stays and is not asked about again', async () => {
    const id = await awayDay();
    const { away } = await timers.getState({ user: emp });
    const state = await answer(away, 'keep');
    expect(state.away).toBeNull();
    expect(state.entries).toHaveLength(1);
    const [row] = await entriesOf(emp);
    expect(row).toMatchObject({ id, endedAt: null, awayCheckedUntil: at('11:02') });
  });

  it('remove: the timer ends where the away time began and runs again from its end', async () => {
    const id = await awayDay();
    const { away } = await timers.getState({ user: emp });
    const state = await answer(away, 'remove');
    expect(state.away).toBeNull();
    expect(state.entries.map((e) => [e.startClock, e.endClock, e.stopReason, e.minutes])).toEqual([
      ['10:00', '10:30', 'away', 30],
      ['11:02', null, null, 8],
    ]);
    expect(state.running).toMatchObject({
      projectId: acme.id,
      projectTaskId: taskP1,
      note: 'Build',
      source: 'timer',
    });
    const rows = await entriesOf(emp);
    expect(rows[0].id).toBe(id);
    expect(rows[1].awayCheckedUntil).toEqual(at('11:02'));
    expect(state.totalMinutes).toBe(38);
  });

  it('remove from the first minute moves the timer start, leaving no empty entry', async () => {
    const id = await insertEntry(emp, acme, { from: '10:00', note: 'Build' });
    await addSegment(emp, 'locked', '09:50', '10:40'); // began before the timer
    await addSegment(emp, 'active', '10:41', '11:10');
    const { away } = await timers.getState({ user: emp });
    expect(away).toMatchObject({ fromClock: '10:00', toClock: '10:40', minutes: 40 });
    const state = await answer(away, 'remove');
    expect(state.entries.map((e) => [e.id, e.startClock, e.endClock, e.minutes])).toEqual([
      [id, '10:40', null, 30],
    ]);
    expect(state.away).toBeNull();
    const [row] = await entriesOf(emp);
    expect(row).toMatchObject({ startedAt: at('10:40'), awayCheckedUntil: at('10:40') });
  });

  it('refuses an answer that no longer matches the away time', async () => {
    await awayDay();
    const { away } = await timers.getState({ user: emp });
    const stale = 'That away time changed. Refresh and try again.';
    const shifted = { to: at('11:02').getTime() + 1000 };
    const moved = await caught(answer(away, 'remove', { to: new Date(shifted.to).toISOString() }));
    expect(moved).toMatchObject({ code: 'CONFLICT', message: stale });
    expect((await caught(answer(away, 'keep', { entryId: away.entryId + 1 }))).code).toBe(
      'CONFLICT',
    );
    await answer(away, 'keep');
    expect((await caught(answer(away, 'keep'))).code).toBe('CONFLICT'); // already answered
    expect((await caught(answer(away, 'pause'))).code).toBe('VALIDATION_FAILED');
    expect((await caught(answer(away, 'keep', { user: pm }))).code).toBe('FORBIDDEN');
    await timers.stop({ user: emp });
    expect((await caught(answer(away, 'remove'))).code).toBe('CONFLICT');
  });
});

describe('getDaySummary', () => {
  it('rounds each project to the nearest 15 minutes, biggest first, running to now', async () => {
    await insertEntry(emp, acme, { from: '09:00', to: '09:07' }); // 7 -> 0
    await insertEntry(emp, beta, { from: '09:10', to: '09:18' }); // 8 -> 15
    await insertEntry(emp, gamma, { from: '06:00', to: '09:00' }); // 180 ...
    await insertEntry(emp, gamma, { from: '10:03' }); // ... + 67 running = 247 -> 240
    const summary = await timers.getDaySummary(emp.id, TODAY);
    expect(summary.totalMinutes).toBe(262);
    expect(summary.projects.map((p) => [p.projectName, p.minutes, p.roundedMinutes])).toEqual([
      ['gamma', 247, 240],
      ['beta', 8, 15],
      ['acme-app', 7, 0],
    ]);
    expect(summary.projects[0]).toMatchObject({ projectId: gamma.id, isUrgent: true });
    expect(summary.projects[1].projectColor).toBe('green');
    expect(await timers.getDaySummary(emp.id, '2026-09-01')).toEqual({
      totalMinutes: 0,
      projects: [],
    });
  });

  it('turns notes and priority tasks into de-duplicated task lines', async () => {
    await insertEntry(emp, acme, { from: '09:00', to: '09:30', note: 'Fix login' });
    await insertEntry(emp, acme, { from: '09:30', to: '09:40', note: '  fix LOGIN ' });
    await insertEntry(emp, acme, { from: '09:40', to: '09:50', projectTaskId: taskP1 });
    await insertEntry(emp, acme, {
      from: '09:50',
      to: '10:00',
      projectTaskId: taskP1,
      note: 'Second go',
    });
    await insertEntry(emp, acme, { from: '10:00', to: '10:10' });
    const [project] = (await timers.getDaySummary(emp.id, TODAY)).projects;
    expect(project).toMatchObject({ minutes: 70, roundedMinutes: 75 });
    expect(project.tasks).toEqual([
      { note: 'Fix login', projectTaskId: null, priority: null, projectTaskTitle: null },
      {
        note: 'Fix login timeout',
        projectTaskId: taskP1,
        priority: 'p1',
        projectTaskTitle: 'Fix login timeout',
      },
    ]);
  });

  it('links only open priority tasks: one done since gives a plain line', async () => {
    const banner = await addTask(acme, pm, { title: 'Ship the banner', priority: 'p2' });
    await insertEntry(emp, acme, { from: '09:00', to: '09:20', projectTaskId: banner });
    await insertEntry(emp, acme, {
      from: '09:20',
      to: '09:30',
      projectTaskId: banner,
      note: 'Banner copy',
    });
    await insertEntry(emp, acme, { from: '09:30', to: '09:40', note: 'ship the BANNER' });
    await insertEntry(emp, acme, { from: '09:40', to: '09:50', projectTaskId: taskP1 });
    await db('projectTasks').where({ id: banner }).update({ status: 'done' });
    const [project] = (await timers.getDaySummary(emp.id, TODAY)).projects;
    const plain = (note) => ({ note, projectTaskId: null, priority: null, projectTaskTitle: null });
    // The task's title, else the note, without the link; then de-duplicated by note.
    expect(project.tasks).toEqual([
      plain('Ship the banner'),
      plain('Banner copy'),
      {
        note: 'Fix login timeout',
        projectTaskId: taskP1,
        priority: 'p1',
        projectTaskTitle: 'Fix login timeout',
      },
    ]);
    // Today's entries still show the task they were timed on.
    const { entries } = await timers.getState({ user: emp });
    expect(entries[0]).toMatchObject({
      projectTaskId: banner,
      projectTaskTitle: 'Ship the banner',
    });
  });
});
