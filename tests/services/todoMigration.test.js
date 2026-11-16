// Migration 017 (CONTRACT 24): its columns and types, and up, down, up keeping existing data. Then
// deploy before migrate: before 017 the suggestions still read (closed lines can't be told apart,
// one warning), a carried line still saves, and "Done already" answers TODO_UNAVAILABLE; once the
// migration has run everything works again without a restart.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { resetDatabase } from '../helpers/db.js';
import { createPeople, createProject, insertReport, sessionUser } from './reportsTestKit.js';

vi.mock('@/modules/users', async () => ({
  users: (await import('./reportsTestKit.js')).fakeUsers,
}));
vi.mock('@/modules/projects', async () => ({
  projects: (await import('./reportsTestKit.js')).fakeProjects,
}));
vi.mock('@/modules/attendance', async () => ({
  attendance: (await import('./reportsTestKit.js')).fakeAttendance,
}));

const MIGRATION = '017_todo.js';
// Tuesday 29 September 2026, 9:30 AM in Asia/Kolkata.
const TUESDAY_MORNING = '2026-09-29T04:00:00Z';
const TUESDAY = '2026-09-29';
const MONDAY = '2026-09-28';

const NEW_COLUMNS = {
  daily_reports: {
    todo_posted_at: 'datetime',
    todo_slack_channel_id: 'varchar(32)',
    todo_slack_ts: 'varchar(32)',
    todo_post_hash: 'char(64)',
  },
  report_tasks: {
    carry_closed_at: 'datetime',
    carry_closed_reason: "enum('done','dropped')",
  },
};

let people;
let user;
let internal;
let monday;

/** { column: { type, nullable } } of the table's columns of migration 017 that exist. */
async function columns(table) {
  const [rows] = await db.raw(
    'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable ' +
      'FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
    [table],
  );
  const wanted = Object.keys(NEW_COLUMNS[table]);
  return Object.fromEntries(
    rows
      .filter((row) => wanted.includes(row.name))
      .map((row) => [row.name, { type: row.type.toLowerCase(), nullable: row.nullable }]),
  );
}

const expected = (table) =>
  Object.fromEntries(
    Object.entries(NEW_COLUMNS[table]).map(([name, type]) => [name, { type, nullable: 'YES' }]),
  );

/** The rows 017 must never change. */
async function existingData() {
  return {
    reports: await db('dailyReports')
      .orderBy('id')
      .select('id', 'userId', 'workDate', 'status', 'totalMinutes', 'slackChannelId', 'slackTs'),
    tasks: await db('reportTasks')
      .orderBy('id')
      .select('id', 'entryId', 'title', 'status', 'carriedFromTaskId', 'timerNote'),
  };
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(TUESDAY_MORNING);
  people = await createPeople();
  user = sessionUser(people.person);
  internal = await createProject(people.pm, { name: 'internal-tool' });
  monday = await insertReport(people.person, MONDAY, {
    slackChannelId: 'C0DAILY',
    slackTs: '1727500000.000100',
    entries: [
      {
        project: internal,
        minutes: 480,
        tasks: [
          { title: 'Working on backend', status: 'in_progress' },
          { title: 'Closed before', status: 'blocked' },
          { title: 'Shipped login', status: 'done' },
        ],
      },
    ],
  });
  await db('reportTasks').where({ id: monday.taskIds[0] }).update({ timerNote: 'Backend' });
});

afterAll(async () => {
  // Leave the test database migrated for the next file.
  await db.migrate.latest();
});

describe('migration 017', () => {
  it('adds nullable columns with the right types, and the Slack ones match the report ones', async () => {
    expect(await columns('daily_reports')).toEqual(expected('daily_reports'));
    expect(await columns('report_tasks')).toEqual(expected('report_tasks'));
    const [[slack]] = await db.raw(
      'SELECT COLUMN_TYPE AS type FROM information_schema.columns ' +
        "WHERE table_schema = DATABASE() AND table_name = 'daily_reports' " +
        "AND column_name = 'slack_channel_id'",
    );
    expect(slack.type.toLowerCase()).toBe(NEW_COLUMNS.daily_reports.todo_slack_channel_id);
  });

  it('goes down and up again keeping the existing rows', async () => {
    const before = await existingData();
    await db('reportTasks')
      .where({ id: monday.taskIds[1] })
      .update({ carryClosedAt: new Date(), carryClosedReason: 'dropped' });

    await db.migrate.down({ name: MIGRATION });
    expect(await columns('daily_reports')).toEqual({});
    expect(await columns('report_tasks')).toEqual({});
    expect(await existingData()).toEqual(before);

    await db.migrate.up({ name: MIGRATION });
    expect(await columns('daily_reports')).toEqual(expected('daily_reports'));
    expect(await columns('report_tasks')).toEqual(expected('report_tasks'));
    expect(await existingData()).toEqual(before);
    // The new columns start empty again.
    expect(await db('reportTasks').whereNotNull('carryClosedAt')).toEqual([]);
  });
});

describe('before migration 017 (deploy before migrate)', () => {
  const warnings = [];

  beforeAll(async () => {
    await db.migrate.down({ name: MIGRATION });
    vi.spyOn(logger, 'warn').mockImplementation((...args) => {
      warnings.push(args);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('still reads suggestions (closed ones are not told apart) with one warning', async () => {
    const titles = async () =>
      (await reports.listCarrySuggestions({ userId: user.id, date: TUESDAY }))[
        `p${internal.id}`
      ].map((task) => task.title);
    expect(await titles()).toEqual(['Working on backend', 'Closed before']);
    expect(await titles()).toEqual(['Working on backend', 'Closed before']);
    const missing = warnings.filter(([text]) => String(text).includes('carry_closed_at'));
    expect(missing).toHaveLength(1);
  });

  it('answers TODO_UNAVAILABLE to Done already and Not needed, and changes nothing', async () => {
    for (const reason of ['done', 'dropped']) {
      await expect(
        reports.closeSuggestion({ user, taskId: monday.taskIds[1], reason }),
      ).rejects.toMatchObject({
        code: 'TODO_UNAVAILABLE',
        status: 503,
        message: 'This needs the latest database update. Ask an Admin.',
      });
    }
    expect(await db('auditLogs').where({ entityType: 'report_task' })).toEqual([]);
  });

  it('still saves a line carried from a suggestion', async () => {
    const draft = await reports.openForDate({ user });
    const saved = await reports.saveReport({
      user,
      reportId: draft.id,
      entries: saveReportSchema.parse({
        entries: [
          {
            projectId: internal.id,
            hours: 1,
            tasks: [
              {
                title: 'Working on backend',
                status: 'in_progress',
                carriedFromTaskId: monday.taskIds[0],
              },
            ],
          },
        ],
      }).entries,
    });
    expect(saved.entries[0].tasks[0]).toMatchObject({
      carriedFromTaskId: monday.taskIds[0],
      firstReportedOn: MONDAY,
      timerNote: 'Backend',
    });
  });

  it('works once the migration has run, without a restart', async () => {
    await db.migrate.up({ name: MIGRATION });
    await reports.closeSuggestion({ user, taskId: monday.taskIds[1], reason: 'dropped' });
    expect(await reports.listCarrySuggestions({ userId: user.id, date: TUESDAY })).toEqual({});
  });
});
