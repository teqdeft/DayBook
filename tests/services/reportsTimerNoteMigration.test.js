// "Timer lines remember their note" (CONTRACT 21) before `npm run migrate` has added
// report_tasks.timer_note (migration 014): a deploy that runs first still opens, saves, submits
// and carries reports over, only without timer notes, and logs one warning. Once the migration has
// run, notes are kept again without a restart.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { resetDatabase, setSettings } from '../helpers/db.js';
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

const MONDAY = '2026-09-28';
// Tuesday and Wednesday, 9:30 AM in Asia/Kolkata.
const TUESDAY_MORNING = '2026-09-29T04:00:00Z';
const WEDNESDAY_MORNING = '2026-09-30T04:00:00Z';
const TYPO = 'Deploting new features';

let user;
let internal;

async function timerNoteColumn() {
  const [rows] = await db.raw("SHOW COLUMNS FROM report_tasks WHERE Field = 'timer_note'");
  return rows.length > 0;
}

/** The page's rows for a view, with the first line filled from the timer note TYPO. */
function filledRows(view) {
  return saveReportSchema.parse({
    entries: view.entries.map((entry) => ({
      id: entry.id,
      projectId: entry.projectId ?? undefined,
      minutes: 120,
      tasks: entry.tasks.map((task, index) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        timerNote: index === 0 ? TYPO : undefined,
      })),
    })),
  }).entries;
}

const notes = (view) => view.entries[0].tasks.map((task) => [task.title, task.timerNote]);

beforeAll(async () => {
  await resetDatabase();
  const people = await createPeople();
  user = sessionUser(people.person);
  internal = await createProject(people.pm, { name: 'internal-tool' });
  await setSettings({
    slack_report_channel_id: 'C0DAILY',
    slack_report_channel_name: 'daily-reports',
  });
  await insertReport(people.person, MONDAY, {
    entries: [
      {
        project: internal,
        minutes: 480,
        tasks: [{ title: TYPO, status: 'in_progress' }],
      },
    ],
  });
  // The deploy ran before `npm run migrate`: no report code has asked for the column yet.
  await db.migrate.down();
  expect(await timerNoteColumn()).toBe(false);
});

afterAll(async () => {
  // Leave the test database migrated even when a test failed half way.
  await db.migrate.latest();
});

describe('before migration 014', () => {
  it('opens, carries over, saves and submits task lines without their timer note', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    setNowForTests(TUESDAY_MORNING);

    const draft = await reports.openForDate({ user });
    expect(notes(draft)).toEqual([[TYPO, null]]);
    expect(draft.entries[0].tasks[0].carriedFromTaskId).toBeTruthy();

    const saved = await reports.saveReport({
      user,
      reportId: draft.id,
      baseVersion: draft.version,
      entries: filledRows(draft),
    });
    expect(notes(saved)).toEqual([[TYPO, null]]);
    // The same rows again (an unchanged line is compared without the note).
    const again = await reports.saveReport({
      user,
      reportId: draft.id,
      baseVersion: saved.version,
      entries: filledRows(saved),
    });
    expect(again.version).toBe(saved.version);

    const submitted = await reports.submitReport({
      user,
      reportId: draft.id,
      baseVersion: again.version,
      entries: filledRows(again),
    });
    expect(submitted.status).toBe('submitted');
    expect(notes(submitted)).toEqual([[TYPO, null]]);
    expect(notes(await reports.openForDate({ user }))).toEqual([[TYPO, null]]);

    const missing = warn.mock.calls.filter(([message]) => String(message).includes('timer_note'));
    expect(missing).toHaveLength(1);
    warn.mockRestore();
  });

  it('keeps timer notes once `npm run migrate` has run, without a restart', async () => {
    await db.migrate.latest();
    expect(await timerNoteColumn()).toBe(true);
    setNowForTests(WEDNESDAY_MORNING);

    const draft = await reports.openForDate({ user });
    expect(notes(draft)).toEqual([[TYPO, null]]);
    const saved = await reports.saveReport({
      user,
      reportId: draft.id,
      baseVersion: draft.version,
      entries: filledRows(draft),
    });
    expect(notes(saved)).toEqual([[TYPO, TYPO]]);
    expect(notes(await reports.openForDate({ user }))).toEqual([[TYPO, TYPO]]);
  });
});
