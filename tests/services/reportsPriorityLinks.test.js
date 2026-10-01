// Priority task links on daily-report task lines (CONTRACT section 13): which links a save
// accepts, carry-over, the revision snapshot, the report view and the Slack text.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { reports } from '@/modules/reports';
import { saveReportSchema, submitReportSchema } from '@/modules/reports/schemas';
import { contentVersion } from '@/modules/reports/view';
import {
  entriesFromView,
  matchSuggestions,
  newTask,
  serialize,
  unlinkTasks,
} from '@/app/(app)/report/reportState';
import { resetDatabase, setSettings } from '../helpers/db.js';
import {
  clearTables,
  createPeople,
  createProject,
  createProjectRequest,
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
// The projectTasks service's findByIds (what reports checks links with), answered from the
// database inside the caller's transaction.
vi.mock('@/modules/projectTasks', async () => {
  const { db: database } = await import('@/lib/db');
  return {
    projectTasks: {
      async findByIds(ids, { trx = database, lock = false } = {}) {
        const query = trx('projectTasks').whereIn('id', ids);
        const rows = await (lock ? query.forShare() : query);
        return new Map(
          rows.map((row) => [
            row.id,
            {
              id: row.id,
              projectId: row.projectId,
              title: row.title,
              priority: row.priority,
              status: row.status,
              assigneeId: row.assigneeId ?? null,
            },
          ]),
        );
      },
    },
  };
});

// Tuesday 29 September 2026, 9:30 AM in Asia/Kolkata.
const TUESDAY_MORNING = '2026-09-29T04:00:00Z';
const MONDAY = '2026-09-28';

let people;
let user;
let internal;
let iwill;

function input(entries) {
  return saveReportSchema.parse({ entries }).entries;
}

async function priorityTask(project, overrides = {}) {
  const [id] = await db('projectTasks').insert({
    projectId: project.id,
    title: 'Fix login timeout',
    priority: 'p1',
    status: 'open',
    createdBy: people.pm.id,
    ...overrides,
  });
  return db('projectTasks').where({ id }).first();
}

async function storedLinks(reportId) {
  return db('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .where('e.reportId', reportId)
    .orderBy(['e.sortOrder', 't.sortOrder'])
    .select('t.id', 't.title', 't.projectTaskId');
}

function save(reportId, entries) {
  return reports.saveReport({ user, reportId, entries: input(entries) });
}

const fieldError = (path, message) => ({
  code: 'VALIDATION_FAILED',
  fields: expect.objectContaining({ [path]: message }),
});

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
  await clearTables('report_revisions', 'report_edit_requests', 'slack_outbox', 'notifications');
  await clearTables('report_tasks', 'report_entries', 'daily_reports', 'project_tasks');
  setNowForTests(TUESDAY_MORNING);
});

describe('the projectTaskId field', () => {
  const parse = (projectTaskId) =>
    saveReportSchema.safeParse({
      entries: [
        { projectId: 1, hours: 1, tasks: [{ title: 'Work', status: 'done', projectTaskId }] },
      ],
    });

  it('takes a plain-digit id as a number or a string, and empty values as no link', () => {
    expect(parse(12).data.entries[0].tasks[0].projectTaskId).toBe(12);
    expect(parse('12').data.entries[0].tasks[0].projectTaskId).toBe(12);
    for (const empty of [null, '', undefined]) {
      expect(parse(empty).data.entries[0].tasks[0].projectTaskId).toBeUndefined();
    }
  });

  it('refuses ids that are not plain positive whole numbers', () => {
    for (const bad of ['1e3', '0', '012', -1, 0, 1.5, 'abc', ' 7', '12345678901234567', true]) {
      expect(parse(bad).success, String(bad)).toBe(false);
    }
  });

  it('is accepted by the submit body too', () => {
    const body = submitReportSchema.parse({
      entries: [
        { projectId: 1, hours: 1, tasks: [{ title: 'Work', status: 'done', projectTaskId: '5' }] },
      ],
    });
    expect(body.entries[0].tasks[0].projectTaskId).toBe(5);
  });
});

