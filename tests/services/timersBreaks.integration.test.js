// Timers and breaks together (CONTRACT 15) on the real modules: attendance, timers, reports,
// projects and dashboard, nothing mocked. A break pauses the running timer and End break resumes
// it; starting a timer ends a break; check-out ends both; worked time and the break allowance; the
// Team board's live status; the midnight job; entry edits against breaks; reminders skip breaks.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { dashboard } from '@/modules/dashboard';
import { timers } from '@/modules/timers';
import { closeOpenTimersJob } from '@/worker/jobs/closeOpenTimers';
import { forgetHandledKeysForTests } from '@/worker/runOnce';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject, createReport } from './dashboardKit.js';
import {
  addSegment,
  addTask,
  at,
  caught,
  entriesOf,
  insertEntry,
  setClock,
  TODAY,
  YESTERDAY,
} from './timersKit.js';

let pm;
let acme;
let beta;
let task;

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app', color: 'violet' });
  beta = await createProject(pm, { name: 'beta', color: 'blue' });
  task = await addTask(acme, pm, { title: 'Fix login timeout' });
});

beforeEach(async () => {
  setClock('09:00');
  await setSettings({
    timers_mode: 'optional',
    break_allowance_minutes: 60,
    gap_warning_minutes: 30,
    timer_reminder_minutes: 20,
  });
});

/** A new employee on both projects, checked in on `date` at `in` (null: not checked in). */
async function person(name, { in: inAt = '09:00', date = TODAY } = {}) {
  const user = await createUser({ name });
  await addMembers(acme, [user]);
  await addMembers(beta, [user]);
  if (inAt) await checkIn(user, date, { in: inAt });
  return user;
}

const breaksOf = (user) => db('attendanceBreaks').where({ userId: user.id }).orderBy('id');
const notesOf = (user, type) => db('notifications').where({ userId: user.id, type }).orderBy('id');
/** A local clock plus some seconds, as a Date. */
const atSecond = (clock, seconds, date = TODAY) =>
  new Date(at(clock, date).getTime() + seconds * 1000);

