// Carry-over off (CONTRACT 21, My settings): a new draft — opening the report, or an approved edit
// request creating a missing day — starts without carried lines for a person who turned it off.
// Drafts that already exist keep theirs, and other people still get carry-over.
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

describe('carry-over off', () => {
  it('starts a new draft without carried lines; others still get theirs', async () => {
    await reportWithOpenWork(people.person, MONDAY);
    await reportWithOpenWork(people.colleague, MONDAY);
    await preferences.update({ user, values: { carryOver: false } });

    expect(await reports.planCarryOver(user.id, TUESDAY)).toEqual([]);
    const mine = await reports.openForDate({ user });
    expect(mine).toMatchObject({ workDate: TUESDAY, status: 'draft', editable: true });
    expect(mine.entries).toEqual([]);

    const theirs = await reports.openForDate({ user: colleague });
    expect(carriedTitles(theirs)).toEqual(['Working on backend']);
  });

  it('leaves a draft that already exists as it is', async () => {
    await reportWithOpenWork(people.person, MONDAY);
    const opened = await reports.openForDate({ user });
    expect(carriedTitles(opened)).toEqual(['Working on backend']);

    await preferences.update({ user, values: { carryOver: false } });
    const again = await reports.openForDate({ user, workDate: TUESDAY });
    expect(again.id).toBe(opened.id);
    expect(carriedTitles(again)).toEqual(['Working on backend']);

    // On again: the next new draft carries over as before.
    await preferences.update({ user, values: { carryOver: true } });
    setNowForTests('2026-09-30T04:00:00Z'); // Wednesday; Tuesday's draft was never submitted
    expect(carriedTitles(await reports.openForDate({ user }))).toEqual(['Working on backend']);
  });

  it('applies to a missing day an approved edit request creates', async () => {
    setNowForTests(WEDNESDAY_MORNING);
    await reportWithOpenWork(people.person, THURSDAY);
    await preferences.update({ user, values: { carryOver: false } });
    const request = await reports.requestEdit({
      user,
      workDate: FRIDAY,
      reason: 'I forgot Friday',
    });
    await reports.approveEditRequest({ user: pm, requestId: request.id });

    const created = await reports.openForDate({ user, workDate: FRIDAY });
    expect(created).toMatchObject({ workDate: FRIDAY, status: 'draft', editable: true });
    expect(created.entries).toEqual([]);
  });

  it('carries over into that missing day while it is on', async () => {
    setNowForTests(WEDNESDAY_MORNING);
    await reportWithOpenWork(people.person, THURSDAY);
    const request = await reports.requestEdit({
      user,
      workDate: FRIDAY,
      reason: 'I forgot Friday',
    });
    await reports.approveEditRequest({ user: pm, requestId: request.id });

    const created = await reports.openForDate({ user, workDate: FRIDAY });
    expect(carriedTitles(created)).toEqual(['Working on backend']);
    expect(await db('reportTasks').count({ n: '*' }).first()).toEqual({ n: 3 });
  });
});
