// Changing timer entries by hand (CONTRACT 15): add, edit and delete today's entries, each rule
// with its field error, and the audit rows.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { timers } from '@/modules/timers';
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

vi.mock('@/modules/reports', () => ({ reports: {} }));

let pm;
let emp;
let other;
let notIn;
let acme;
let beta;
let held;
let taskP1;
let taskBeta;

const IP = '10.0.0.7';

const add = (input, user = emp) => timers.addEntry({ user, input, ip: IP });
const edit = (id, input, user = emp) => timers.updateEntry({ user, id, input, ip: IP });

async function fieldError(promise) {
  const error = await caught(promise);
  expect(error.code).toBe('VALIDATION_FAILED');
  return error.fields;
}

async function auditRows(action) {
  const rows = await db('auditLogs').where({ action }).orderBy('id');
  return rows.map((row) => ({
    ...row,
    before: parseJson(row.before),
    after: parseJson(row.after),
  }));
}

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  emp = await createUser({ name: 'Emma Dev' });
  other = await createUser({ name: 'Otto Dev' });
  notIn = await createUser({ name: 'Nia NotIn' });
  acme = await createProject(pm, { name: 'acme-app' });
  beta = await createProject(pm, { name: 'beta' });
  held = await createProject(pm, { name: 'paused', status: 'on_hold' });
  await addMembers(acme, [emp, other]);
  taskP1 = await addTask(acme, pm, { title: 'Fix login timeout' });
  taskBeta = await addTask(beta, pm, { title: 'Beta task' });
  await checkIn(emp, TODAY, { in: '09:00' });
  await checkIn(other, TODAY, { in: '09:00' });
});

