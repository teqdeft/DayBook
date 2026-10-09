// The daily report against the real timers module (CONTRACT 15): the timers the report page gets
// (reports.timersForReport / getTimersForReport, GET /api/reports/:id/timers) follow the same
// "required applies" rule as the submit, a running timer is read as it is now, a project that
// stopped being active after someone timed it can still go into that day's report, and Fill report
// from timers never links a priority task that is done since.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entriesFromView, serialize } from '@/app/(app)/report/reportState';
import { mergeTimerSummary } from '@/app/(app)/report/reportTimers';
import { db } from '@/lib/db';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, checkIn, createProject } from './dashboardKit.js';
import { addTask, caught, insertEntry, setClock, TODAY, YESTERDAY } from './timersKit.js';

let pm;
let emp;
let colleague;
let acme;
let beta;

const parse = (entries) => saveReportSchema.parse({ entries }).entries;
const card = (project, hours, title = 'Worked on it') => ({
  projectId: project.id,
  hours,
  tasks: [{ title, status: 'done' }],
});

async function submit(user, reportId, entries) {
  return reports.submitReport({ user, reportId, entries: parse(entries) });
}

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  emp = { ...(await createUser({ name: 'Emma Dev' })), initials: 'ED' };
  colleague = { ...(await createUser({ name: 'Priya Sharma' })), initials: 'PS' };
  acme = await createProject(pm, { name: 'acme-app' });
  beta = await createProject(pm, { name: 'beta' });
  await addMembers(acme, [emp, colleague]);
  await addMembers(beta, [emp, colleague]);
});

beforeEach(async () => {
  await setSettings({ timers_mode: 'required' });
  await db('reportTasks').del();
  await db('reportEntries').del();
  await db('reportRevisions').del();
  await db('slack_outbox').del();
  await db('dailyReports').del();
  await db('timeEntries').del();
  await db('attendance').del();
  await db('projects').whereIn('id', [acme.id, beta.id]).update({ status: 'active' });
});

afterAll(async () => {
  await setSettings({ timers_mode: 'optional' });
});

describe('the timers the report page gets', () => {
  it('only makes hours come from timers where the submit checks them', async () => {
    // 9:30 AM: yesterday's report is still open (until 12:00), nobody timed yesterday.
    setClock('09:30');
    await checkIn(emp, TODAY, { in: '09:00' });
    const yesterday = await reports.openForDate({ user: emp, workDate: YESTERDAY });
    const today = await reports.openForDate({ user: emp, workDate: TODAY });
    expect(await reports.timersForReport({ user: emp, report: yesterday })).toEqual({
      mode: 'required',
      required: false,
      summary: { totalMinutes: 0, projects: [] },
    });
    expect(await reports.timersForReport({ user: emp, report: today })).toMatchObject({
      mode: 'required',
      required: true,
    });
    // ...and the server takes typed hours on yesterday's report, as the page now lets them.
    await expect(submit(emp, yesterday.id, [card(acme, 7)])).resolves.toMatchObject({
      status: 'submitted',
      totalMinutes: 420,
    });
  });

  it('makes an earlier day required once it has time entries', async () => {
    setClock('09:30');
    await insertEntry(emp, acme, { from: '10:00', to: '12:00', date: YESTERDAY });
    const yesterday = await reports.openForDate({ user: emp, workDate: YESTERDAY });
    expect(await reports.timersForReport({ user: emp, report: yesterday })).toMatchObject({
      required: true,
      summary: { projects: [{ projectId: acme.id, roundedMinutes: 120 }] },
    });
    expect((await caught(submit(emp, yesterday.id, [card(acme, 7)]))).fields).toEqual({
      'entries.0.hours': 'Hours come from your timers (2h).',
    });
  });

  it('is optional (never required) in optional mode, and null when timers are off', async () => {
    setClock('09:30');
    const today = await reports.openForDate({ user: emp, workDate: TODAY });
    await setSettings({ timers_mode: 'optional' });
    expect(await reports.timersForReport({ user: emp, report: today })).toMatchObject({
      mode: 'optional',
      required: false,
    });
    await setSettings({ timers_mode: 'off' });
    expect(await reports.timersForReport({ user: emp, report: today })).toBeNull();
  });

  it('reads a running timer as it is now, so the hours a submit sends match', async () => {
    await checkIn(emp, TODAY, { in: '09:30' });
    await insertEntry(emp, acme, { from: '12:00', note: 'Login page' }); // still running
    setClock('18:00'); // the page loads: 6h on the timer
    const draft = await reports.openForDate({ user: emp, workDate: TODAY });
    const loaded = await reports.timersForReport({ user: emp, report: draft });
    expect(loaded.summary.projects[0].roundedMinutes).toBe(360);

    setClock('18:08'); // 6h 08m rounds to 6.25h: the page's copy is out of date
    expect((await caught(submit(emp, draft.id, [card(acme, 6)]))).fields).toEqual({
      'entries.0.hours': 'Hours come from your timers (6.25h).',
    });
    // Before submitting, the page reads the timers again and takes their hours.
    const fresh = await reports.getTimersForReport({ user: emp, reportId: draft.id });
    expect(fresh).toMatchObject({ required: true });
    const hours = fresh.summary.projects[0].roundedMinutes / 60;
    expect(hours).toBe(6.25);
    await expect(submit(emp, draft.id, [card(acme, hours)])).resolves.toMatchObject({
      status: 'submitted',
      totalMinutes: 375,
    });
  });

  it("refuses someone else's report and gives null once the report has locked", async () => {
    setClock('09:30');
    const yesterday = await reports.openForDate({ user: emp, workDate: YESTERDAY });
    expect(
      (await caught(reports.getTimersForReport({ user: colleague, reportId: yesterday.id }))).code,
    ).toBe('FORBIDDEN');
    setClock('12:30'); // yesterday's report locked at 12:00
    expect(await reports.getTimersForReport({ user: emp, reportId: yesterday.id })).toBeNull();
  });
});

