// Required timer mode at submit (CONTRACT 15): report hours must equal the day's timer time to
// the minute (company request: no 15-minute rounding), give or take TIMER_TOLERANCE_MINUTES for a
// timer still running; every timed project must be in the report, project requests are exempt,
// and the check only runs in required mode, for people who can use timers, on days with time
// entries or today.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { TIMER_TOLERANCE_MINUTES as PAGE_TOLERANCE } from '@/app/(app)/report/reportTimers';
import { TIMER_TOLERANCE_MINUTES, timerProblems } from '@/modules/reports/timerCheck';
import { resetDatabase, setSettings } from '../helpers/db.js';
import {
  clearTables,
  clearTimerSummaries,
  createPeople,
  createProject,
  createProjectRequest,
  entriesFrom,
  fakeTimers,
  sessionUser,
  setTimerSummary,
} from './reportsTestKit.js';

vi.mock('@/modules/users', async () => ({
  users: (await import('./reportsTestKit.js')).fakeUsers,
}));
vi.mock('@/modules/projects', async () => ({
  projects: (await import('./reportsTestKit.js')).fakeProjects,
}));
vi.mock('@/modules/attendance', async () => ({
  attendance: (await import('./reportsTestKit.js')).fakeAttendance,
}));
vi.mock('@/modules/timers', async () => ({
  timers: (await import('./reportsTestKit.js')).fakeTimers,
}));

// Tuesday 29 September 2026, 9:30 AM in Asia/Kolkata. Monday's report is open until 12:00 today.
const TUESDAY_MORNING = '2026-09-29T04:00:00Z';
const MONDAY = '2026-09-28';
const TUESDAY = '2026-09-29';
const NO_TIMER_TIME = 'No timer time on this project today. Remove it or add time on Today.';

let people;
let user;
let internal;
let iwill;

function input(entries) {
  return saveReportSchema.parse({ entries }).entries;
}

function task(title) {
  return { title, status: 'in_progress' };
}

/** Today's (or another day's) draft with these entries, parsed as the API does. */
async function draftWith(entries, { workDate = TUESDAY, as = user } = {}) {
  const draft = await reports.openForDate({ user: as, workDate });
  return { draft, entries: input(entries) };
}

async function statusOf(reportId) {
  return (await db('dailyReports').where({ id: reportId }).first()).status;
}

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  user = sessionUser(people.person);
  internal = await createProject(people.pm, { name: 'internal-tool' });
  iwill = await createProject(people.pm, { name: 'iwilltillimwell', color: 'orange' });
});

beforeEach(async () => {
  await clearTables('report_revisions', 'report_edit_requests', 'slack_outbox', 'notifications');
  await clearTables('report_tasks', 'report_entries', 'daily_reports', 'project_requests');
  await setSettings({ timers_mode: 'required' });
  clearTimerSummaries();
  vi.restoreAllMocks();
  setNowForTests(TUESDAY_MORNING);
});

afterAll(async () => {
  await setSettings({ timers_mode: 'optional' });
});

