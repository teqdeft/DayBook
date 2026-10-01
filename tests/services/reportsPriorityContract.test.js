// Priority task links checked through the real projectTasks service (CONTRACT section 13), so a
// change to projectTasks.findByIds that reports relies on shows up here. The detailed link rules
// are in reportsPriorityLinks.test.js.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { saveReportSchema } from '@/modules/reports/schemas';
import { resetDatabase } from '../helpers/db.js';
import { clearTables, createPeople, createProject, sessionUser } from './reportsTestKit.js';

vi.mock('@/modules/users', async () => ({
  users: (await import('./reportsTestKit.js')).fakeUsers,
}));
vi.mock('@/modules/projects', async () => ({
  projects: (await import('./reportsTestKit.js')).fakeProjects,
}));
vi.mock('@/modules/attendance', async () => ({
  attendance: (await import('./reportsTestKit.js')).fakeAttendance,
}));

let people;
let user;
let internal;
let other;

async function priorityTask(project, overrides = {}) {
  const [id] = await db('projectTasks').insert({
    projectId: project.id,
    title: 'Fix login timeout',
    priority: 'p1',
    status: 'open',
    createdBy: people.pm.id,
    ...overrides,
  });
  return id;
}

function save(reportId, projectId, projectTaskId) {
  const entries = saveReportSchema.parse({
    entries: [
      {
        projectId,
        hours: 1,
        tasks: [{ title: 'Fix login timeout', status: 'done', projectTaskId }],
      },
    ],
  }).entries;
  return reports.saveReport({ user, reportId, entries });
}

beforeAll(async () => {
  await resetDatabase();
  people = await createPeople();
  user = sessionUser(people.person);
  internal = await createProject(people.pm, { name: 'internal-tool' });
  other = await createProject(people.pm, { name: 'other' });
});

beforeEach(async () => {
  await clearTables('report_tasks', 'report_entries', 'daily_reports', 'project_tasks');
  setNowForTests('2026-09-29T04:00:00Z');
});

describe('links through the real projectTasks service', () => {
  it('saves an open task of the same project and refuses another project or a done task', async () => {
    const open = await priorityTask(internal, { priority: 'p2' });
    const elsewhere = await priorityTask(other);
    const done = await priorityTask(internal, { status: 'done', doneAt: new Date() });
    const draft = await reports.openForDate({ user });

    const view = await save(draft.id, internal.id, open);
    expect(view.entries[0].tasks[0]).toMatchObject({ projectTaskId: open, priority: 'p2' });

    await expect(save(draft.id, internal.id, elsewhere)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: {
        'entries.0.tasks.0.projectTaskId': 'That priority task belongs to another project.',
      },
    });
    await expect(save(draft.id, internal.id, done)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: {
        'entries.0.tasks.0.projectTaskId': 'That priority task is already done. Pick an open one.',
      },
    });
  });
});

describe('a priority task deleted while a report saves', () => {
  it('makes the save wait and answer with a field error, never a broken link', async () => {
    const task = await priorityTask(internal);
    const draft = await reports.openForDate({ user });
    // Someone deletes the task: its row is locked before the save starts.
    const deleting = await db.transaction();
    try {
      await deleting('projectTasks').where({ id: task }).forUpdate().first();
      const saving = save(draft.id, internal.id, task).then(
        () => null,
        (error) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await deleting('projectTasks').where({ id: task }).delete();
      await deleting.commit();
      expect(await saving).toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: {
          'entries.0.tasks.0.projectTaskId':
            'That priority task was deleted. Unlink it to save this line.',
        },
      });
    } finally {
      if (!deleting.isCompleted()) await deleting.rollback();
    }
    const lines = await db('reportTasks as t')
      .join('reportEntries as e', 'e.id', 't.entryId')
      .where('e.reportId', draft.id)
      .select('t.projectTaskId');
    expect(lines).toEqual([]);
  });
});
