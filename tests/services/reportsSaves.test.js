// Saves that race with another change: a page that missed a newer save (another tab or device)
// and a PM approving a project request while the person's save runs.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { resetDatabase, setSettings } from '../helpers/db.js';
import {
  clearTables,
  createPeople,
  createProject,
  createProjectRequest,
  entriesFrom,
  fakeProjects,
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

let people;
let user;
let internal;
let iwill;

function input(entries) {
  return saveReportSchema.parse({ entries }).entries;
}

function task(title, status = 'in_progress') {
  return { title, status };
}

function save(reportId, entries, baseVersion) {
  return reports.saveReport({ user, reportId, entries: input(entries), baseVersion });
}

async function storedEntries(reportId) {
  return db('reportEntries')
    .where({ reportId })
    .orderBy('sortOrder')
    .select('id', 'projectId', 'projectRequestId', 'minutes');
}

/** What the projects module does on approve: lock the request row, mark it, move the entries. */
async function approveRequest(request, project) {
  await db.transaction(async (trx) => {
    const row = await trx('projectRequests').where({ id: request.id }).forUpdate().first();
    if (row.status !== 'pending') throw new Error('The request was already handled.');
    await trx('projectRequests')
      .where({ id: request.id })
      .update({ status: 'approved', projectId: project.id });
    await reports.moveProjectRequestEntries(
      { projectRequestId: request.id, projectId: project.id },
      trx,
    );
  });
}

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  user = sessionUser(people.person);
  internal = await createProject(people.pm, { name: 'internal-tool' });
  iwill = await createProject(people.pm, { name: 'iwilltillimwell', color: 'orange' });
  await setSettings({
    slack_report_channel_id: 'C0DAILY',
    slack_report_channel_name: 'daily-reports',
  });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await clearTables('report_revisions', 'report_edit_requests', 'slack_outbox', 'notifications');
  await clearTables('report_tasks', 'report_entries', 'daily_reports', 'project_requests');
  setNowForTests(TUESDAY_MORNING);
});

describe('the report version', () => {
  it('stays the same while nothing changes and changes with any saved change', async () => {
    const draft = await reports.openForDate({ user });
    expect(draft.version).toEqual(expect.any(String));
    expect((await reports.openForDate({ user })).version).toBe(draft.version);
    expect((await reports.getReport({ user, reportId: draft.id })).version).toBe(draft.version);

    const saved = await save(draft.id, [
      { projectId: internal.id, hours: 2, tasks: [task('Task A')] },
    ]);
    expect(saved.version).not.toBe(draft.version);
    const statusOnly = entriesFrom(saved);
    statusOnly[0].tasks[0].status = 'done';
    const changed = await save(draft.id, statusOnly, saved.version);
    expect(changed.version).not.toBe(saved.version);
    // Saving the same rows again keeps the version.
    expect((await save(draft.id, entriesFrom(changed), changed.version)).version).toBe(
      changed.version,
    );
  });
});

