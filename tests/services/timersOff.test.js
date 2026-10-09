// Turning project timers off (CONTRACT 15): timers.stopAllRunning, Settings stopping every running
// timer once the mode changes to off (and never failing the save over it), and the light state
// getState returns while timers are off.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { attendance } from '@/modules/attendance';
import { settings } from '@/modules/settings';
import { timers } from '@/modules/timers';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { addSegment, at, entriesOf, insertEntry, setClock, TODAY, YESTERDAY } from './timersKit.js';

// The reports module belongs to another owner; attendance and projects import it.
vi.mock('@/modules/reports', () => ({ reports: {} }));

let pm;
let admin;
let emp;
let hr;
let late; // a timer started after the moment it is stopped at
let night; // a timer still running from yesterday
let acme;
let beta;

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  emp = await createUser({ name: 'Emma Dev' });
  hr = await createUser({ name: 'Hana HR', role: 'hr' });
  late = await createUser({ name: 'Leo Late' });
  night = await createUser({ name: 'Nia Night' });
  acme = await createProject(pm, { name: 'acme-app', color: 'violet' });
  beta = await createProject(pm, { name: 'beta' });
  await addMembers(acme, [emp, hr, late, night]);
  await addMembers(beta, [emp, hr]);
  for (const user of [emp, hr, late, night]) await checkIn(user, TODAY, { in: '09:30' });
});