beforeEach(async () => {
  setClock('12:00');
  await setSettings({ timers_mode: 'optional' });
  await db('attendanceBreaks').del();
  await db('timeEntries').del();
  await db('auditLogs').del();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('addEntry', () => {
  it('adds manual time on today and audits it', async () => {
    const state = await add({
      projectId: acme.id,
      projectTaskId: taskP1,
      note: ' Pairing ',
      startClock: '9:40',
      endClock: '10:10',
    });
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      projectId: acme.id,
      projectTaskId: taskP1,
      note: 'Pairing',
      startClock: '09:40',
      endClock: '10:10',
      minutes: 30,
      source: 'manual',
      stopReason: null,
    });
    const [log] = await auditRows('time_entry.create');
    expect(log).toMatchObject({
      actorId: emp.id,
      entityType: 'time_entry',
      entityId: state.entries[0].id,
      before: null,
      ip: IP,
    });
    expect(log.after).toMatchObject({
      projectId: acme.id,
      projectTaskId: taskP1,
      note: 'Pairing',
      startedAt: at('09:40').toISOString(),
      endedAt: at('10:10').toISOString(),
      source: 'manual',
    });
  });

  it('checks the times: start before end, not after now, a valid clock', async () => {
    expect(
      await fieldError(add({ projectId: acme.id, startClock: '10:00', endClock: '10:00' })),
    ).toEqual({ endClock: 'End must be after the start.' });
    expect(
      await fieldError(add({ projectId: acme.id, startClock: '11:00', endClock: '12:01' })),
    ).toEqual({ endClock: "End can't be later than now." });
    expect(
      await fieldError(add({ projectId: acme.id, startClock: '9.30', endClock: '10:00' })),
    ).toEqual({ startClock: 'Enter the start time, like 09:30.' });
    expect(await entriesOf(emp)).toHaveLength(0);
  });

  it("refuses time that overlaps the person's other entries, the running timer or a break", async () => {
    await insertEntry(emp, acme, { from: '10:00', to: '10:30' });
    await insertEntry(emp, beta, { from: '11:30' }); // running
    expect(
      await fieldError(add({ projectId: beta.id, startClock: '10:15', endClock: '10:45' })),
    ).toEqual({ startClock: 'That overlaps your acme-app time from 10:00 to 10:30.' });
    expect(
      await fieldError(add({ projectId: beta.id, startClock: '09:45', endClock: '10:05' })),
    ).toEqual({ endClock: 'That overlaps your acme-app time from 10:00 to 10:30.' });
    expect(
      await fieldError(add({ projectId: acme.id, startClock: '11:00', endClock: '11:45' })),
    ).toEqual({ endClock: 'That overlaps your beta timer, running since 11:30.' });
    vi.spyOn(attendance, 'listBreaks').mockResolvedValue([breakRow(emp, '10:40', '11:00')]);
    expect(
      await fieldError(add({ projectId: acme.id, startClock: '10:50', endClock: '11:10' })),
    ).toEqual({ startClock: 'That overlaps your break from 10:40 to 11:00.' });
    // Touching is fine: 10:30 to 10:40 sits between the entry and the break.
    const state = await add({ projectId: acme.id, startClock: '10:30', endClock: '10:40' });
    expect(state.entries).toHaveLength(3);
    // Another person's entries don't count.
    await insertEntry(other, acme, { from: '09:00', to: '09:30' });
    await add({ projectId: acme.id, startClock: '09:00', endClock: '09:30' });
  });

  it('fits time against a timer or a break that ended mid-minute, as the clocks show', async () => {
    setClock('10:00:05');
    await timers.start({ user: emp, projectId: acme.id });
    setClock('10:30:20');
    const stopped = await timers.stop({ user: emp });
    expect(stopped.entries.map((e) => [e.startClock, e.endClock, e.minutes])).toEqual([
      ['10:00', '10:30', 30],
    ]);
    setClock('11:00:40');
    await attendance.startBreak({ user: emp });
    setClock('11:30:15');
    await attendance.endBreak({ user: emp });
    setClock('12:00');

    await add({ projectId: beta.id, startClock: '10:30', endClock: '10:45' });
    await add({ projectId: beta.id, startClock: '10:45', endClock: '11:00' });
    const state = await add({ projectId: beta.id, startClock: '11:30', endClock: '11:45' });
    expect(state.entries.map((e) => [e.startClock, e.endClock])).toEqual([
      ['10:00', '10:30'],
      ['10:30', '10:45'],
      ['10:45', '11:00'],
      ['11:30', '11:45'],
    ]);
    // A minute into either still overlaps.
    expect(
      await fieldError(add({ projectId: beta.id, startClock: '11:29', endClock: '11:30' })),
    ).toEqual({ startClock: 'That overlaps your break from 11:00 to 11:30.' });
    // Moving the timer's own start keeps its end, which touches the next entry.
    await edit(state.entries[0].id, { startClock: '09:50' });
  });

  it('needs an active project, an open task of it, a check-in today and timers on', async () => {
    const times = { startClock: '09:10', endClock: '09:20' };
    expect((await caught(add({ projectId: held.id, ...times }))).code).toBe('PROJECT_NOT_ACTIVE');
    expect(
      await fieldError(add({ projectId: acme.id, projectTaskId: taskBeta, ...times })),
    ).toHaveProperty('projectTaskId');
    expect((await caught(add({ projectId: acme.id, ...times }, notIn))).code).toBe(
      'NOT_CHECKED_IN',
    );
    expect((await caught(add({ projectId: acme.id, ...times }, pm))).code).toBe('FORBIDDEN');
    await setSettings({ timers_mode: 'off' });
    expect((await caught(add({ projectId: acme.id, ...times }))).code).toBe('TIMERS_OFF');
    expect(await auditRows('time_entry.create')).toHaveLength(0);
  });
});