describe('a break pauses the timer and End break resumes it', () => {
  let emma;

  beforeAll(async () => {
    emma = await person('Emma Pause');
  });

  it('Start break stops the running timer (break) at the break start', async () => {
    setClock('10:00');
    await timers.start({ user: emma, projectId: acme.id, projectTaskId: task, note: 'Login fix' });
    setClock('11:00:30');
    const result = await attendance.startBreak({ user: emma });

    const [entry] = await entriesOf(emma);
    expect(entry).toMatchObject({ stopReason: 'break', endedAt: atSecond('11:00', 30) });
    expect(result.pausedEntryId).toBe(entry.id);
    expect(result.break).toMatchObject({
      pausedEntryId: entry.id,
      startedAt: atSecond('11:00', 30),
      endedAt: null,
      endReason: null,
    });
    const state = await timers.getState({ user: emma });
    expect(state).toMatchObject({
      blocked: null,
      running: null,
      onBreak: true,
      breakStartedAt: atSecond('11:00', 30).toISOString(),
    });
    expect(state.entries).toEqual([
      expect.objectContaining({ id: entry.id, stopReason: 'break', minutes: 60 }),
    ]);
  });

  it('End break starts the same project, task and note again at the break end', async () => {
    setClock('11:20:30');
    const result = await attendance.endBreak({ user: emma });

    expect(result.break).toMatchObject({ endedAt: atSecond('11:20', 30), endReason: 'self' });
    expect(result).toMatchObject({ breakMinutesToday: 20, overAllowanceMinutes: 0 });
    const [first, second] = await entriesOf(emma);
    expect(first.stopReason).toBe('break');
    expect(second).toMatchObject({
      workDate: TODAY,
      projectId: acme.id,
      projectTaskId: task,
      note: 'Login fix',
      source: 'timer',
      startedAt: atSecond('11:20', 30),
      endedAt: null,
    });

    setClock('11:30');
    const state = await timers.getState({ user: emma });
    expect(state).toMatchObject({ onBreak: false, breakStartedAt: null, totalMinutes: 69 });
    expect(state.running).toMatchObject({
      id: second.id,
      projectId: acme.id,
      projectTaskId: task,
      projectTaskTitle: 'Fix login timeout',
      note: 'Login fix',
      minutes: 9,
    });
    const today = await attendance.getMyToday({ user: emma, ip: null });
    expect(today).toMatchObject({
      presentMinutes: 150,
      breakMinutes: 20,
      workedMinutes: 130,
      openBreak: null,
    });
  });

  it('a task closed during the break is dropped from the resumed timer', async () => {
    setClock('12:00');
    await attendance.startBreak({ user: emma });
    await db('projectTasks').where({ id: task }).update({ status: 'done' });
    setClock('12:10');
    await attendance.endBreak({ user: emma });
    await db('projectTasks').where({ id: task }).update({ status: 'open' });

    const rows = await entriesOf(emma);
    expect(rows.at(-1)).toMatchObject({
      projectId: acme.id,
      projectTaskId: null,
      note: 'Login fix',
      endedAt: null,
    });
  });

  it('no resume when timers were turned off during the break', async () => {
    const ivy = await person('Ivy Off');
    setClock('10:00');
    await timers.start({ user: ivy, projectId: acme.id });
    setClock('10:30');
    await attendance.startBreak({ user: ivy });
    await setSettings({ timers_mode: 'off' });
    setClock('10:45');
    await attendance.endBreak({ user: ivy });

    const rows = await entriesOf(ivy);
    expect(rows).toHaveLength(1);
    expect(rows[0].stopReason).toBe('break');
  });

  it('no resume when HR closed the day during the break', async () => {
    const hal = await person('Hal Closed');
    setClock('10:00');
    await timers.start({ user: hal, projectId: acme.id });
    setClock('16:00');
    await attendance.startBreak({ user: hal });
    await db('attendance')
      .where({ userId: hal.id, workDate: TODAY })
      .update({ checkOutAt: at('16:30'), checkoutStatus: 'checked_out' });
    setClock('17:00');
    const result = await attendance.endBreak({ user: hal });

    expect(result).toMatchObject({ breakMinutesToday: 30 });
    expect(await entriesOf(hal)).toEqual([expect.objectContaining({ stopReason: 'break' })]);
  });

  it('no resume for someone who may no longer use timers; the break still ends', async () => {
    const una = await person('Una Untracked');
    setClock('10:00');
    await timers.start({ user: una, projectId: acme.id });
    setClock('11:00');
    await attendance.startBreak({ user: una });
    await db('users').where({ id: una.id }).update({ tracksAttendance: false });
    const untracked = { ...una, tracksAttendance: false };
    setClock('11:30');
    const result = await attendance.endBreak({ user: untracked });

    expect(result.break).toMatchObject({ endReason: 'self', endedAt: at('11:30') });
    expect(await entriesOf(una)).toEqual([expect.objectContaining({ stopReason: 'break' })]);
  });
});

describe('starting a timer on a break', () => {
  it('ends the break (timer), does not resume the paused timer and runs the new one', async () => {
    const theo = await person('Theo Switch');
    setClock('10:00');
    await timers.start({ user: theo, projectId: acme.id, note: 'Specs' });
    setClock('10:30');
    await attendance.startBreak({ user: theo });
    setClock('10:40');
    const state = await timers.start({ user: theo, projectId: beta.id });

    const [item] = await breaksOf(theo);
    expect(item).toMatchObject({ endedAt: at('10:40'), endReason: 'timer' });
    const rows = await entriesOf(theo);
    expect(rows.map((row) => [row.projectId, row.stopReason, row.endedAt])).toEqual([
      [acme.id, 'break', at('10:30')],
      [beta.id, null, null],
    ]);
    expect(rows[1].startedAt).toEqual(at('10:40'));
    expect(state).toMatchObject({ onBreak: false, breakStartedAt: null });
    expect(state.running).toMatchObject({ id: rows[1].id, projectId: beta.id, note: null });
    expect((await caught(attendance.endBreak({ user: theo }))).code).toBe('NOT_ON_BREAK');
  });

  it('the same work as the paused timer starts a new entry from now', async () => {
    const sara = await person('Sara Same');
    setClock('10:00');
    await timers.start({ user: sara, projectId: acme.id, note: 'Specs' });
    setClock('10:30');
    await attendance.startBreak({ user: sara });
    setClock('10:50');
    await timers.start({ user: sara, projectId: acme.id, note: 'Specs' });

    const rows = await entriesOf(sara);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ projectId: acme.id, startedAt: at('10:50'), endedAt: null });
    expect((await breaksOf(sara))[0]).toMatchObject({ endReason: 'timer', endedAt: at('10:50') });
  });
});