describe('linking a task line', () => {
  it('saves a link to an open priority task of the same project and shows its priority', async () => {
    const login = await priorityTask(internal, { priority: 'p2' });
    const draft = await reports.openForDate({ user });

    const view = await save(draft.id, [
      {
        projectId: internal.id,
        hours: 2,
        tasks: [
          { title: 'Fix login timeout', status: 'in_progress', projectTaskId: login.id },
          { title: 'Code review', status: 'done' },
        ],
      },
    ]);

    expect(view.entries[0].tasks[0]).toMatchObject({
      title: 'Fix login timeout',
      projectTaskId: login.id,
      priority: 'p2',
      projectTaskTitle: 'Fix login timeout',
    });
    expect(view.entries[0].tasks[1]).toMatchObject({
      projectTaskId: null,
      priority: null,
      projectTaskTitle: null,
    });
    expect((await storedLinks(draft.id)).map((row) => row.projectTaskId)).toEqual([login.id, null]);
    // The page reads the same thing back.
    const reread = await reports.getReport({ user, reportId: draft.id });
    expect(reread.entries[0].tasks[0]).toMatchObject({ projectTaskId: login.id, priority: 'p2' });
  });

  it('refuses a priority task of another project', async () => {
    const other = await priorityTask(iwill, { title: 'Homepage copy' });
    const draft = await reports.openForDate({ user });

    await expect(
      save(draft.id, [
        {
          projectId: internal.id,
          hours: 1,
          tasks: [
            { title: 'Backend', status: 'done' },
            { title: 'Homepage copy', status: 'done', projectTaskId: other.id },
          ],
        },
      ]),
    ).rejects.toMatchObject(
      fieldError(
        'entries.0.tasks.1.projectTaskId',
        'That priority task belongs to another project.',
      ),
    );
    expect(await storedLinks(draft.id)).toEqual([]);
  });

  it('refuses a priority task that is done, a deleted one, and links on a project request', async () => {
    const done = await priorityTask(internal, { status: 'done', doneAt: new Date() });
    const request = await createProjectRequest(people.person);
    const open = await priorityTask(internal, { title: 'Another' });
    const draft = await reports.openForDate({ user });

    await expect(
      save(draft.id, [
        {
          projectId: internal.id,
          hours: 1,
          tasks: [{ title: 'Old', status: 'done', projectTaskId: done.id }],
        },
      ]),
    ).rejects.toMatchObject(
      fieldError(
        'entries.0.tasks.0.projectTaskId',
        'That priority task is already done. Pick an open one.',
      ),
    );
    await expect(
      save(draft.id, [
        {
          projectId: internal.id,
          hours: 1,
          tasks: [{ title: 'Gone', status: 'done', projectTaskId: 999999 }],
        },
      ]),
    ).rejects.toMatchObject(
      fieldError(
        'entries.0.tasks.0.projectTaskId',
        'That priority task was deleted. Unlink it to save this line.',
      ),
    );
    await expect(
      save(draft.id, [
        {
          projectRequestId: request.id,
          hours: 1,
          tasks: [{ title: 'Blog', status: 'done', projectTaskId: open.id }],
        },
      ]),
    ).rejects.toMatchObject(
      fieldError(
        'entries.0.tasks.0.projectTaskId',
        'Priority tasks can be linked once the project is approved.',
      ),
    );
    expect(await storedLinks(draft.id)).toEqual([]);
  });

  it('keeps a line linked to a task marked done since, but a new line cannot link it', async () => {
    const login = await priorityTask(internal);
    const draft = await reports.openForDate({ user });
    const saved = await save(draft.id, [
      {
        projectId: internal.id,
        hours: 1,
        tasks: [{ title: 'Fix login timeout', status: 'in_progress', projectTaskId: login.id }],
      },
    ]);
    const line = saved.entries[0].tasks[0];
    await db('projectTasks').where({ id: login.id }).update({ status: 'done', doneAt: new Date() });

    const again = await save(draft.id, [
      {
        id: saved.entries[0].id,
        projectId: internal.id,
        hours: 2,
        tasks: [
          {
            id: line.id,
            title: 'Fix login timeout, tests',
            status: 'done',
            projectTaskId: login.id,
          },
        ],
      },
    ]);
    expect(again.entries[0].tasks[0]).toMatchObject({ projectTaskId: login.id, status: 'done' });

    await expect(
      save(draft.id, [
        {
          id: saved.entries[0].id,
          projectId: internal.id,
          hours: 2,
          tasks: [
            {
              id: line.id,
              title: 'Fix login timeout, tests',
              status: 'done',
              projectTaskId: login.id,
            },
            { title: 'Same task again', status: 'done', projectTaskId: login.id },
          ],
        },
      ]),
    ).rejects.toMatchObject(
      fieldError(
        'entries.0.tasks.1.projectTaskId',
        'That priority task is already done. Pick an open one.',
      ),
    );
  });

  it('unlinks a line saved without its projectTaskId', async () => {
    const login = await priorityTask(internal);
    const draft = await reports.openForDate({ user });
    const saved = await save(draft.id, [
      {
        projectId: internal.id,
        hours: 1,
        tasks: [{ title: 'Fix login timeout', status: 'in_progress', projectTaskId: login.id }],
      },
    ]);
    const view = await save(draft.id, [
      {
        id: saved.entries[0].id,
        projectId: internal.id,
        hours: 1,
        tasks: [
          { id: saved.entries[0].tasks[0].id, title: 'Something else', status: 'in_progress' },
        ],
      },
    ]);
    expect(view.entries[0].tasks[0]).toMatchObject({ projectTaskId: null, priority: null });
    expect((await storedLinks(draft.id))[0].projectTaskId).toBeNull();
    expect(view.version).not.toBe(saved.version);
  });
});