describe('updateEntry', () => {
  it('changes the fields sent and audits before and after', async () => {
    const id = await insertEntry(emp, acme, { from: '09:30', to: '10:00', note: 'Old' });
    const state = await edit(id, { note: 'New', startClock: '09:20', endClock: '10:05' });
    expect(state.entries[0]).toMatchObject({
      id,
      note: 'New',
      startClock: '09:20',
      endClock: '10:05',
      minutes: 45,
      source: 'timer',
    });
    const [log] = await auditRows('time_entry.update');
    expect(log).toMatchObject({ entityId: id, ip: IP, actorId: emp.id });
    expect(log.before).toMatchObject({ note: 'Old', startedAt: at('09:30').toISOString() });
    expect(log.after).toMatchObject({ note: 'New', endedAt: at('10:05').toISOString() });
  });

  it('changes nothing (and audits nothing) when the values are the same', async () => {
    const id = await insertEntry(emp, acme, {
      from: '09:30',
      to: '10:00',
      note: 'Same',
      startedAt: new Date(at('09:30').getTime() + 27_000), // a timer start has seconds
    });
    await edit(id, { projectId: acme.id, note: 'Same', startClock: '09:30', endClock: '10:00' });
    expect(await auditRows('time_entry.update')).toHaveLength(0);
    const [row] = await entriesOf(emp);
    expect(row.startedAt).toEqual(new Date(at('09:30').getTime() + 27_000));
  });

  it('lets a running entry change its start, project and note, not its end', async () => {
    const id = await insertEntry(emp, acme, { from: '11:00', projectTaskId: taskP1 });
    const state = await edit(id, { startClock: '10:45', projectId: beta.id, note: 'Moved' });
    expect(state.running).toMatchObject({
      id,
      startClock: '10:45',
      projectId: beta.id,
      projectTaskId: null, // the old project's task is dropped
      note: 'Moved',
      minutes: 75,
    });
    expect(await fieldError(edit(id, { endClock: '11:30' }))).toEqual({
      endClock: 'A running timer has no end yet. Stop it first to set one.',
    });
    expect(await fieldError(edit(id, { startClock: '12:30' }))).toEqual({
      startClock: "Start can't be later than now.",
    });
  });

  it('checks times, overlaps, projects and tasks like addEntry', async () => {
    const first = await insertEntry(emp, acme, { from: '09:00', to: '09:30' });
    const id = await insertEntry(emp, acme, {
      from: '10:00',
      to: '10:30',
      projectTaskId: taskP1,
    });
    expect(await fieldError(edit(id, { startClock: '09:15' }))).toEqual({
      startClock: 'That overlaps your acme-app time from 9:00 to 9:30.',
    });
    expect(await fieldError(edit(id, { startClock: '10:45' }))).toEqual({
      startClock: 'Start must be before the end.',
    });
    expect(await fieldError(edit(id, { endClock: '12:15' }))).toEqual({
      endClock: "End can't be later than now.",
    });
    expect((await caught(edit(id, { projectId: held.id }))).code).toBe('PROJECT_NOT_ACTIVE');
    expect(await fieldError(edit(id, { projectTaskId: taskBeta }))).toHaveProperty('projectTaskId');
    // The task already linked may stay after it was marked done.
    await db('projectTasks').where({ id: taskP1 }).update({ status: 'done' });
    await edit(id, { projectTaskId: taskP1, note: 'Kept' });
    await db('projectTasks').where({ id: taskP1 }).update({ status: 'open' });
    expect((await entriesOf(emp)).find((row) => row.id === id).projectTaskId).toBe(taskP1);
    // Editing an entry may keep its own time: no overlap with itself.
    await edit(first, { startClock: '08:55', endClock: '09:30' });
  });

  it("only changes the person's own entries of today", async () => {
    const yesterday = await insertEntry(emp, acme, { date: YESTERDAY, from: '10:00', to: '11:00' });
    const error = await caught(edit(yesterday, { note: 'Late' }));
    expect(error).toMatchObject({
      code: 'BAD_REQUEST',
      message: "Only today's timers can be changed.",
    });
    const theirs = await insertEntry(other, acme, { from: '10:00', to: '11:00' });
    expect((await caught(edit(theirs, { note: 'Mine' }))).code).toBe('NOT_FOUND');
    expect((await caught(edit(999999, { note: 'Ghost' }))).code).toBe('NOT_FOUND');
    expect((await caught(edit(theirs, { note: 'HR' }, pm))).code).toBe('FORBIDDEN');
    expect(await fieldError(edit(theirs, {}, other))).toEqual({ _: 'Nothing to change.' });
  });
});

describe('removeEntry', () => {
  it('deletes an entry of today, running ones too, and audits it', async () => {
    const id = await insertEntry(emp, acme, { from: '09:30', to: '10:00', note: 'Gone' });
    const running = await insertEntry(emp, beta, { from: '11:00' });
    let state = await timers.removeEntry({ user: emp, id, ip: IP });
    expect(state.entries.map((entry) => entry.id)).toEqual([running]);
    state = await timers.removeEntry({ user: emp, id: running, ip: IP });
    expect(state).toMatchObject({ running: null, entries: [] });
    const logs = await auditRows('time_entry.delete');
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ entityId: id, after: null, ip: IP });
    expect(logs[0].before).toMatchObject({ note: 'Gone', endedAt: at('10:00').toISOString() });
  });

  it("refuses other people's entries and earlier days", async () => {
    const yesterday = await insertEntry(emp, acme, { date: YESTERDAY, from: '10:00', to: '11:00' });
    expect((await caught(timers.removeEntry({ user: emp, id: yesterday }))).code).toBe(
      'BAD_REQUEST',
    );
    const theirs = await insertEntry(other, acme, { from: '10:00', to: '11:00' });
    expect((await caught(timers.removeEntry({ user: emp, id: theirs }))).code).toBe('NOT_FOUND');
    expect((await caught(timers.removeEntry({ user: emp, id: 'abc' }))).code).toBe('NOT_FOUND');
    expect(await db('timeEntries').count({ count: '*' }).first()).toEqual({ count: 2 });
  });
});