beforeEach(async () => {
  setClock('10:45');
  await setSettings({ timers_mode: 'optional', activity_tracking_enabled: true });
  await db('timeEntries').del();
  await db('notifications').del();
  await db('activitySegments').del();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The person's entries as [project, start, end, stop reason] in local clocks. */
async function stretches(user) {
  const rows = await entriesOf(user);
  const clock = (value) =>
    value
      ? new Date(value).toLocaleTimeString('en-GB', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
  return rows.map((row) => [
    row.projectId,
    clock(row.startedAt),
    clock(row.endedAt),
    row.stopReason,
  ]);
}

describe('timers.stopAllRunning', () => {
  it("stops everyone's running timer at the given moment, in one go", async () => {
    await insertEntry(emp, acme, { from: '09:30', to: '10:00' }); // finished: untouched
    await insertEntry(emp, beta, { from: '10:00' });
    await insertEntry(hr, acme, { from: '10:15', note: 'Review' });
    await insertEntry(late, acme, { from: '10:40' }); // after 10:30: ends at its start
    const result = await timers.stopAllRunning({ at: at('10:30'), reason: 'stopped' });
    expect(result).toEqual({ stopped: 3 });
    expect(await stretches(emp)).toEqual([
      [acme.id, '09:30', '10:00', 'stopped'],
      [beta.id, '10:00', '10:30', 'stopped'],
    ]);
    expect(await stretches(hr)).toEqual([[acme.id, '10:15', '10:30', 'stopped']]);
    expect(await stretches(late)).toEqual([[acme.id, '10:40', '10:40', 'stopped']]);
    expect(await db('timeEntries').whereNull('endedAt')).toHaveLength(0);
  });

  it('closes a timer left running from an earlier day by the midnight rule (not counted)', async () => {
    // No check-out or screen time yesterday: it ends at its start, and its person is told.
    await insertEntry(night, acme, { date: YESTERDAY, from: '17:00' });
    await insertEntry(emp, beta, { from: '10:00' });
    expect(await timers.stopAllRunning({ reason: 'stopped' })).toEqual({ stopped: 1 });
    expect(await db('timeEntries').where({ userId: night.id }).first()).toMatchObject({
      endedAt: at('17:00', YESTERDAY),
      stopReason: 'midnight',
    });
    expect(await stretches(emp)).toEqual([[beta.id, '10:00', '10:45', 'stopped']]);
    const notes = await db('notifications').where({ userId: night.id });
    expect(notes.map((note) => note.type)).toEqual(['timer.stopped_midnight']);
  });

  it('stops nothing when nothing runs, and refuses an unknown reason', async () => {
    await insertEntry(emp, acme, { from: '09:30', to: '10:00' });
    expect(await timers.stopAllRunning({ reason: 'stopped' })).toEqual({ stopped: 0 });
    await insertEntry(emp, beta, { from: '10:00' });
    await expect(timers.stopAllRunning({ reason: 'lunch' })).rejects.toThrow(/stop reason/);
    expect(await db('timeEntries').whereNull('endedAt')).toHaveLength(1);
  });
});

describe('turning timers off in Settings', () => {
  it('optional to off stops every running timer at the moment of the save', async () => {
    await insertEntry(emp, acme, { from: '10:00', note: 'Login' });
    await insertEntry(hr, beta, { from: '10:20' });
    setClock('11:00');
    const saved = await settings.update({ user: admin, values: { timersMode: 'off' } });
    expect(saved.timersMode).toBe('off');
    expect(await stretches(emp)).toEqual([[acme.id, '10:00', '11:00', 'stopped']]);
    expect(await stretches(hr)).toEqual([[beta.id, '10:20', '11:00', 'stopped']]);
    expect((await timers.getState({ user: emp })).running).toBeNull();
  });

  it('required to off does too', async () => {
    await setSettings({ timers_mode: 'required' });
    await insertEntry(emp, acme, { from: '10:00' });
    await settings.update({
      user: admin,
      values: { timersMode: 'off', breakAllowanceMinutes: 30 },
    });
    expect(await stretches(emp)).toEqual([[acme.id, '10:00', '10:45', 'stopped']]);
  });

  it('leaves timers running when the mode does not change to off', async () => {
    await setSettings({ timers_mode: 'off' });
    await insertEntry(emp, acme, { from: '10:00' });
    // Already off (sent again with another change), then on again: nothing is stopped.
    await settings.update({ user: admin, values: { timersMode: 'off', timerAwayMinutes: 40 } });
    await settings.update({ user: admin, values: { timersMode: 'optional' } });
    await settings.update({ user: admin, values: { timersMode: 'required' } });
    await settings.update({ user: admin, values: { breakAllowanceMinutes: 45 } });
    expect(await stretches(emp)).toEqual([[acme.id, '10:00', null, null]]);
  });

  it('a failure to stop them is logged and the save stands', async () => {
    await insertEntry(emp, acme, { from: '10:00' });
    vi.spyOn(timers, 'stopAllRunning').mockRejectedValue(new Error('connection lost'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const saved = await settings.update({ user: admin, values: { timersMode: 'off' } });
    expect(saved.timersMode).toBe('off');
    expect((await settings.getAll()).timersMode).toBe('off');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: admin.id }),
      'timers turned off; running timers could not be stopped',
    );
    expect(await stretches(emp)).toEqual([[acme.id, '10:00', null, null]]);
  });
});

describe('getState while timers are off', () => {
  /** The SQL a call runs. */
  async function queriesOf(run) {
    const queries = [];
    const listen = (query) => queries.push(query.sql);
    db.on('query', listen);
    try {
      return { result: await run(), queries };
    } finally {
      db.removeListener('query', listen);
    }
  }

  it('reads only the running timer, so it can still be stopped', async () => {
    await insertEntry(emp, beta, { from: '09:30', to: '09:50', note: 'Standup' });
    await insertEntry(emp, acme, { from: '10:00', note: 'Login' });
    // Away time that would be offered with timers on.
    await addSegment(emp, 'idle', '10:05', '10:35');
    await addSegment(emp, 'active', '10:36', '10:45');
    await setSettings({ timers_mode: 'off', timer_away_minutes: 25 });
    const openBreak = vi.spyOn(attendance, 'getOpenBreak');
    const { result: state, queries } = await queriesOf(() => timers.getState({ user: emp }));
    expect(state).toEqual({
      mode: 'off',
      canUse: true,
      blocked: 'off',
      running: expect.objectContaining({
        projectId: acme.id,
        projectName: 'acme-app',
        note: 'Login',
        startClock: '10:00',
        endClock: null,
        minutes: 45,
      }),
      onBreak: false,
      breakStartedAt: null,
      entries: [],
      totalMinutes: 0,
      byProject: [],
      away: null,
      serverNow: at('10:45').toISOString(),
    });
    expect(openBreak).not.toHaveBeenCalled();
    // The settings, then the running timer: no entries list, attendance, breaks or screen time.
    expect(queries.filter((sql) => sql.includes('`time_entries`'))).toHaveLength(1);
    expect(
      queries.some((sql) => /`(attendance|attendance_breaks|activity_segments)`/.test(sql)),
    ).toBe(false);
    // ...and Stop still works.
    const stopped = await timers.stop({ user: emp });
    expect(stopped).toMatchObject({ mode: 'off', blocked: 'off', running: null, entries: [] });
    expect(await stretches(emp)).toEqual([
      [beta.id, '09:30', '09:50', 'stopped'],
      [acme.id, '10:00', '10:45', 'stopped'],
    ]);
  });

  it('is the empty state with nothing running, and for someone who cannot use timers', async () => {
    await insertEntry(emp, acme, { from: '09:30', to: '10:00' });
    await setSettings({ timers_mode: 'off' });
    const empty = {
      mode: 'off',
      canUse: true,
      blocked: 'off',
      running: null,
      onBreak: false,
      breakStartedAt: null,
      entries: [],
      totalMinutes: 0,
      byProject: [],
      away: null,
      serverNow: at('10:45').toISOString(),
    };
    expect(await timers.getState({ user: emp })).toEqual(empty);
    const { result, queries } = await queriesOf(() => timers.getState({ user: pm }));
    expect(result).toEqual({ ...empty, canUse: false });
    expect(queries.some((sql) => sql.includes('`time_entries`'))).toBe(false);
  });

  it('still reads everything with timers on', async () => {
    await insertEntry(emp, acme, { from: '09:30', to: '10:00', note: 'Login' });
    const state = await timers.getState({ user: emp });
    expect(state).toMatchObject({ mode: 'optional', blocked: null, totalMinutes: 30 });
    expect(state.entries).toHaveLength(1);
  });
});
