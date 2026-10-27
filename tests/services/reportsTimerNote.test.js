// "Timer lines remember their note" (CONTRACT 21, fix found testing 1.06), on the server: a task
// line's `timerNote` (report_tasks.timer_note, migration 014) is saved by autosave and submit,
// returned by the report view, kept while the page sends it back, changed or cleared when it sends
// something else, and copied by carry-over. Slack and the revision snapshot don't carry it.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { resetDatabase, setSettings } from '../helpers/db.js';
import {
  clearTables,
  createPeople,
  createProject,
  insertReport,
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

// Tuesday 29 September 2026, 9:30 AM in Asia/Kolkata.
const TUESDAY_MORNING = '2026-09-29T04:00:00Z';
const MONDAY = '2026-09-28';
const TYPO = 'Deploting new features';
const FIXED = 'Deploying new features';

let people;
let user;
let internal;

/** Parses entries through the PUT schema, as the API does. */
function input(entries) {
  return saveReportSchema.parse({ entries }).entries;
}

/** The view's entries as the report page sends them back (serialize): timerNote included. */
function sentBack(view) {
  return view.entries.map((entry) => ({
    id: entry.id,
    projectId: entry.projectId ?? undefined,
    minutes: entry.minutes,
    tasks: entry.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      timerNote: task.timerNote ?? undefined,
    })),
  }));
}

const notes = (view) => view.entries[0].tasks.map((task) => [task.title, task.timerNote]);

async function storedTasks(reportId) {
  return db('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .where('e.reportId', reportId)
    .orderBy('t.sortOrder')
    .select('t.id', 't.title', 't.timerNote', 't.updatedAt');
}

/** Today's draft with one card: a line filled from the timer note TYPO, and one typed by hand. */
async function filledDraft() {
  const draft = await reports.openForDate({ user });
  return reports.saveReport({
    user,
    reportId: draft.id,
    baseVersion: draft.version,
    entries: input([
      {
        projectId: internal.id,
        minutes: 120,
        tasks: [
          { title: TYPO, status: 'in_progress', timerNote: `  ${TYPO} ` },
          { title: 'Standup', status: 'done' },
        ],
      },
    ]),
  });
}

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  user = sessionUser(people.person);
  internal = await createProject(people.pm, { name: 'internal-tool' });
  await setSettings({
    slack_report_channel_id: 'C0DAILY',
    slack_report_channel_name: 'daily-reports',
  });
});

beforeEach(async () => {
  await clearTables('report_revisions', 'report_edit_requests', 'slack_outbox', 'notifications');
  await clearTables('report_tasks', 'report_entries', 'daily_reports', 'user_preferences');
  setNowForTests(TUESDAY_MORNING);
});

describe('a task line keeps the timer note it was filled from', () => {
  it('is saved trimmed, returned by the view on every task, and null for typed lines', async () => {
    const saved = await filledDraft();
    expect(notes(saved)).toEqual([
      [TYPO, TYPO],
      ['Standup', null],
    ]);
    expect((await storedTasks(saved.id)).map((task) => task.timerNote)).toEqual([TYPO, null]);
    const opened = await reports.openForDate({ user });
    expect(notes(opened)).toEqual(notes(saved));
    expect(opened.version).toBe(saved.version);
  });

  it('stays when the line is reworded, and an unchanged line is not written again', async () => {
    const saved = await filledDraft();
    const [before] = await storedTasks(saved.id);

    // Polish with AI (or a hand edit) changes the title only; the page sends the note back.
    setNowForTests('2026-09-29T05:00:00Z');
    const entries = sentBack(saved);
    entries[0].tasks[0].title = FIXED;
    const reworded = await reports.saveReport({
      user,
      reportId: saved.id,
      baseVersion: saved.version,
      entries: input(entries),
    });
    expect(notes(reworded)).toEqual([
      [FIXED, TYPO],
      ['Standup', null],
    ]);
    expect(reworded.entries[0].tasks[0].id).toBe(before.id);

    // The same rows again: sameFields sees the stored note, so nothing is updated.
    setNowForTests('2026-09-29T06:00:00Z');
    const stored = await storedTasks(saved.id);
    const again = await reports.saveReport({
      user,
      reportId: saved.id,
      baseVersion: reworded.version,
      entries: input(sentBack(reworded)),
    });
    expect(notes(again)).toEqual(notes(reworded));
    expect(await storedTasks(saved.id)).toEqual(stored);
  });

  it('changes or clears when the page sends a different note or none', async () => {
    const saved = await filledDraft();
    const entries = sentBack(saved);
    entries[0].tasks[0].timerNote = 'Release notes';
    entries[0].tasks[1].timerNote = '';
    const changed = await reports.saveReport({
      user,
      reportId: saved.id,
      baseVersion: saved.version,
      entries: input(entries),
    });
    expect(notes(changed)).toEqual([
      [TYPO, 'Release notes'],
      ['Standup', null],
    ]);

    // A page that doesn't send it (moved card, or opened before the fix) clears it.
    const cleared = sentBack(changed);
    delete cleared[0].tasks[0].timerNote;
    const view = await reports.saveReport({
      user,
      reportId: saved.id,
      baseVersion: changed.version,
      entries: input(cleared),
    });
    expect(notes(view)).toEqual([
      [TYPO, null],
      ['Standup', null],
    ]);
    expect((await storedTasks(saved.id)).map((task) => task.timerNote)).toEqual([null, null]);
  });

  it('is submitted with the line but stays out of the revision snapshot and Slack', async () => {
    const saved = await filledDraft();
    const entries = sentBack(saved);
    entries[0].tasks[0].title = FIXED;
    const submitted = await reports.submitReport({
      user,
      reportId: saved.id,
      baseVersion: saved.version,
      entries: input(entries),
    });
    expect(submitted.status).toBe('submitted');
    expect(notes(submitted)).toEqual([
      [FIXED, TYPO],
      ['Standup', null],
    ]);
    const revision = await db('reportRevisions').where({ reportId: saved.id }).first();
    const snapshot = parseJson(revision.snapshot);
    expect(snapshot.entries[0].tasks[0]).toEqual({
      title: FIXED,
      status: 'in_progress',
      projectTaskId: null,
    });
    const [post] = await outboxRows();
    expect(JSON.stringify(post.payload)).not.toContain(TYPO);
  });
});

describe('carry-over', () => {
  it('copies the timer note to the carried line', async () => {
    const monday = await insertReport(people.person, MONDAY, {
      entries: [
        {
          project: internal,
          minutes: 480,
          tasks: [
            { title: FIXED, status: 'in_progress' },
            { title: 'Code review', status: 'blocked' },
            { title: 'Standup', status: 'done' },
          ],
        },
      ],
    });
    await db('reportTasks').where({ id: monday.taskIds[0] }).update({ timerNote: TYPO });
    await db('reportTasks').where({ id: monday.taskIds[2] }).update({ timerNote: 'Standup' });

    const draft = await reports.openForDate({ user });
    expect(draft.entries[0].tasks).toMatchObject([
      { title: FIXED, timerNote: TYPO, carriedFromTaskId: monday.taskIds[0] },
      { title: 'Code review', timerNote: null, carriedFromTaskId: monday.taskIds[1] },
    ]);
    // The carried line keeps it through today's saves too.
    const saved = await reports.saveReport({
      user,
      reportId: draft.id,
      baseVersion: draft.version,
      entries: input(sentBack(draft)),
    });
    expect(notes(saved)).toEqual([
      [FIXED, TYPO],
      ['Code review', null],
    ]);
  });
});
