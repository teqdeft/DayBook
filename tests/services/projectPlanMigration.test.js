// Deploy before migrate (CONTRACT 22): a deploy that runs before `npm run migrate` has added migration
// 015 keeps every screen working. Plan reads answer Not set with one warning per process, writes to
// the new tables and columns answer a clear error, and everything works once the migration has run,
// without a restart.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { projectPlan } from '@/modules/projectPlan';
import { lastFullWeeks } from '@/modules/projectPlan/weeks';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';

vi.mock('@/modules/reports', () => ({
  reports: {
    hasEntriesForProjectRequest: vi.fn(async () => false),
    moveProjectRequestEntries: vi.fn(async () => 0),
  },
}));

const MIGRATION = '015_project_plan.js';
const T0 = '2026-10-30T06:00:00Z';
const NOT_SET = { currentPhase: null, deadline: null };

// Every logger.warn call. Vitest clears a spy's calls before each test (clearMocks), so the file
// counts them itself: the warning is once per process, across the tests below.
const warnings = [];
let warn;
let pm;
let alice;
let project;
let openTask;
let doneTask;

async function hasTable(name) {
  return db.schema.hasTable(name);
}

async function expectUnavailable(promise) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error).toMatchObject({
    code: 'PLAN_UNAVAILABLE',
    status: 503,
    message: "Phases and deadlines can't be saved yet. Please try again later.",
  });
}

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(T0);
  pm = await createUser({ name: 'Paul Manager', role: 'pm', tracksAttendance: false });
  alice = await createUser({ name: 'Alice Dev' });
  project = await createProject(pm, { name: 'lyra' });
  await addMembers(project, [alice]);
  openTask = await projectTasks.create({
    user: pm,
    projectId: project.id,
    input: { title: 'Still open', assigneeId: alice.id, priority: 'p1' },
  });
  doneTask = await projectTasks.create({
    user: pm,
    projectId: project.id,
    input: { title: 'Already done' },
  });
  setNowForTests('2026-10-20T06:00:00Z');
  await projectTasks.setStatus({ user: pm, id: doneTask.id, status: 'done' });
  setNowForTests(T0);

  await db.migrate.down({ name: MIGRATION });
  expect(await hasTable('project_plans')).toBe(false);
  expect(await db.schema.hasColumn('project_tasks', 'phase')).toBe(false);
  // One spy for the whole file: the warning is once per process, whichever read comes first.
  warn = vi.spyOn(logger, 'warn').mockImplementation((...args) => {
    warnings.push(args);
  });
});

afterAll(async () => {
  // Leave the test database migrated even when a test failed half way.
  await db.migrate.latest();
  warn.mockRestore();
});

