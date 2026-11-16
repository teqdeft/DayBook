// Play on a to-do line (CONTRACT 24): reports.startTodoTimer against the real timers and
// attendance modules. Refused before check-in, on a break, after check-out, with timers off, on a
// project request, on an inactive project and on a Done line; a closed priority task is left out;
// the note is the first 200 characters of the title and the line remembers it, so Fill report from
// timers merges the timer into that line even after it is reworded; "Now" and Play in getTodo.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entriesFromView } from '@/app/(app)/report/reportState';
import { mergeTimerSummary } from '@/app/(app)/report/reportTimers';
import { db } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { reports } from '@/modules/reports';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject, createProjectRequest } from './dashboardKit.js';
import { addTask, caught, entriesOf, setClock, TODAY } from './timersKit.js';

let pm;
let emp;
let acme;

const add = (title, rest = {}) =>
  reports.addTodoLine({ user: emp, projectId: acme.id, title, ...rest });
const start = (id) => reports.startTodoTimer({ user: emp, id });

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  emp = { ...(await createUser({ name: 'Priya Sharma' })), initials: 'PS' };
  acme = await createProject(pm, { name: 'Pine Tree Lane' });
  await addMembers(acme, [emp]);
});

beforeEach(async () => {
  setClock('10:00');
  await setSettings({ timers_mode: 'optional' });
  await db('projects').where({ id: acme.id }).update({ status: 'active' });
  for (const table of ['timeEntries', 'attendanceBreaks', 'reportTasks', 'reportEntries']) {
    await db(table).del();
  }
  for (const table of ['dailyReports', 'attendance', 'projectTasks', 'projectRequests']) {
    await db(table).del();
  }
});

afterAll(async () => {
  await setSettings({ timers_mode: 'optional' });
});