describe('a timed project that stopped being active', () => {
  it("goes into today's report in required mode, and an untimed one still can't", async () => {
    await checkIn(emp, TODAY, { in: '09:30' });
    await insertEntry(emp, beta, { from: '10:00', to: '11:00' });
    await insertEntry(emp, acme, { from: '11:00', to: '13:00' });
    setClock('18:00');
    const draft = await reports.openForDate({ user: emp, workDate: TODAY });
    await db('projects').where({ id: beta.id }).update({ status: 'completed' });

    const leftOut = await caught(submit(emp, draft.id, [card(acme, 2)]));
    expect(leftOut.fields).toEqual({
      total: 'beta has 1h on your timers. Fill the report from timers.',
    });
    await expect(submit(emp, draft.id, [card(acme, 2), card(beta, 1)])).resolves.toMatchObject({
      status: 'submitted',
      totalMinutes: 180,
    });

    // A project the person never timed that day is still refused once it isn't active.
    const other = await createProject(pm, { name: 'gamma', status: 'on_hold' });
    await setSettings({ timers_mode: 'optional' });
    const refused = await caught(submit(emp, draft.id, [card(acme, 2), card(other, 1)]));
    expect(refused).toMatchObject({
      code: 'PROJECT_NOT_ACTIVE',
      fields: { 'entries.1.project': 'Only active projects can be picked.' },
    });
  });

  it("goes into yesterday's still-open report, whose time can no longer be changed", async () => {
    await checkIn(emp, YESTERDAY, { in: '09:30', out: '18:30' });
    await insertEntry(emp, beta, { from: '10:00', to: '11:00', date: YESTERDAY });
    await insertEntry(emp, acme, { from: '11:00', to: '13:00', date: YESTERDAY });
    await db('projects').where({ id: beta.id }).update({ status: 'on_hold' });
    setClock('09:30'); // open until 12:00
    const draft = await reports.openForDate({ user: emp, workDate: YESTERDAY });
    await expect(submit(emp, draft.id, [card(acme, 2), card(beta, 1)])).resolves.toMatchObject({
      status: 'submitted',
      workDate: YESTERDAY,
      totalMinutes: 180,
    });
  });

  it('can be autosaved in optional mode (Fill report from timers adds its card)', async () => {
    await setSettings({ timers_mode: 'optional' });
    await checkIn(emp, TODAY, { in: '09:30' });
    await insertEntry(emp, beta, { from: '10:00', to: '11:00' });
    setClock('18:00');
    const draft = await reports.openForDate({ user: emp, workDate: TODAY });
    await db('projects').where({ id: beta.id }).update({ status: 'completed' });
    const saved = await reports.saveReport({
      user: emp,
      reportId: draft.id,
      entries: parse([card(beta, 1)]),
    });
    expect(saved.entries.map((entry) => [entry.projectId, entry.hours])).toEqual([[beta.id, 1]]);
  });
});

describe('Fill report from timers after a timed priority task is done', () => {
  it('fills a plain line for it, and the report saves and submits', async () => {
    const login = await addTask(acme, pm, { title: 'Fix login timeout' });
    const header = await addTask(acme, pm, { title: 'Polish header', priority: 'p2' });
    await checkIn(emp, TODAY, { in: '09:30' });
    await insertEntry(emp, acme, { from: '10:00', to: '11:00', projectTaskId: login });
    await insertEntry(emp, acme, {
      from: '11:00',
      to: '11:30',
      projectTaskId: header,
      note: 'Header spacing',
    });
    await db('projectTasks').where({ id: login }).update({ status: 'done' });
    setClock('18:00');
    const draft = await reports.openForDate({ user: emp, workDate: TODAY });
    // The page: read the timers, Fill report from timers, then save what the editor sends.
    const { summary } = await reports.getTimersForReport({ user: emp, reportId: draft.id });
    const { body } = serialize(mergeTimerSummary(entriesFromView(draft), summary));
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ projectId: acme.id, hours: 1.5 });
    expect(body[0].tasks.map((task) => [task.title, task.projectTaskId])).toEqual([
      ['Fix login timeout', undefined],
      ['Header spacing', header],
    ]);
    const saved = await reports.saveReport({ user: emp, reportId: draft.id, entries: parse(body) });
    expect(saved.entries[0].tasks.map((task) => [task.title, task.projectTaskId ?? null])).toEqual([
      ['Fix login timeout', null],
      ['Header spacing', header],
    ]);
    await expect(submit(emp, draft.id, body)).resolves.toMatchObject({
      status: 'submitted',
      totalMinutes: 90,
    });
  });
});
