// Carry forward (CONTRACT 24 company rule, overriding the build guide 7.4.2 and CONTRACT 21): a new
// draft (opening the report, or an approved edit request creating a missing day) starts with no
// copied lines, whatever the person's carryOver preference. While it is on, the unfinished tasks
// are suggested instead (listCarrySuggestions); while it is off, nothing is. Drafts that already
// exist keep their lines.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { preferences } from '@/modules/preferences';
import { reports } from '@/modules/reports';
import { resetDatabase } from '../helpers/db.js';
import {
  clearTables,
  createPeople,
  createProject,
  insertReport,
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
const TUESDAY = '2026-09-29';
// Wednesday 30 September 2026, 9:48 AM: Friday's report locked on Saturday noon.
const WEDNESDAY_MORNING = '2026-09-30T04:18:00Z';
const THURSDAY = '2026-09-24';
const FRIDAY = '2026-09-25';

let people;
let user;
let colleague;
let pm;
let internal;

/** A submitted report on `day` with one task still in progress and one done. */
function reportWithOpenWork(person, day) {
  return insertReport(person, day, {
    entries: [
      {
        project: internal,
        minutes: 480,
        tasks: [
          { title: 'Working on backend', status: 'in_progress' },
          { title: 'Shipped login', status: 'done' },
        ],
      },
    ],
  });
}

const carriedTitles = (view) =>
  view.entries.flatMap((entry) =>
    entry.tasks.filter((t) => t.carriedFromTaskId).map((t) => t.title),
  );

const suggestedTitles = async (person, date) =>
  Object.values(await reports.listCarrySuggestions({ userId: person.id, date }))
    .flat()
    .map((task) => task.title);

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  user = sessionUser(people.person);
  colleague = sessionUser(people.colleague);
  pm = sessionUser(people.pm);
  internal = await createProject(people.pm, { name: 'internal-tool' });
});

beforeEach(async () => {
  await clearTables('report_revisions', 'report_edit_requests', 'slack_outbox', 'notifications');
  await clearTables('report_tasks', 'report_entries', 'daily_reports', 'user_preferences');
  setNowForTests(TUESDAY_MORNING);
});

describe('new drafts', () => {
  it('start with no copied lines; the open task is suggested instead', async () => {
    const monday = await reportWithOpenWork(people.person, MONDAY);

    const view = await reports.openForDate({ user });

    expect(view).toMatchObject({ workDate: TUESDAY, status: 'draft', editable: true });
    expect(view.entries).toEqual([]);
    expect(await db('reportTasks').count({ n: '*' }).first()).toEqual({ n: 2 }); // Monday's only
    expect(await reports.listCarrySuggestions({ userId: user.id, date: TUESDAY })).toEqual({
      [`p${internal.id}`]: [
        {
          taskId: monday.taskIds[0],
          title: 'Working on backend',
          status: 'in_progress',
          workDate: MONDAY,
          dayLabel: 'From yesterday',
        },
      ],
    });
  });

  it('give no suggestions while carry forward is off; others still get theirs', async () => {
    await reportWithOpenWork(people.person, MONDAY);
    await reportWithOpenWork(people.colleague, MONDAY);
    await preferences.update({ user, values: { carryOver: false } });

    const mine = await reports.openForDate({ user });
    expect(mine.entries).toEqual([]);
    expect(await reports.listCarrySuggestions({ userId: user.id, date: TUESDAY })).toEqual({});

    const theirs = await reports.openForDate({ user: colleague });
    expect(theirs.entries).toEqual([]);
    expect(await suggestedTitles(colleague, TUESDAY)).toEqual(['Working on backend']);

    // On again: suggested as before.
    await preferences.update({ user, values: { carryOver: true } });
    expect(await suggestedTitles(user, TUESDAY)).toEqual(['Working on backend']);
  });

  it('leave a draft that already exists as it is (copied lines from before 1.09 stay)', async () => {
    const monday = await reportWithOpenWork(people.person, MONDAY);
    const existing = await insertReport(people.person, TUESDAY, {
      status: 'draft',
      entries: [
        {
          project: internal,
          minutes: 0,
          tasks: [
            {
              title: 'Working on backend',
              status: 'in_progress',
              carriedFromTaskId: monday.taskIds[0],
            },
          ],
        },
      ],
    });

    const opened = await reports.openForDate({ user, workDate: TUESDAY });
    expect(opened.id).toBe(existing.id);
    expect(carriedTitles(opened)).toEqual(['Working on backend']);
    // That line already continues Monday's task, so nothing is suggested twice.
    expect(await reports.listCarrySuggestions({ userId: user.id, date: TUESDAY })).toEqual({});
  });

  it('start empty on a missing day an approved edit request creates', async () => {
    setNowForTests(WEDNESDAY_MORNING);
    await reportWithOpenWork(people.person, THURSDAY);
    const request = await reports.requestEdit({
      user,
      workDate: FRIDAY,
      reason: 'I forgot Friday',
    });
    await reports.approveEditRequest({ user: pm, requestId: request.id });

    const created = await reports.openForDate({ user, workDate: FRIDAY });
    expect(created).toMatchObject({ workDate: FRIDAY, status: 'draft', editable: true });
    expect(created.entries).toEqual([]);
    expect(await db('reportTasks').count({ n: '*' }).first()).toEqual({ n: 2 });
    // That day's suggestions are counted from Friday.
    const suggested = await reports.listCarrySuggestions({ userId: user.id, date: FRIDAY });
    expect(suggested[`p${internal.id}`]).toEqual([
      expect.objectContaining({ title: 'Working on backend', dayLabel: 'From yesterday' }),
    ]);

    await preferences.update({ user, values: { carryOver: false } });
    expect(await reports.listCarrySuggestions({ userId: user.id, date: FRIDAY })).toEqual({});
  });
});