describe('check-out', () => {
  it('stops a running timer (checkout) at the check-out time', async () => {
    const carl = await person('Carl Out');
    setClock('10:00');
    await timers.start({ user: carl, projectId: acme.id });
    setClock('17:00:40');
    const result = await attendance.checkOut({ user: carl, ip: null });

    const [entry] = await entriesOf(carl);
    expect(entry).toMatchObject({ stopReason: 'checkout', endedAt: atSecond('17:00', 40) });
    expect(result.row.checkOutAt).toEqual(atSecond('17:00', 40));
    expect(result).toMatchObject({ presentMinutes: 480, breakMinutes: 0, workedMinutes: 480 });
  });

  it('ends an open break (checkout) without resuming the paused timer', async () => {
    const olga = await person('Olga Break');
    await createReport(olga, TODAY, {
      status: 'draft',
      entries: [{ projectId: acme.id, minutes: 150 }],
    });
    setClock('09:00');
    await timers.start({ user: olga, projectId: acme.id, note: 'Specs' });
    setClock('12:00');
    await attendance.startBreak({ user: olga });
    setClock('12:30');
    const result = await attendance.checkOut({ user: olga, ip: null });

    expect((await breaksOf(olga))[0]).toMatchObject({
      endedAt: at('12:30'),
      endReason: 'checkout',
    });
    const rows = await entriesOf(olga);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stopReason: 'break', endedAt: at('12:00') });
    expect(result).toMatchObject({
      reportStatus: 'draft',
      reportPending: true,
      presentMinutes: 210,
      breakMinutes: 30,
      workedMinutes: 180,
      loggedMinutes: 150,
      gapMinutes: 30,
      gapWarning: false,
    });
  });

  it('ends a running timer and an open break together; the state is blocked checked_out', async () => {
    const dan = await person('Dan Both');
    await createReport(dan, TODAY, {
      status: 'submitted',
      entries: [{ projectId: beta.id, minutes: 60 }],
    });
    setClock('10:00');
    await timers.start({ user: dan, projectId: acme.id });
    setClock('11:00');
    await attendance.startBreak({ user: dan });
    // A timer that runs during the break (as two tabs racing could leave it).
    await insertEntry(dan, beta, { from: '11:05', note: 'Hotfix' });
    setClock('11:30');
    const result = await attendance.checkOut({ user: dan, ip: null });

    const rows = await entriesOf(dan);
    expect(rows.map((row) => [row.projectId, row.stopReason, row.endedAt])).toEqual([
      [acme.id, 'break', at('11:00')],
      [beta.id, 'checkout', at('11:30')],
    ]);
    expect((await breaksOf(dan))[0]).toMatchObject({
      endedAt: at('11:30'),
      endReason: 'checkout',
    });
    expect(result).toMatchObject({
      reportStatus: 'submitted',
      reportPending: false,
      presentMinutes: 150,
      breakMinutes: 30,
      workedMinutes: 120,
      loggedMinutes: 60,
      gapMinutes: 60,
      gapWarning: true,
    });

    setClock('12:00');
    const state = await timers.getState({ user: dan });
    expect(state).toMatchObject({
      blocked: 'checked_out',
      running: null,
      onBreak: false,
      totalMinutes: 85,
    });
    expect(state.entries.map((entry) => [entry.projectId, entry.stopReason])).toEqual([
      [acme.id, 'break'],
      [beta.id, 'checkout'],
    ]);
    expect((await caught(attendance.startBreak({ user: dan }))).code).toBe('ALREADY_CHECKED_OUT');
    expect((await caught(timers.start({ user: dan, projectId: acme.id }))).code).toBe(
      'ALREADY_CHECKED_OUT',
    );
  });
});