describe('timerProblems (the rules on their own)', () => {
  const summary = {
    projects: [
      { projectId: 1, projectName: 'acme-app', roundedMinutes: 255 },
      { projectId: 2, projectName: 'acme-blog', roundedMinutes: 90 },
      { projectId: 3, projectName: 'tiny', roundedMinutes: 0 },
    ],
  };

  it('accepts a report whose hours are the timer hours', () => {
    const entries = [
      { projectId: 1, minutes: 255 },
      { projectId: 2, minutes: 90 },
    ];
    expect(timerProblems(entries, summary)).toEqual({});
  });

  it('names each wrong field with the exact texts', () => {
    const entries = [
      { projectId: 1, minutes: 240 },
      { projectId: 3, minutes: 15 },
      { projectId: 9, minutes: 60 },
      { projectRequestId: 4, minutes: 120 },
    ];
    expect(timerProblems(entries, summary)).toEqual({
      'entries.0.hours': 'Hours come from your timers (4h 15m).',
      'entries.1.hours': NO_TIMER_TIME,
      'entries.2.hours': NO_TIMER_TIME,
      total: 'acme-blog has 1h 30m on your timers. Fill the report from timers.',
    });
  });

  it('asks for the biggest missing project and never for one with 0 minutes', () => {
    expect(timerProblems([], summary)).toEqual({
      total: 'acme-app has 4h 15m on your timers. Fill the report from timers.',
    });
    expect(timerProblems([{ projectId: 1, minutes: 255 }], summary)).toEqual({
      total: 'acme-blog has 1h 30m on your timers. Fill the report from timers.',
    });
  });

  it('compares to the minute, allowing a 2-minute difference either way', () => {
    // The page and the server agree on the tolerance.
    expect(TIMER_TOLERANCE_MINUTES).toBe(2);
    expect(PAGE_TOLERANCE).toBe(TIMER_TOLERANCE_MINUTES);
    const timed = { projects: [{ projectId: 1, projectName: 'acme-app', roundedMinutes: 125 }] };
    const at = (minutes) => timerProblems([{ projectId: 1, minutes }], timed);
    for (const minutes of [123, 124, 125, 126, 127]) expect(at(minutes)).toEqual({});
    expect(at(120)).toEqual({ 'entries.0.hours': 'Hours come from your timers (2h 5m).' });
    expect(at(122)).toEqual({ 'entries.0.hours': 'Hours come from your timers (2h 5m).' });
    expect(at(128)).toEqual({ 'entries.0.hours': 'Hours come from your timers (2h 5m).' });
  });

  it('does not ask for a project timed for no more than the tolerance', () => {
    const summary = {
      projects: [
        { projectId: 1, projectName: 'acme-app', roundedMinutes: 60 },
        { projectId: 2, projectName: 'quick-call', roundedMinutes: 2 },
      ],
    };
    expect(timerProblems([{ projectId: 1, minutes: 60 }], summary)).toEqual({});
    summary.projects[1].roundedMinutes = 3;
    expect(timerProblems([{ projectId: 1, minutes: 60 }], summary)).toEqual({
      total: 'quick-call has 3m on your timers. Fill the report from timers.',
    });
  });
});

describe('optional mode', () => {
  it('never checks the report against timers', async () => {
    await setSettings({ timers_mode: 'optional' });
    setTimerSummary(user.id, TUESDAY, [
      { projectId: iwill.id, projectName: 'iwilltillimwell', roundedMinutes: 90 },
    ]);
    const summary = vi.spyOn(fakeTimers, 'getDaySummary');
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 8, tasks: [task('Working on backend')] },
    ]);
    const submitted = await reports.submitReport({ user, reportId: draft.id, entries });
    expect(submitted).toMatchObject({ status: 'submitted', totalMinutes: 480 });
    expect(summary).not.toHaveBeenCalled();
  });

  it('is off too when timers are off', async () => {
    await setSettings({ timers_mode: 'off' });
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 2, tasks: [task('Working on backend')] },
    ]);
    await expect(
      reports.submitReport({ user, reportId: draft.id, entries }),
    ).resolves.toMatchObject({ status: 'submitted' });
  });
});