describe('carry-over, submit and the version', () => {
  it("carries the link to the next day's draft, even after the task is marked done", async () => {
    const login = await priorityTask(internal, { priority: 'p3' });
    const monday = await insertReport(people.person, MONDAY, {
      entries: [
        {
          project: internal,
          minutes: 240,
          tasks: [
            { title: 'Fix login timeout', status: 'in_progress' },
            { title: 'Unlinked', status: 'blocked' },
          ],
        },
      ],
    });
    await db('reportTasks').where({ id: monday.taskIds[0] }).update({ projectTaskId: login.id });
    await db('projectTasks').where({ id: login.id }).update({ status: 'done', doneAt: new Date() });

    const view = await reports.openForDate({ user });

    expect(view.entries[0].tasks).toEqual([
      expect.objectContaining({
        title: 'Fix login timeout',
        carriedFromTaskId: monday.taskIds[0],
        projectTaskId: login.id,
        priority: 'p3',
      }),
      expect.objectContaining({ title: 'Unlinked', projectTaskId: null }),
    ]);
    // Already linked on that line, so saving it again is fine although the task is done.
    const line = view.entries[0].tasks[0];
    const saved = await save(view.id, [
      {
        id: view.entries[0].id,
        projectId: internal.id,
        hours: 3,
        tasks: [{ id: line.id, title: line.title, status: 'done', projectTaskId: login.id }],
      },
    ]);
    expect(saved.entries[0].tasks[0].projectTaskId).toBe(login.id);
  });

  it('keeps the link in the revision snapshot; the Slack text stays the same', async () => {
    const login = await priorityTask(internal);
    const draft = await reports.openForDate({ user });

    const submitted = await reports.submitReport({
      user,
      reportId: draft.id,
      entries: input([
        {
          projectId: internal.id,
          hours: 3,
          tasks: [
            { title: 'Fix login timeout', status: 'done', projectTaskId: login.id },
            { title: 'Code review', status: 'in_progress' },
          ],
        },
      ]),
    });

    expect(submitted.entries[0].tasks[0]).toMatchObject({
      projectTaskId: login.id,
      priority: 'p1',
    });
    const [revision] = await db('reportRevisions').where({ reportId: draft.id });
    expect(parseJson(revision.snapshot).entries[0].tasks).toEqual([
      { title: 'Fix login timeout', status: 'done', projectTaskId: login.id },
      { title: 'Code review', status: 'in_progress', projectTaskId: null },
    ]);
    const [post] = await outboxRows();
    expect(post.payload.text).toBe(
      'Name: Vishal Saini\nDate: 29-09-2026\n\nProject: internal-tool\nHours: 3\nTasks\n' +
        '• Fix login timeout (Done)\n• Code review (In Progress)',
    );
  });

  it('refuses a submit with a bad link and leaves the report a draft', async () => {
    const other = await priorityTask(iwill);
    const draft = await reports.openForDate({ user });
    await expect(
      reports.submitReport({
        user,
        reportId: draft.id,
        entries: input([
          {
            projectId: internal.id,
            hours: 3,
            tasks: [{ title: 'Fix login timeout', status: 'done', projectTaskId: other.id }],
          },
        ]),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await db('dailyReports').where({ id: draft.id }).first()).status).toBe('draft');
    expect(await outboxRows()).toEqual([]);
  });

  it('changes the version with the link, and hashes unlinked lines as before', () => {
    const entry = (projectTaskId) => [
      {
        id: 1,
        projectId: 2,
        minutes: 60,
        tasks: [{ id: 3, title: 'Work', status: 'done', projectTaskId }],
      },
    ];
    const withoutField = [
      { id: 1, projectId: 2, minutes: 60, tasks: [{ id: 3, title: 'Work', status: 'done' }] },
    ];
    expect(contentVersion('draft', entry(null))).toBe(contentVersion('draft', withoutField));
    expect(contentVersion('draft', entry(7))).not.toBe(contentVersion('draft', entry(null)));
    expect(contentVersion('draft', entry(7))).not.toBe(contentVersion('draft', entry(8)));
  });
});

describe('getPriorityLinks', () => {
  it("returns the links of a project's submitted lines in the range, with the priority", async () => {
    const login = await priorityTask(internal, { priority: 'p2' });
    const monday = await insertReport(people.person, MONDAY, {
      entries: [
        {
          project: internal,
          minutes: 120,
          tasks: [
            { title: 'Fix login timeout', status: 'done' },
            { title: 'Other', status: 'done' },
          ],
        },
      ],
    });
    const draft = await insertReport(people.person, '2026-09-29', {
      status: 'draft',
      entries: [
        { project: internal, minutes: 60, tasks: [{ title: 'Draft line', status: 'done' }] },
      ],
    });
    await db('reportTasks')
      .whereIn('id', [monday.taskIds[0], draft.taskIds[0]])
      .update({ projectTaskId: login.id });

    const links = await reports.getPriorityLinks({
      projectId: internal.id,
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(links).toEqual({
      [monday.taskIds[0]]: { projectTaskId: login.id, priority: 'p2', title: 'Fix login timeout' },
    });
    const outside = await reports.getPriorityLinks({
      projectId: internal.id,
      from: '2026-09-29',
      to: '2026-09-30',
    });
    expect(outside).toEqual({});
  });
});

describe('the report page helpers', () => {
  const suggestions = [
    { id: 1, title: 'Fix login timeout', priority: 'p1', forYou: false },
    { id: 2, title: 'Add audit log export', priority: 'p2', forYou: true },
    { id: 3, title: 'Login page copy', priority: 'p3', forYou: false },
  ];

  it('suggests every task for an empty line, and those holding every word typed', () => {
    expect(matchSuggestions(suggestions, '').map((item) => item.id)).toEqual([1, 2, 3]);
    expect(matchSuggestions(suggestions, '  LOGIN ').map((item) => item.id)).toEqual([1, 3]);
    expect(matchSuggestions(suggestions, 'login fix').map((item) => item.id)).toEqual([1]);
    expect(matchSuggestions(suggestions, 'deploy')).toEqual([]);
    expect(matchSuggestions(undefined, '')).toEqual([]);
  });

  it('leaves out tasks other lines link to, and shows at most six', () => {
    expect(matchSuggestions(suggestions, '', new Set([1])).map((item) => item.id)).toEqual([2, 3]);
    const many = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, title: `Task ${i}` }));
    expect(matchSuggestions(many, 'task')).toHaveLength(6);
  });

  it('round-trips links through the view and the PUT body, and unlinks a moved card', () => {
    const [entry] = entriesFromView({
      entries: [
        {
          id: 5,
          projectId: 2,
          projectName: 'internal-tool',
          hours: 1,
          tasks: [
            {
              id: 7,
              title: 'Fix login timeout',
              status: 'done',
              projectTaskId: 1,
              priority: 'p1',
              projectTaskTitle: 'Fix login timeout',
            },
            { id: 8, title: 'Review', status: 'done', projectTaskId: null, priority: null },
          ],
        },
      ],
    });
    expect(entry.tasks[0]).toMatchObject({ projectTaskId: 1, priority: 'p1' });
    expect(entry.tasks[1]).toMatchObject({ projectTaskId: null, priority: null });
    const { body } = serialize([entry]);
    expect(body[0].tasks).toEqual([
      { id: 7, title: 'Fix login timeout', status: 'done', projectTaskId: 1 },
      { id: 8, title: 'Review', status: 'done', projectTaskId: undefined },
    ]);
    // The body the page sends is what the API accepts.
    expect(saveReportSchema.parse({ entries: body }).entries[0].tasks[0].projectTaskId).toBe(1);

    const moved = unlinkTasks(entry.tasks);
    expect(moved.every((task) => task.projectTaskId === null && task.priority === null)).toBe(true);
    expect(moved[1]).toBe(entry.tasks[1]);
    const plain = [newTask()];
    expect(unlinkTasks(plain)).toBe(plain);
    expect(newTask()).toMatchObject({ projectTaskId: null, priority: null });
  });
});