describe('worked time and the break allowance', () => {
  it('worked = present - breaks; the allowance notification fires once, when crossing', async () => {
    const nora = await person('Nora Allowance');
    const breakFor = async (from, to) => {
      setClock(from);
      await attendance.startBreak({ user: nora });
      setClock(to);
      return attendance.endBreak({ user: nora });
    };
    const notes = () => notesOf(nora, 'attendance.break_over_allowance');

    expect(await breakFor('10:00', '10:40')).toMatchObject({
      breakMinutesToday: 40,
      overAllowanceMinutes: 0,
    });
    expect(await notes()).toHaveLength(0);
    expect(await breakFor('12:00', '12:30')).toMatchObject({
      breakMinutesToday: 70,
      overAllowanceMinutes: 10,
    });
    const [note] = await notes();
    expect(note).toMatchObject({
      title: 'Your breaks today are over the 60 min allowance',
      body: "You've had 1h 10m of breaks today.",
      link: '/today',
    });
    expect(await breakFor('14:00', '14:10')).toMatchObject({
      breakMinutesToday: 80,
      overAllowanceMinutes: 20,
    });
    expect(await notes()).toHaveLength(1);

    setClock('15:00');
    await attendance.startBreak({ user: nora });
    setClock('15:15');
    const today = await attendance.getMyToday({ user: nora, ip: null });
    expect(today).toMatchObject({ presentMinutes: 375, breakMinutes: 95, workedMinutes: 280 });
    expect(today.breaks).toHaveLength(4);
    expect(today.openBreak).toMatchObject({ startedAt: at('15:00'), endedAt: null });

    const row = (await attendance.listDay(TODAY)).find((item) => item.user.id === nora.id);
    expect(row).toMatchObject({
      presentMinutes: 375,
      breakMinutes: 95,
      workedMinutes: 280,
      overAllowanceMinutes: 35,
    });
    setClock('15:20');
    await attendance.endBreak({ user: nora });
    expect(await notes()).toHaveLength(1);
  });
});

describe('Team board live status', () => {
  it('shows who is on a break and what a running timer is on', async () => {
    const bea = await person('Bea Board');
    const tom = await person('Tom Timer');
    setClock('10:00');
    await timers.start({ user: tom, projectId: acme.id, note: 'Board work' });
    await timers.start({ user: bea, projectId: beta.id });
    setClock('11:00');
    await attendance.startBreak({ user: bea });
    setClock('11:15');
    const board = await dashboard.getTeamToday();
    const rows = board.groups.flatMap((group) => group.rows);

    expect(rows.find((row) => row.id === bea.id)).toMatchObject({
      onBreak: true,
      breakSince: at('11:00').toISOString(),
      workingOn: null,
    });
    expect(rows.find((row) => row.id === tom.id)).toMatchObject({
      onBreak: false,
      breakSince: null,
      workingOn: { name: 'acme-app', color: 'violet', note: 'Board work' },
    });
  });
});