describe('a save from a page that missed a newer save', () => {
  it('is refused, and the rows saved elsewhere stay', async () => {
    const draft = await reports.openForDate({ user });
    // Laptop, 10:00: tasks A and B, 2 hours.
    const laptop = await save(
      draft.id,
      [{ projectId: internal.id, hours: 2, tasks: [task('Task A'), task('Task B')] }],
      draft.version,
    );
    // Phone, 14:00: adds task C and sets 4 hours.
    const fromPhone = entriesFrom(laptop);
    fromPhone[0].hours = 4;
    fromPhone[0].tasks.push(task('Task C from phone'));
    const phone = await save(draft.id, fromPhone, laptop.version);

    // The laptop tab still shows its 10:00 state and only changes task A's status.
    const stale = entriesFrom(laptop);
    stale[0].tasks[0].status = 'done';
    await expect(save(draft.id, stale, laptop.version)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: expect.stringContaining('Reload the page'),
    });

    const now = await reports.getReport({ user, reportId: draft.id });
    expect(now.totalMinutes).toBe(240);
    expect(now.entries[0].tasks.map((t) => [t.title, t.status])).toEqual([
      ['Task A', 'in_progress'],
      ['Task B', 'in_progress'],
      ['Task C from phone', 'in_progress'],
    ]);
    expect(now.version).toBe(phone.version);

    // After a reload the same change goes through.
    const reloaded = entriesFrom(now);
    reloaded[0].tasks[0].status = 'done';
    const after = await save(draft.id, reloaded, now.version);
    expect(after.entries[0].tasks.map((t) => t.status)).toEqual([
      'done',
      'in_progress',
      'in_progress',
    ]);
  });

  it('refuses "Update report" built on an older revision: no new revision, no Slack update', async () => {
    const draft = await reports.openForDate({ user });
    const first = await reports.submitReport({
      user,
      reportId: draft.id,
      entries: input([{ projectId: internal.id, hours: 6, tasks: [task('Backend')] }]),
      baseVersion: draft.version,
    });
    const elsewhere = entriesFrom(first);
    elsewhere.push({ projectId: iwill.id, hours: 2, tasks: [task('Copy changes')] });
    const second = await reports.submitReport({
      user,
      reportId: draft.id,
      entries: input(elsewhere),
      baseVersion: first.version,
    });
    expect(second.revision).toBe(2);

    const stale = entriesFrom(first);
    stale[0].hours = 8;
    await expect(
      reports.submitReport({
        user,
        reportId: draft.id,
        entries: input(stale),
        baseVersion: first.version,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    // The same goes for a PUT on a submitted report (a save is a new revision there).
    await expect(save(draft.id, stale, first.version)).rejects.toMatchObject({ code: 'CONFLICT' });

    const row = await db('dailyReports').where({ id: draft.id }).first();
    expect(row).toMatchObject({ revision: 2, totalMinutes: 480 });
    expect(await db('reportRevisions').where({ reportId: draft.id })).toHaveLength(2);
    expect(await outboxRows()).toHaveLength(2);
  });

  it('leaves a refused submit to the page: its draft stays as it was, so its next save fits', async () => {
    const draft = await reports.openForDate({ user });
    const rows = [{ projectId: internal.id, hours: 0, tasks: [task('Planning')] }];
    await expect(
      reports.submitReport({
        user,
        reportId: draft.id,
        entries: input(rows),
        baseVersion: draft.version,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { 'entries.0.hours': 'Hours must be above 0.' },
    });
    expect(await storedEntries(draft.id)).toEqual([]);
    // The page then autosaves the same rows with the version it already has.
    const saved = await save(draft.id, rows, draft.version);
    expect(saved.entries).toHaveLength(1);
  });
});

describe('a project request handled while the save runs', () => {
  it('does not move an entry back onto a request the PM approved after the first check', async () => {
    const request = await createProjectRequest(people.person, { name: 'zeta-site' });
    const zeta = await createProject(people.pm);
    const draft = await reports.openForDate({ user });
    const saved = await save(draft.id, [
      { projectRequestId: request.id, hours: 2, tasks: [task('Zeta outline')] },
    ]);
    // The next save also adds a project. While that project is checked, the PM approves the
    // request and the entry moves to the new project.
    const next = entriesFrom(saved);
    next[0].hours = 3;
    next.push({ projectId: iwill.id, hours: 1, tasks: [task('Copy')] });
    vi.spyOn(fakeProjects, 'isActive').mockImplementationOnce(async () => {
      await approveRequest(request, zeta);
      return true;
    });

    await expect(save(draft.id, next)).rejects.toMatchObject({
      code: 'PROJECT_NOT_ACTIVE',
      fields: { 'entries.0.project': expect.stringContaining('already handled') },
    });
    expect(await storedEntries(draft.id)).toEqual([
      { id: saved.entries[0].id, projectId: zeta.id, projectRequestId: null, minutes: 120 },
    ]);
  });

  it('does not add a new entry on a request handled after the first check', async () => {
    const request = await createProjectRequest(people.person, { name: 'zeta-site' });
    const zeta = await createProject(people.pm);
    const draft = await reports.openForDate({ user });
    const realFind = fakeProjects.findPendingRequestForUser;
    vi.spyOn(fakeProjects, 'findPendingRequestForUser').mockImplementationOnce(
      async (requestId, userId) => {
        const found = await realFind(requestId, userId);
        await approveRequest(request, zeta);
        return found;
      },
    );

    const rows = [{ projectRequestId: request.id, hours: 2, tasks: [task('Zeta outline')] }];
    await expect(
      reports.submitReport({ user, reportId: draft.id, entries: input(rows) }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_ACTIVE' });
    expect(await reports.hasEntriesForProjectRequest(request.id)).toBe(false);
    expect(await storedEntries(draft.id)).toEqual([]);
    expect(await db('dailyReports').where({ id: draft.id }).first()).toMatchObject({
      status: 'draft',
      revision: 0,
    });
  });

  it('a decision that starts while the save holds the request waits, then moves the saved entry', async () => {
    const request = await createProjectRequest(people.person, { name: 'zeta-site' });
    const zeta = await createProject(people.pm);
    const draft = await reports.openForDate({ user });
    const realFind = fakeProjects.findPendingRequestForUser;
    let calls = 0;
    let decision = null;
    let decidedDuringSave = null;
    vi.spyOn(fakeProjects, 'findPendingRequestForUser').mockImplementation(
      async (requestId, userId) => {
        const found = await realFind(requestId, userId);
        calls += 1;
        if (calls === 2) {
          // Inside the save's transaction, after it locked the request: the PM approves now.
          let done = false;
          decision = approveRequest(request, zeta).then(() => {
            done = true;
          });
          await new Promise((resolve) => setTimeout(resolve, 300));
          decidedDuringSave = done;
        }
        return found;
      },
    );

    const saved = await save(draft.id, [
      { projectRequestId: request.id, hours: 2, tasks: [task('Zeta outline')] },
    ]);
    await decision;
    expect(decidedDuringSave).toBe(false);
    expect(await storedEntries(draft.id)).toEqual([
      { id: saved.entries[0].id, projectId: zeta.id, projectRequestId: null, minutes: 120 },
    ]);
  });
});