describe('required mode', () => {
  it('submits when every project has its timer hours', async () => {
    setTimerSummary(user.id, TUESDAY, [
      { projectId: internal.id, projectName: 'internal-tool', roundedMinutes: 255 },
      { projectId: iwill.id, projectName: 'iwilltillimwell', roundedMinutes: 90 },
    ]);
    const { draft, entries } = await draftWith([
      { projectId: iwill.id, hours: 1.5, tasks: [task('Content changes')] },
      { projectId: internal.id, hours: 4.25, tasks: [task('Working on backend')] },
    ]);
    const submitted = await reports.submitReport({ user, reportId: draft.id, entries });
    expect(submitted).toMatchObject({ status: 'submitted', totalMinutes: 345 });
  });

  it('refuses hours that differ from the timers, under that project', async () => {
    setTimerSummary(user.id, TUESDAY, [
      { projectId: internal.id, projectName: 'internal-tool', roundedMinutes: 255 },
    ]);
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 4, tasks: [task('Working on backend')] },
    ]);
    await expect(
      reports.submitReport({ user, reportId: draft.id, entries, baseVersion: draft.version }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Hours come from your timers (4h 15m).',
      fields: { 'entries.0.hours': 'Hours come from your timers (4h 15m).' },
    });
    expect(await statusOf(draft.id)).toBe('draft');
  });

  it('submits a 2h 5m timer as 2h 5m (no 15-minute rounding)', async () => {
    setTimerSummary(user.id, TUESDAY, [
      { projectId: internal.id, projectName: 'internal-tool', roundedMinutes: 125 },
    ]);
    const rounded = await draftWith([
      { projectId: internal.id, minutes: 120, tasks: [task('Working on backend')] },
    ]);
    await expect(
      reports.submitReport({ user, reportId: rounded.draft.id, entries: rounded.entries }),
    ).rejects.toMatchObject({
      fields: { 'entries.0.hours': 'Hours come from your timers (2h 5m).' },
    });
    const exact = await draftWith([
      { projectId: internal.id, minutes: 125, tasks: [task('Working on backend')] },
    ]);
    await expect(
      reports.submitReport({ user, reportId: exact.draft.id, entries: exact.entries }),
    ).resolves.toMatchObject({ status: 'submitted', totalMinutes: 125 });
  });

  it('takes hours up to 2 minutes behind a timer that kept running, and no more', async () => {
    // The page read 2h 5m; the timer ran on to 2h 7m before the submit arrived.
    setTimerSummary(user.id, TUESDAY, [
      { projectId: internal.id, projectName: 'internal-tool', minutes: 128, roundedMinutes: 128 },
    ]);
    const late = await draftWith([
      { projectId: internal.id, minutes: 125, tasks: [task('Working on backend')] },
    ]);
    await expect(
      reports.submitReport({ user, reportId: late.draft.id, entries: late.entries }),
    ).rejects.toMatchObject({
      fields: { 'entries.0.hours': 'Hours come from your timers (2h 8m).' },
    });
    setTimerSummary(user.id, TUESDAY, [
      { projectId: internal.id, projectName: 'internal-tool', minutes: 127, roundedMinutes: 127 },
    ]);
    // The report keeps the hours that were sent (the page's), not the timers' at that moment.
    await expect(
      reports.submitReport({ user, reportId: late.draft.id, entries: late.entries }),
    ).resolves.toMatchObject({ status: 'submitted', totalMinutes: 125 });
  });

  it('refuses a project without timer time, also on a day nothing was timed yet', async () => {
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 2, tasks: [task('Working on backend')] },
    ]);
    await expect(reports.submitReport({ user, reportId: draft.id, entries })).rejects.toMatchObject(
      { code: 'VALIDATION_FAILED', fields: { 'entries.0.hours': NO_TIMER_TIME } },
    );
  });

  it('refuses a report that leaves out a timed project', async () => {
    setTimerSummary(user.id, TUESDAY, [
      { projectId: internal.id, projectName: 'internal-tool', roundedMinutes: 120 },
      { projectId: iwill.id, projectName: 'iwilltillimwell', roundedMinutes: 90 },
    ]);
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 2, tasks: [task('Working on backend')] },
    ]);
    await expect(reports.submitReport({ user, reportId: draft.id, entries })).rejects.toMatchObject(
      {
        code: 'VALIDATION_FAILED',
        fields: {
          total: 'iwilltillimwell has 1h 30m on your timers. Fill the report from timers.',
        },
      },
    );
  });

  it('does not ask for a project timed for under the tolerance (a timer just started)', async () => {
    setTimerSummary(user.id, TUESDAY, [
      { projectId: internal.id, projectName: 'internal-tool', roundedMinutes: 60 },
      { projectId: iwill.id, projectName: 'iwilltillimwell', minutes: 1, roundedMinutes: 1 },
    ]);
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 1, tasks: [task('Working on backend')] },
    ]);
    await expect(
      reports.submitReport({ user, reportId: draft.id, entries }),
    ).resolves.toMatchObject({ status: 'submitted' });
  });

  it('leaves entries for pending project requests out of the check', async () => {
    const request = await createProjectRequest(people.person, { name: 'acme-blog' });
    setTimerSummary(user.id, TUESDAY, [
      { projectId: internal.id, projectName: 'internal-tool', roundedMinutes: 60 },
    ]);
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 1, tasks: [task('Working on backend')] },
      { projectRequestId: request.id, hours: 3, tasks: [task('First posts')] },
    ]);
    const submitted = await reports.submitReport({ user, reportId: draft.id, entries });
    expect(submitted).toMatchObject({ status: 'submitted', totalMinutes: 240 });
  });

  it('puts the timer message on a field the basic rules also flag, and keeps the others', async () => {
    const { draft, entries } = await draftWith([{ projectId: internal.id, hours: 0, tasks: [] }]);
    await expect(reports.submitReport({ user, reportId: draft.id, entries })).rejects.toMatchObject(
      {
        message: NO_TIMER_TIME,
        fields: { 'entries.0.hours': NO_TIMER_TIME, 'entries.0.tasks': 'Add at least one task.' },
      },
    );
  });

  it('still saves the draft when a caller without a version is refused', async () => {
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 2, tasks: [task('Working on backend')] },
    ]);
    await expect(reports.submitReport({ user, reportId: draft.id, entries })).rejects.toMatchObject(
      { code: 'VALIDATION_FAILED' },
    );
    const saved = await db('reportEntries').where({ reportId: draft.id });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ projectId: internal.id, minutes: 120 });
    expect(await statusOf(draft.id)).toBe('draft');
  });

  it('checks the stored entries when the submit sends none', async () => {
    setTimerSummary(user.id, TUESDAY, [
      { projectId: internal.id, projectName: 'internal-tool', roundedMinutes: 90 },
    ]);
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 2, tasks: [task('Working on backend')] },
    ]);
    await reports.saveReport({ user, reportId: draft.id, entries });
    await expect(reports.submitReport({ user, reportId: draft.id })).rejects.toMatchObject({
      fields: { 'entries.0.hours': 'Hours come from your timers (1h 30m).' },
    });
    expect(await statusOf(draft.id)).toBe('draft');
  });

  it('checks every later save of a submitted report too', async () => {
    setTimerSummary(user.id, TUESDAY, [
      { projectId: internal.id, projectName: 'internal-tool', roundedMinutes: 120 },
    ]);
    const { draft, entries } = await draftWith([
      { projectId: internal.id, hours: 2, tasks: [task('Working on backend')] },
    ]);
    const submitted = await reports.submitReport({ user, reportId: draft.id, entries });
    const changed = entriesFrom(submitted);
    changed[0].hours = 3;
    await expect(
      reports.saveReport({ user, reportId: draft.id, entries: input(changed) }),
    ).rejects.toMatchObject({
      fields: { 'entries.0.hours': 'Hours come from your timers (2h).' },
    });
    const row = await db('dailyReports').where({ id: draft.id }).first();
    expect(row).toMatchObject({ status: 'submitted', revision: 1, totalMinutes: 120 });
  });

  it("checks an earlier day's report when that day has time entries", async () => {
    setTimerSummary(user.id, MONDAY, [
      { projectId: internal.id, projectName: 'internal-tool', roundedMinutes: 480 },
    ]);
    const { draft, entries } = await draftWith(
      [{ projectId: internal.id, hours: 7, tasks: [task('Working on backend')] }],
      { workDate: MONDAY },
    );
    await expect(reports.submitReport({ user, reportId: draft.id, entries })).rejects.toMatchObject(
      { fields: { 'entries.0.hours': 'Hours come from your timers (8h).' } },
    );
  });

  it("leaves an earlier day's report without time entries alone", async () => {
    const { draft, entries } = await draftWith(
      [{ projectId: internal.id, hours: 7, tasks: [task('Working on backend')] }],
      { workDate: MONDAY },
    );
    const submitted = await reports.submitReport({ user, reportId: draft.id, entries });
    expect(submitted).toMatchObject({ status: 'submitted', workDate: MONDAY, totalMinutes: 420 });
  });

  it("doesn't apply to someone who can't use timers (an Admin who doesn't check in)", async () => {
    const admin = sessionUser(people.admin);
    const summary = vi.spyOn(fakeTimers, 'getDaySummary');
    const { draft, entries } = await draftWith(
      [{ projectId: internal.id, hours: 3, tasks: [task('Planning')] }],
      { as: admin },
    );
    const submitted = await reports.submitReport({ user: admin, reportId: draft.id, entries });
    expect(submitted).toMatchObject({ status: 'submitted', totalMinutes: 180 });
    expect(summary).not.toHaveBeenCalled();
  });
});