describe('midnight', () => {
  it("closes yesterday's timers and breaks with the CONTRACT end times", async () => {
    // A timer running past check-out ends at the check-out.
    const tim = await person('Tim Checkout', { in: '09:30', date: YESTERDAY });
    setClock('17:00', YESTERDAY);
    await timers.start({ user: tim, projectId: acme.id });
    await db('attendance')
      .where({ userId: tim.id, workDate: YESTERDAY })
      .update({ checkOutAt: at('18:30', YESTERDAY), checkoutStatus: 'checked_out' });
    // A timer without a check-out ends when screen time last saw the person.
    const cy = await person('Cy Seen', { in: '09:30', date: YESTERDAY });
    setClock('10:00', YESTERDAY);
    await timers.start({ user: cy, projectId: beta.id });
    await addSegment(cy, 'active', '10:00', '18:20', YESTERDAY);
    // A break without a check-out ends at its own start; its paused timer stays stopped.
    const bo = await person('Bo Break', { in: '09:30', date: YESTERDAY });
    setClock('15:00', YESTERDAY);
    await timers.start({ user: bo, projectId: acme.id });
    setClock('16:00', YESTERDAY);
    await attendance.startBreak({ user: bo });
    // A break before an HR check-out ends at the check-out.
    const dee = await person('Dee Late', { in: '09:30', date: YESTERDAY });
    setClock('17:30', YESTERDAY);
    await attendance.startBreak({ user: dee });
    await db('attendance')
      .where({ userId: dee.id, workDate: YESTERDAY })
      .update({ checkOutAt: at('18:00', YESTERDAY), checkoutStatus: 'checked_out' });
    // Today's timer is left alone.
    const ed = await person('Ed Today', { in: '00:01' });
    setClock('00:02');
    await timers.start({ user: ed, projectId: acme.id });

    setClock('00:10');
    expect(await timers.closeForgotten(TODAY)).toEqual({ closed: 2 });
    expect(await attendance.closeForgottenBreaks(TODAY)).toEqual({ closed: 2 });

    expect((await entriesOf(tim))[0]).toMatchObject({
      stopReason: 'midnight',
      endedAt: at('18:30', YESTERDAY),
    });
    expect((await entriesOf(cy))[0]).toMatchObject({
      stopReason: 'midnight',
      endedAt: at('18:20', YESTERDAY),
    });
    expect(await entriesOf(bo)).toEqual([
      expect.objectContaining({ stopReason: 'break', endedAt: at('16:00', YESTERDAY) }),
    ]);
    expect((await breaksOf(bo))[0]).toMatchObject({
      endReason: 'midnight',
      endedAt: at('16:00', YESTERDAY),
    });
    expect((await breaksOf(dee))[0]).toMatchObject({
      endReason: 'midnight',
      endedAt: at('18:00', YESTERDAY),
    });
    expect((await entriesOf(ed))[0]).toMatchObject({ endedAt: null, stopReason: null });
    expect(await notesOf(tim, 'timer.stopped_midnight')).toEqual([
      expect.objectContaining({
        title: 'Your timer on acme-app was still running',
        link: `/report?date=${YESTERDAY}`,
      }),
    ]);
    expect(await notesOf(cy, 'timer.stopped_midnight')).toEqual([
      expect.objectContaining({
        body: 'We stopped it at 6:20 PM, the last time Daybook saw you active. Check your report before it locks.',
      }),
    ]);
  });

  it('a break left open from yesterday does not show as on a break today', async () => {
    const lee = await person('Lee Leftover', { in: '09:30', date: YESTERDAY });
    setClock('16:00', YESTERDAY);
    await attendance.startBreak({ user: lee });
    await checkIn(lee, TODAY, { in: '09:00' });

    setClock('09:30');
    expect(await timers.getState({ user: lee })).toMatchObject({
      blocked: null,
      onBreak: false,
      breakStartedAt: null,
    });
    // Starting a break today closes yesterday's by the midnight rule first.
    await attendance.startBreak({ user: lee });
    const [old, fresh] = await breaksOf(lee);
    expect(old).toMatchObject({ endReason: 'midnight', endedAt: at('16:00', YESTERDAY) });
    expect(fresh).toMatchObject({ workDate: TODAY, startedAt: at('09:30'), endedAt: null });
    expect(await timers.getState({ user: lee })).toMatchObject({ onBreak: true });
    setClock('09:40');
    await attendance.endBreak({ user: lee });
  });

  it('the close-open-timers job runs once per date after 00:05', async () => {
    forgetHandledKeysForTests();
    const fay = await person('Fay Job', { in: '09:30', date: YESTERDAY });
    setClock('10:00', YESTERDAY);
    await timers.start({ user: fay, projectId: acme.id });
    await db('attendance')
      .where({ userId: fay.id, workDate: YESTERDAY })
      .update({ checkOutAt: at('17:00', YESTERDAY), checkoutStatus: 'checked_out' });
    const gus = await person('Gus Job', { in: '09:30', date: YESTERDAY });
    setClock('15:00', YESTERDAY);
    await attendance.startBreak({ user: gus });

    setClock('00:04');
    expect(await closeOpenTimersJob.tick()).toBeNull();
    expect((await entriesOf(fay))[0].endedAt).toBeNull();

    setClock('00:06');
    expect(await closeOpenTimersJob.tick()).toEqual({
      status: 'done',
      result: { timers: 1, breaks: 1 },
    });
    expect((await entriesOf(fay))[0]).toMatchObject({
      stopReason: 'midnight',
      endedAt: at('17:00', YESTERDAY),
    });
    expect((await breaksOf(gus))[0]).toMatchObject({
      endReason: 'midnight',
      endedAt: at('15:00', YESTERDAY),
    });

    setClock('00:07');
    expect(await closeOpenTimersJob.tick()).toEqual({ status: 'skipped' });
    forgetHandledKeysForTests();
    expect(await closeOpenTimersJob.tick()).toEqual({ status: 'skipped' });
    const runs = await db('jobRuns').where({ runKey: `close_open_timers:${TODAY}` });
    expect(runs).toEqual([expect.objectContaining({ job: 'close-open-timers', status: 'done' })]);
  });
});

