// Planned projects (CONTRACT 24 company rule, overriding submit.js and timerCheck.js): a project
// at 0 minutes with no Done line may be submitted next to worked projects. It stays in the report,
// so its tasks are suggested next time, but it is left out of the Slack text, the hour readers and
// the AI PM summary's lines. A Done line at 0 hours still needs hours, a report of planned projects
// only still needs hours, and a 0-hour project with no tasks is dropped like empty rows.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { listSubmittedLines } from '@/modules/aiSummaries/repo';
import { dayRows } from '@/app/(app)/log/logView';
import { resetDatabase, setSettings } from '../helpers/db.js';
import {
  clearTables,
  createPeople,
  createProject,
  outboxRows,
  sessionUser,
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

// Tuesday 29 September 2026, 9:30 AM in Asia/Kolkata; Wednesday the next morning.
const TUESDAY_MORNING = '2026-09-29T04:00:00Z';
const WEDNESDAY_MORNING = '2026-09-30T04:00:00Z';
const TUESDAY = '2026-09-29';
const WEDNESDAY = '2026-09-30';

let people;
let user;
let internal;
let iwill;

function input(entries) {
  return saveReportSchema.parse({ entries }).entries;
}

const task = (title, status = 'in_progress') => ({ title, status });

/** Submits today's draft with these entries; resolves to the view or rejects with the error. */
async function submit(entries) {
  const draft = await reports.openForDate({ user });
  return reports.submitReport({ user, reportId: draft.id, entries: input(entries) });
}

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  user = sessionUser(people.person);
  internal = await createProject(people.pm, { name: 'internal-tool' });
  iwill = await createProject(people.pm, { name: 'iwilltillimwell' });
  await setSettings({
    slack_report_channel_id: 'C0DAILY',
    slack_report_channel_name: 'daily-reports',
  });
});

beforeEach(async () => {
  await clearTables('report_revisions', 'report_edit_requests', 'slack_outbox', 'notifications');
  await clearTables('report_tasks', 'report_entries', 'daily_reports');
  setNowForTests(TUESDAY_MORNING);
});

describe('a planned project', () => {
  it('is submitted at 0 hours, left out of Slack, and its tasks are suggested tomorrow', async () => {
    const submitted = await submit([
      {
        projectId: internal.id,
        minutes: 150,
        tasks: [task('Working on backend', 'done'), task('API docs')],
      },
      {
        projectId: iwill.id,
        minutes: 0,
        tasks: [task('Payment page'), task('Checkout copy', 'blocked')],
      },
    ]);

    expect(submitted).toMatchObject({ status: 'submitted', totalMinutes: 150, revision: 1 });
    expect(submitted.entries.map((entry) => [entry.projectName, entry.minutes])).toEqual([
      ['internal-tool', 150],
      ['iwilltillimwell', 0],
    ]);
    // The revision keeps the whole report; the Slack text has the worked project only.
    const [revision] = await db('reportRevisions').where({ reportId: submitted.id });
    expect(parseJson(revision.snapshot).entries).toHaveLength(2);
    const [post] = await outboxRows();
    expect(post.payload.text).toContain('Project: internal-tool\nHours: 2h 30m\nTasks');
    expect(post.payload.text).not.toContain('iwilltillimwell');
    expect(post.payload.text).not.toContain('Payment page');

    setNowForTests(WEDNESDAY_MORNING);
    const tomorrow = await reports.listCarrySuggestions({ userId: user.id, date: WEDNESDAY });
    expect(
      Object.fromEntries(
        Object.entries(tomorrow).map(([key, tasks]) => [key, tasks.map((t) => t.title)]),
      ),
    ).toEqual({
      [`p${internal.id}`]: ['API docs'],
      [`p${iwill.id}`]: ['Payment page', 'Checkout copy'],
    });
  });

  it('is never presented as worked: hours, last update, My log and the AI PM summary', async () => {
    await submit([
      { projectId: internal.id, minutes: 90, tasks: [task('Working on backend')] },
      { projectId: iwill.id, minutes: 0, tasks: [task('Payment page')] },
    ]);
    const range = { from: '2026-09-01', to: '2026-09-30', userId: user.id };

    expect(await reports.getMinutesByProject(range)).toEqual({ [internal.id]: 90 });
    expect(await reports.listMinutesByProject(range)).toEqual([
      expect.objectContaining({ projectId: internal.id, minutes: 90 }),
    ]);
    expect(await reports.getLastReportDateByProject(user.id)).toEqual({ [internal.id]: TUESDAY });

    const log = await reports.getMonthLog({ user, month: '2026-09' });
    const [today] = dayRows(log);
    expect(today.projects.map((project) => project.name)).toEqual(['internal-tool']);
    // Its open task may be listed, without hours.
    expect(today.tasks.map((row) => [row.project?.name ?? null, row.hours, row.title])).toEqual([
      ['internal-tool', '1h 30m', 'Working on backend'],
      ['iwilltillimwell', null, 'Payment page'],
    ]);
    const workbook = reports.monthLogWorkbook(log);
    const days = workbook.sheets[0].rows;
    expect(days.find((row) => row.date === TUESDAY).projects).toBe('internal-tool');
    expect(workbook.sheets[1].rows.map((row) => [row.project, row.hours])).toEqual([
      ['internal-tool', 1.5],
      ['iwilltillimwell', ''],
    ]);

    const lines = await listSubmittedLines(TUESDAY, [internal.id, iwill.id]);
    expect(lines.map((line) => [line.projectId, line.title])).toEqual([
      [internal.id, 'Working on backend'],
    ]);
  });

  it('with a Done line still needs hours', async () => {
    const error = await submit([
      { projectId: internal.id, minutes: 60, tasks: [task('Working on backend')] },
      { projectId: iwill.id, minutes: 0, tasks: [task('Payment page', 'done')] },
    ]).catch((caught) => caught);
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Hours must be above 0.',
      fields: { 'entries.1.hours': 'Hours must be above 0.' },
    });
  });

  it('needs at least one worked project beside it', async () => {
    const error = await submit([
      { projectId: internal.id, minutes: 0, tasks: [task('Working on backend')] },
      { projectId: iwill.id, minutes: 0, tasks: [task('Payment page', 'blocked')] },
    ]).catch((caught) => caught);
    expect(error.fields).toEqual({
      'entries.0.hours': 'Hours must be above 0.',
      'entries.1.hours': 'Hours must be above 0.',
    });
  });
});

describe('a 0-hour project with no tasks', () => {
  it('is dropped on submit, like empty task rows', async () => {
    const submitted = await submit([
      { projectId: internal.id, minutes: 60, tasks: [task('Working on backend'), task('  ')] },
      { projectId: iwill.id, minutes: 0, tasks: [task('')] },
    ]);
    expect(submitted.entries.map((entry) => entry.projectName)).toEqual(['internal-tool']);
    expect(submitted.entries[0].tasks.map((t) => t.title)).toEqual(['Working on backend']);
    expect(
      await db('reportEntries').where({ reportId: submitted.id }).count({ n: '*' }).first(),
    ).toEqual({ n: 1 });
  });

  it('alone is still "Add at least one project"', async () => {
    const error = await submit([{ projectId: iwill.id, minutes: 0, tasks: [] }]).catch((e) => e);
    expect(error.fields).toEqual({ entries: 'Add at least one project before you submit.' });
  });
});