describe('startTodoTimer', () => {
  it('starts a timer with the title as the note and shows the line as Now', async () => {
    await checkIn(emp, TODAY, { in: '09:00' });
    const before = await add('Monitor ads');
    expect(before.timer).toEqual({ canStart: true });
    expect(before.groups[0].lines[0]).toMatchObject({ now: false, canStart: true });

    const todo = await start(before.lineId);
    const [entry] = await entriesOf(emp);
    expect(entry).toMatchObject({ projectId: acme.id, note: 'Monitor ads', endedAt: null });
    expect(todo.groups[0].lines[0]).toMatchObject({ now: true, canStart: false });
    expect(todo.timerState).toMatchObject({ running: { projectId: acme.id, note: 'Monitor ads' } });
    expect(await db('reportTasks').where({ id: before.lineId }).first()).toMatchObject({
      timerNote: 'Monitor ads',
    });
    // Play again on the same line leaves the running timer as it is.
    await start(before.lineId);
    expect(await entriesOf(emp)).toHaveLength(1);
  });

  it('is refused before check-in, on a break, after check-out and with timers off', async () => {
    const { lineId } = await add('Monitor ads');
    expect(await caught(start(lineId))).toMatchObject({ code: 'NOT_CHECKED_IN' });

    await checkIn(emp, TODAY, { in: '09:00' });
    await attendance.startBreak({ user: emp });
    expect((await reports.getTodo({ user: emp })).timer.canStart).toBe(false);
    expect(await caught(start(lineId))).toMatchObject({
      code: 'ALREADY_ON_BREAK',
      status: 409,
      message: 'End your break to start a timer.',
    });
    expect(await attendance.getOpenBreak(emp.id)).toBeTruthy();

    await setSettings({ timers_mode: 'off' });
    expect(await caught(start(lineId))).toMatchObject({ code: 'TIMERS_OFF' });
    await setSettings({ timers_mode: 'optional' });

    await db('attendanceBreaks').del();
    await db('attendance')
      .where({ userId: emp.id })
      .update({ checkOutAt: new Date('2026-09-30T12:00:00Z'), checkoutStatus: 'checked_out' });
    expect(await caught(start(lineId))).toMatchObject({ code: 'ALREADY_CHECKED_OUT' });
    expect(await entriesOf(emp)).toEqual([]);
  });

  it('is refused on a project request, an inactive project and a Done line', async () => {
    await checkIn(emp, TODAY, { in: '09:00' });
    const request = await createProjectRequest(emp, { name: 'acme-blog' });
    const onRequest = await reports.addTodoLine({
      user: emp,
      projectRequestId: request.id,
      title: 'Blog post',
    });
    expect(await caught(start(onRequest.lineId))).toMatchObject({
      code: 'PROJECT_NOT_ACTIVE',
      message: 'Only active projects can be timed.',
    });

    const { lineId } = await add('Monitor ads');
    await reports.updateTodoLine({ user: emp, id: lineId, done: true });
    expect(await caught(start(lineId))).toMatchObject({
      code: 'CONFLICT',
      message: 'This task is done. Untick it to start a timer.',
    });

    const other = await add('Another task');
    await db('projects').where({ id: acme.id }).update({ status: 'on_hold' });
    expect((await reports.getTodo({ user: emp })).groups[1].lines[0].canStart).toBe(false);
    expect(await caught(start(other.lineId))).toMatchObject({
      code: 'PROJECT_NOT_ACTIVE',
      message: 'Only active projects can be timed.',
    });
    expect(await entriesOf(emp)).toEqual([]);
    expect(await caught(start(999999))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps an open priority task and leaves out a closed one', async () => {
    await checkIn(emp, TODAY, { in: '09:00' });
    const open = await addTask(acme, pm, { title: 'Header spacing' });
    const closing = await addTask(acme, pm, { title: 'Login timeout' });
    const first = await add('Header spacing', { projectTaskId: open });
    const second = await add('Login timeout', { projectTaskId: closing });
    await db('projectTasks').where({ id: closing }).update({ status: 'done' });

    await start(first.lineId);
    await start(second.lineId);
    const rows = await entriesOf(emp);
    expect(rows.map((row) => [row.projectTaskId, row.note])).toEqual([
      [open, 'Header spacing'],
      [null, 'Login timeout'],
    ]);
  });

  it('notes the first 200 characters of a long title, and Fill merges into that line', async () => {
    await checkIn(emp, TODAY, { in: '09:00' });
    const title = `${'Long '.repeat(59)}title`; // 300 characters
    expect(title).toHaveLength(300);
    const { lineId } = await add(title);
    setClock('10:00');
    await start(lineId);
    const note = title.slice(0, 200).trim();
    expect(note).toHaveLength(199); // the 200th character is a space
    const [entry] = await entriesOf(emp);
    expect(entry.note).toBe(note);
    expect((await db('reportTasks').where({ id: lineId }).first()).timerNote).toBe(note);
    expect((await reports.getTodo({ user: emp })).groups[0].lines[0].now).toBe(true);

    // Reworded later, the line still stands for the timer: Fill adds nothing.
    await reports.updateTodoLine({ user: emp, id: lineId, title: 'Shorter wording' });
    setClock('11:00');
    const view = await reports.openForDate({ user: emp, workDate: TODAY });
    const { summary } = await reports.getTimersForReport({ user: emp, reportId: view.id });
    const filled = mergeTimerSummary(entriesFromView(view), summary);
    expect(filled[0].tasks.map((task) => task.title)).toEqual(['Shorter wording']);
    expect(filled[0].hours).toBe('1h');

    // Without the note it remembers, the same Fill would add the timer's note as a new line.
    await db('reportTasks').where({ id: lineId }).update({ timerNote: null });
    const bare = await reports.openForDate({ user: emp, workDate: TODAY });
    const refilled = mergeTimerSummary(entriesFromView(bare), summary);
    expect(refilled[0].tasks.map((task) => task.title)).toEqual(['Shorter wording', note]);
  });

  it('gives a 200-character note for a title with no space there', async () => {
    await checkIn(emp, TODAY, { in: '09:00' });
    const { lineId } = await add('x'.repeat(300));
    await start(lineId);
    const [entry] = await entriesOf(emp);
    expect(entry.note).toHaveLength(200);
    expect((await db('reportTasks').where({ id: lineId }).first()).timerNote).toBe(entry.note);
  });
});