describe('timer entry edits and breaks', () => {
  let kim;
  let paused;
  let resumed;

  beforeAll(async () => {
    kim = await person('Kim Edit');
    setClock('10:00');
    await timers.start({ user: kim, projectId: acme.id });
    setClock('10:30');
    await attendance.startBreak({ user: kim });
    setClock('10:45');
    await attendance.endBreak({ user: kim });
    setClock('11:00');
    await timers.stop({ user: kim });
    [paused, resumed] = await entriesOf(kim);
  });

  beforeEach(() => setClock('11:30'));

  it('rejects moving an entry into a break', async () => {
    const later = await caught(
      timers.updateEntry({ user: kim, id: paused.id, input: { endClock: '10:40' } }),
    );
    expect(later.code).toBe('VALIDATION_FAILED');
    expect(later.fields.endClock).toMatch(/your break/);
    const earlier = await caught(
      timers.updateEntry({ user: kim, id: resumed.id, input: { startClock: '10:35' } }),
    );
    expect(earlier.code).toBe('VALIDATION_FAILED');
    expect(earlier.fields.startClock).toMatch(/your break/);
    expect(await entriesOf(kim)).toEqual([paused, resumed]);
  });

  it('rejects adding time inside a break, an open one too', async () => {
    const inside = await caught(
      timers.addEntry({
        user: kim,
        input: { projectId: beta.id, startClock: '10:32', endClock: '10:40' },
      }),
    );
    expect(inside.fields.startClock).toMatch(/your break/);
    await timers.addEntry({
      user: kim,
      input: { projectId: beta.id, startClock: '11:05', endClock: '11:20' },
    });

    await attendance.startBreak({ user: kim });
    setClock('11:45');
    const open = await caught(
      timers.addEntry({
        user: kim,
        input: { projectId: beta.id, startClock: '11:25', endClock: '11:40' },
      }),
    );
    expect(open.fields.endClock).toMatch(/your break, on/);
    await attendance.endBreak({ user: kim });
    expect(await entriesOf(kim)).toHaveLength(3);
  });
});

describe('timer reminders and breaks', () => {
  it('in required mode nobody on a break is reminded', async () => {
    await setSettings({ timers_mode: 'required', timer_reminder_minutes: 20 });
    const rex = await person('Rex Idle');
    const pia = await person('Pia Pause');
    setClock('09:10');
    await attendance.startBreak({ user: pia });
    setClock('09:40');
    await timers.sendReminders(TODAY);

    expect(await notesOf(rex, 'timer.reminder')).toHaveLength(1);
    expect(await notesOf(pia, 'timer.reminder')).toHaveLength(0);
  });
});