describe('before migration 015', () => {
  it('leaves the readers of Today, the report picker and My projects alone, with no warning', async () => {
    const today = await projectTasks.listOpenForUser(alice.id);
    expect(today.map((task) => task.title)).toEqual(['Still open']);
    expect(await projectTasks.countOpenByProjectForUser(alice.id)).toEqual({
      [project.id]: { total: 1, p1: 1 },
    });
    const picker = await projectTasks.findOpenForPicker({
      userId: alice.id,
      projectId: project.id,
    });
    expect(picker.map((task) => task.id)).toEqual([openTask.id]);
    const byProject = await projectTasks.findOpenForPickerByProject({
      userId: alice.id,
      projectIds: [project.id],
    });
    expect(byProject[project.id]).toHaveLength(1);
    expect((await projectTasks.findByIds([openTask.id])).get(openTask.id).title).toBe('Still open');
    expect((await projectTasks.findById(openTask.id)).title).toBe('Still open');
    expect(warnings).toHaveLength(0);
  });

  it('counts progress: it reads no new column', async () => {
    const weeks = lastFullWeeks('2026-10-30', 'Asia/Kolkata');
    expect(await projectTasks.progressByProject([project.id], { weeks })).toEqual({
      [project.id]: { total: 2, done: 1, doneByWeek: [1, 0, 0] },
    });
    expect(warnings).toHaveLength(0);
  });

  it('shows every project as Not set, with one warning in the whole process', async () => {
    const plan = await projectPlan.getPlan(project.id);
    expect(plan).toMatchObject(NOT_SET);
    expect(plan.phases).toHaveLength(6);
    expect(plan.phases.every((phase) => !phase.plannedStart && !phase.actualStart)).toBe(true);
    expect(await projectPlan.listPlans([project.id])).toEqual({ [project.id]: NOT_SET });
    expect(await projectPlan.getPlan(project.id)).toMatchObject(NOT_SET);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toContain('npm run migrate');
  });

  it("lists a project's tasks with no phase and no due date", async () => {
    const rows = await projectTasks.listForProject({ viewer: pm, projectId: project.id });
    expect(rows.map((row) => [row.title, row.phase, row.dueDate])).toEqual([
      ['Still open', null, null],
      ['Already done', null, null],
    ]);
    const page = await projectTasks.pageForProject({ viewer: pm, projectId: project.id });
    expect(page.total).toBe(2);
  });

  it('answers a clear error to every plan write', async () => {
    await expectUnavailable(
      projectPlan.movePhase({ user: pm, projectId: project.id, phase: 'design' }),
    );
    await expectUnavailable(
      projectPlan.setDeadline({ user: pm, projectId: project.id, deadline: '2026-12-15' }),
    );
    await expectUnavailable(
      projectPlan.setPhaseDates({
        user: pm,
        projectId: project.id,
        phase: 'design',
        plannedStart: null,
        plannedEnd: null,
      }),
    );
  });

  it('still answers FORBIDDEN and validation errors first', async () => {
    const other = await createUser({ name: 'Other PM', role: 'pm', tracksAttendance: false });
    await expect(
      projectPlan.movePhase({ user: other, projectId: project.id, phase: 'design' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      projectPlan.movePhase({ user: pm, projectId: project.id, phase: 'nonsense' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('adds, edits, ticks and deletes tasks that have no phase or due date', async () => {
    const task = await projectTasks.create({
      user: pm,
      projectId: project.id,
      input: { title: 'Added before the migration', phase: null, dueDate: '' },
    });
    expect(task).toMatchObject({ phase: null, dueDate: null });
    const edited = await projectTasks.update({
      user: pm,
      id: task.id,
      input: { title: 'Edited before the migration', phase: null, dueDate: null },
    });
    expect(edited).toMatchObject({ title: 'Edited before the migration', phase: null });
    const done = await projectTasks.setStatus({ user: pm, id: task.id, status: 'done' });
    expect(done).toMatchObject({ status: 'done', phase: null, dueDate: null });
    expect(await projectTasks.remove({ user: pm, id: task.id })).toMatchObject({ deleted: true });
  });

  it('answers a clear error to a task with a phase or due date, and saves nothing', async () => {
    const before = await db('projectTasks').count({ total: '*' }).first();
    await expectUnavailable(
      projectTasks.create({
        user: pm,
        projectId: project.id,
        input: { title: 'With a phase', phase: 'design' },
      }),
    );
    await expectUnavailable(
      projectTasks.create({
        user: pm,
        projectId: project.id,
        input: { title: 'With a date', dueDate: '2026-11-20' },
      }),
    );
    expect(await db('projectTasks').count({ total: '*' }).first()).toEqual(before);
    await expectUnavailable(
      projectTasks.update({ user: pm, id: openTask.id, input: { phase: 'design' } }),
    );
    await expectUnavailable(
      projectTasks.update({ user: pm, id: openTask.id, input: { dueDate: '2026-11-20' } }),
    );
  });

  it('has still warned only once', () => {
    expect(warnings).toHaveLength(1);
  });
});

describe('once `npm run migrate` has run', () => {
  it('works without a restart, and existing tasks stay empty', async () => {
    await db.migrate.latest();
    expect(await hasTable('project_summaries')).toBe(true);

    const rows = await projectTasks.listForProject({ viewer: pm, projectId: project.id });
    expect(rows.every((row) => row.phase === null && row.dueDate === null)).toBe(true);

    const plan = await projectPlan.movePhase({ user: pm, projectId: project.id, phase: 'design' });
    expect(plan.currentPhase).toBe('design');
    const moved = await projectTasks.update({
      user: pm,
      id: openTask.id,
      input: { phase: 'design', dueDate: '2026-11-20' },
    });
    expect(moved).toMatchObject({ phase: 'design', dueDate: '2026-11-20' });
    expect(await projectPlan.listPlans([project.id])).toEqual({
      [project.id]: { currentPhase: 'design', deadline: null },
    });
  });
});

describe('a column missing from a plan table (errno 1054)', () => {
  it('falls back the same way, then recovers', async () => {
    await db.schema.alterTable('project_plans', (t) => t.dropColumn('deadline'));
    try {
      expect(await projectPlan.getPlan(project.id)).toMatchObject(NOT_SET);
      expect(await projectPlan.listPlans([project.id])).toEqual({ [project.id]: NOT_SET });
      await expectUnavailable(
        projectPlan.setDeadline({ user: pm, projectId: project.id, deadline: '2026-12-15' }),
      );
    } finally {
      await db.schema.alterTable('project_plans', (t) => t.date('deadline').nullable());
    }
    expect((await projectPlan.getPlan(project.id)).currentPhase).toBe('design');
  });
});

describe('the migration', () => {
  it('goes down and up again cleanly, keeping tasks and their rows', async () => {
    const before = await db('projectTasks').count({ total: '*' }).first();
    await db.migrate.down({ name: MIGRATION });
    for (const table of [
      'project_plans',
      'project_phase_plans',
      'project_documents',
      'project_summaries',
    ]) {
      expect(await hasTable(table)).toBe(false);
    }
    expect(await db.schema.hasColumn('project_tasks', 'due_date')).toBe(false);
    expect(await db('projectTasks').count({ total: '*' }).first()).toEqual(before);
    await db.migrate.latest();
    expect(await db.schema.hasColumn('project_tasks', 'due_date')).toBe(true);
    const [rows] = await db.raw(
      "SHOW INDEX FROM project_tasks WHERE Column_name = 'done_at' AND Seq_in_index = 3",
    );
    expect(rows).toHaveLength(1);
  });

  it('gives the tables the columns of the contract', async () => {
    const columns = async (table) =>
      (await db.raw(`SHOW COLUMNS FROM ${table}`))[0].map((row) => row.Field);
    expect(await columns('project_plans')).toEqual([
      'project_id',
      'current_phase',
      'deadline',
      'updated_by',
      'created_at',
      'updated_at',
    ]);
    expect(await columns('project_phase_plans')).toEqual([
      'project_id',
      'phase',
      'planned_start',
      'planned_end',
      'actual_start',
      'actual_end',
      'updated_by',
      'created_at',
      'updated_at',
    ]);
    expect(await columns('project_documents')).toEqual([
      'id',
      'project_id',
      'phase',
      'kind',
      'title',
      'body',
      'pages',
      'pages_total',
      'char_count',
      'created_by',
      'updated_by',
      'created_at',
      'updated_at',
    ]);
    expect(await columns('project_summaries')).toEqual([
      'project_id',
      'body',
      'source_key',
      'truncated',
      'dropped_count',
      'model',
      'created_by',
      'updated_by',
      'created_at',
      'updated_at',
    ]);
  });
});
