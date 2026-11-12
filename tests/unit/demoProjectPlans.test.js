// The demo's project plans (db/demo/projectPlans.js): on every day of the week and across a year end,
// acme-store reads off track, internal-tool at risk and iwilltillimwell on track; nothing is dated
// later than now; Vishal gets no new task (his artboard counts stay); and the hand-written summary
// keeps every point, with the page Daybook finds for its quote.
import { afterEach, describe, expect, it } from 'vitest';
import { localToUtc, setNowForTests, workDate } from '@/lib/time';
import { forecastProject } from '@/modules/projectPlan/forecast';
import { lastFullWeeks } from '@/modules/projectPlan/weeks';
import { anchorDate, at, dateAtOffset, workingDaysBack } from '../../db/demo/calendar.js';
import { PEOPLE } from '../../db/demo/people.js';
import { buildPriorityTasks } from '../../db/demo/priority.js';
import { buildProjectPlanRows } from '../../db/demo/projectPlanRows.js';
import { COMPLETED_PROJECTS, PROJECTS } from '../../db/demo/projects.js';

const TZ = 'Asia/Kolkata';
const WORKING_DAYS = [1, 2, 3, 4, 5];
// Monday to Sunday, then a Monday and a Friday whose plans run into the next year.
const DAYS = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
DAYS.push('2026-11-14', '2026-11-15', '2026-12-28', '2027-01-01');

/** The seed's context on a day (as seedDemo.js and base.js build it), without a database. */
function seedContext(day, clock = '12:00', status = null) {
  const now = localToUtc(day, clock, TZ);
  setNowForTests(now.toISOString());
  const anchor = anchorDate(TZ, WORKING_DAYS);
  const days = workingDaysBack(anchor, WORKING_DAYS);
  const dateOf = (offset) => days[offset] ?? dateAtOffset(anchor, offset, WORKING_DAYS);
  const when = (offset, time) => at(dateOf(offset), time, TZ);
  const users = new Map([['ceo', { id: 1, status: 'active' }]]);
  PEOPLE.forEach((person, i) => users.set(person.key, { ...person, id: i + 2 }));
  const projects = new Map();
  [...PROJECTS, ...COMPLETED_PROJECTS].forEach((project, i) => {
    const created = project.createdOffset ?? 120 + i * 7;
    const createdAt = when(
      created,
      project.createdOffset === null ? '10:00' : project.createdClock,
    );
    projects.set(project.key, {
      ...project,
      id: i + 1,
      createdAt,
      status: status ?? project.status,
    });
  });
  const priority = buildPriorityTasks({ when, dateOf, users, projects }).map(({ row }) => row);
  const ctx = { tz: TZ, today: workDate(TZ), anchor, users, projects };
  return { ctx, priority, now: now.toDate(), users, projects };
}

/** The health each plan's project reads, from the rows the seed would insert. */
function healthOf({ ctx, priority, projects }, rows) {
  const weeks = lastFullWeeks(ctx.today, TZ);
  return rows.plans.map((plan) => {
    const project = [...projects.values()].find((row) => row.id === plan.projectId);
    const tasks = [...priority, ...rows.tasks].filter((task) => task.projectId === plan.projectId);
    const done = tasks.filter((task) => task.status === 'done');
    const forecast = forecastProject({
      status: project.status,
      total: tasks.length,
      done: done.length,
      doneByWeek: weeks.map(
        ({ from, to }) => done.filter((task) => task.doneAt >= from && task.doneAt < to).length,
      ),
      deadline: plan.deadline,
      today: ctx.today,
      createdOn: workDate(TZ, project.createdAt),
    });
    return [project.name, forecast.kind];
  });
}

afterEach(() => setNowForTests(null));

describe('demo project plans', () => {
  it.each(DAYS)('read off track, at risk and on track on %s', (day) => {
    const seed = seedContext(day);
    const rows = buildProjectPlanRows(seed.ctx, seed.priority);
    expect(healthOf(seed, rows)).toEqual([
      ['acme-store', 'off'],
      ['internal-tool', 'risk'],
      ['iwilltillimwell', 'on'],
    ]);
  });

  it('dates nothing later than now, even just after midnight', () => {
    for (const day of DAYS) {
      const seed = seedContext(day, '00:05');
      const rows = buildProjectPlanRows(seed.ctx, seed.priority);
      for (const task of rows.tasks) {
        expect(task.createdAt <= seed.now, task.title).toBe(true);
        if (task.doneAt) expect(task.createdAt < task.doneAt && task.doneAt <= seed.now).toBe(true);
      }
      for (const row of [...rows.documents, ...rows.summaries]) {
        expect(row.createdAt <= seed.now).toBe(true);
      }
    }
  });

  it('gives Vishal no new task and files the priority tasks it names', () => {
    const seed = seedContext('2026-11-12');
    const rows = buildProjectPlanRows(seed.ctx, seed.priority);
    const vishal = seed.users.get('vishal').id;
    expect(rows.tasks.some((task) => task.assigneeId === vishal || !task.assigneeId)).toBe(false);
    const checkout = seed.priority.find((task) => task.title === 'Checkout fix before client demo');
    expect(checkout).toMatchObject({ phase: 'development', dueDate: '2026-11-13' });
    const elsewhere = seed.priority.find((task) => task.title === 'Monthly ranking report');
    expect(elsewhere).toMatchObject({ phase: null, dueDate: null });
    expect(new Set(rows.tasks.map((task) => task.id)).size).toBe(rows.tasks.length);
    expect(Math.min(...rows.tasks.map((task) => task.id))).toBe(seed.priority.length + 1);
  });

  it('stores the summary with every point, its page and its source', () => {
    const seed = seedContext('2026-11-12');
    const { documents, summaries } = buildProjectPlanRows(seed.ctx, seed.priority);
    expect(documents.map(({ kind, title, pages }) => [kind, title, pages])).toEqual([
      ['note', 'Weekly call with Acme Retail', null],
      ['file', 'Acme-store-SOW-v2.pdf', 4],
    ]);
    expect(documents[1].body.split('\f')).toHaveLength(4);
    expect(summaries).toHaveLength(1);
    const body = JSON.parse(summaries[0].body);
    expect(body.scope.map((point) => point.source)).toEqual(
      Array(3).fill('Acme-store-SOW-v2.pdf, page 2'),
    );
    expect(body.deadlines[0]).toMatchObject({ page: 3, documentId: documents[1].id });
    expect(
      body.actions.map((action) => [action.owner, Boolean(action.key), action.taskId]),
    ).toEqual([
      ['client', true, null],
      ['client', true, null],
      ['us', true, null],
    ]);
    expect(body.nextPhase).toMatchObject({
      phase: 'testing',
      source: 'Weekly call with Acme Retail',
    });
    expect(summaries[0]).toMatchObject({ truncated: false, droppedCount: 0, model: null });
    expect(summaries[0].sourceKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses data that would not show the health it is meant to', () => {
    const seed = seedContext('2026-11-12', '12:00', 'on_hold');
    expect(() => buildProjectPlanRows(seed.ctx, seed.priority)).toThrow(
      'Demo project plans: acme-store would read "hold", not "off"',
    );
  });
});
