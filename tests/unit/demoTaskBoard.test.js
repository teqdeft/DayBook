// The demo's 1.13 data (CONTRACT 28, Files and owners, O last): the CEO took "Approve the hosting
// invoice" on internal-tool (not a member; due today), Meera Pillai took a task there too, the PM
// keeps "Get the payment gateway keys from Acme" (overdue); acme-store's brand guide is linked to
// the checkout task and the managers-only contract to none; and three acme-store tasks carry timer
// time, each a finished entry on a past working day inside its person's check-in and check-out,
// after the task was added, on any day of the week.
import { afterEach, describe, expect, it } from 'vitest';
import { localToUtc, setNowForTests, workDate } from '@/lib/time';
import { anchorDate, at, dateAtOffset, workingDaysBack } from '../../db/demo/calendar.js';
import { buildTimerDays } from '../../db/demo/hrTimers.js';
import { buildHrRows, planHrTools } from '../../db/demo/hrTools.js';
import { PEOPLE } from '../../db/demo/people.js';
import { planAllDays } from '../../db/demo/plan.js';
import { buildPriorityTasks } from '../../db/demo/priority.js';
import { STORE_FILES, STORE_LINKS } from '../../db/demo/projectFiles.js';
import { buildProjectPlanRows } from '../../db/demo/projectPlanRows.js';
import { COMPLETED_PROJECTS, PROJECTS } from '../../db/demo/projects.js';
import { buildRows } from '../../db/demo/rows.js';
import { TASK_TIMERS, buildTaskTimers } from '../../db/demo/taskTimers.js';
import { assignTasks } from '../../db/demo/tasks.js';
import { addTodoLines } from '../../db/demo/todo.js';
import { DEFAULT_SETTINGS } from '../../db/seeds/03_settings.js';

const TZ = DEFAULT_SETTINGS.timezone;
const WORKING_DAYS = DEFAULT_SETTINGS.working_days;
// A Monday, a Wednesday, a Friday, a Saturday and a Sunday.
const DAYS = ['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-14', '2026-11-22'];

/** The seed's rows on a day, as seedDemo.js builds them, without a database. */
function demo(day) {
  setNowForTests(localToUtc(day, '12:00', TZ).toISOString());
  const anchor = anchorDate(TZ, WORKING_DAYS);
  const days = workingDaysBack(anchor, WORKING_DAYS);
  const dateOf = (offset) => days[offset] ?? dateAtOffset(anchor, offset, WORKING_DAYS);
  const when = (offset, clock) => at(dateOf(offset), clock, TZ);
  const projects = new Map();
  [...PROJECTS, ...COMPLETED_PROJECTS].forEach((project, i) => {
    const created = project.createdOffset ?? 120 + i * 7;
    const clock = project.createdOffset === null ? '10:00' : project.createdClock;
    projects.set(project.key, { ...project, id: i + 1, createdAt: when(created, clock) });
  });
  const users = new Map([['ceo', { key: 'ceo', id: 1, role: 'admin', status: 'active' }]]);
  PEOPLE.forEach((person, i) => users.set(person.key, { ...person, id: i + 2 }));
  const settings = {
    tz: TZ,
    workingDays: WORKING_DAYS,
    lateAfter: DEFAULT_SETTINGS.late_after,
    reportLock: DEFAULT_SETTINGS.report_lock,
    payrollStartDay: 1,
  };
  const plans = planAllDays({ days, lateAfter: settings.lateAfter, midday: false, projects });
  assignTasks(plans);
  addTodoLines(plans);
  planHrTools(plans, { anchor, ...settings });
  const { rows, index } = buildRows(plans, { ...settings, days, users, projects });
  const hrCtx = { ...settings, today: anchor, users, projects, index, when, dateOf };
  buildHrRows(hrCtx);
  const priority = buildPriorityTasks({ when, dateOf, users, projects }).map(({ row }) => row);
  const ctx = { tz: TZ, today: workDate(TZ), anchor, users, projects };
  const planRows = buildProjectPlanRows(ctx, priority);
  const tasks = [...priority, ...planRows.tasks];
  const timerDays = buildTimerDays(hrCtx);
  const firstId = timerDays.entries.length + 1;
  const timers = buildTaskTimers({ users, projects, index, tasks, firstId });
  return { anchor, users, projects, rows, index, tasks, timerDays, timers };
}

const taskOn = (built, projectKey, title) =>
  built.tasks.find(
    (task) => task.projectId === built.projects.get(projectKey).id && task.title === title,
  );

afterEach(() => setNowForTests(null));

describe.each(DAYS)('the demo task board data on %s', (day) => {
  it('has the CEO and Meera on tasks they took on internal-tool, and the PM on the gateway keys', () => {
    const built = demo(day);
    const internal = built.projects.get('internal');
    for (const key of ['ceo', 'meera']) expect(internal.members).not.toContain(key);
    const ceo = built.users.get('ceo').id;
    expect(taskOn(built, 'internal', 'Approve the hosting invoice')).toMatchObject({
      assigneeId: ceo,
      updatedBy: ceo,
      status: 'open',
      phase: 'development',
      priority: 'p2',
      dueDate: built.anchor,
    });
    const meera = built.users.get('meera').id;
    expect(taskOn(built, 'internal', 'HR tries the leave form')).toMatchObject({
      assigneeId: meera,
      updatedBy: meera,
      status: 'open',
      phase: 'testing',
    });
    expect(built.users.get('meera')).toMatchObject({ role: 'admin', tracksAttendance: true });
    const keys = taskOn(built, 'store', 'Get the payment gateway keys from Acme');
    expect(keys).toMatchObject({ assigneeId: built.users.get('pm').id, status: 'open' });
    expect(keys.dueDate < built.anchor).toBe(true);
    // Every other new task is still the PM's or a member's.
    const admins = new Set([ceo, meera]);
    const taken = built.tasks.filter((task) => admins.has(task.assigneeId));
    expect(taken.map((task) => task.title).sort()).toEqual([
      'Approve the hosting invoice',
      'HR tries the leave form',
    ]);
  });

  it('times three acme-store tasks inside the day, after the task was added', () => {
    const built = demo(day);
    const anchorStart = localToUtc(built.anchor, '00:00', TZ).toDate();
    expect(built.timers.map((entry) => entry.id)).toEqual([
      built.timerDays.entries.length + 1,
      built.timerDays.entries.length + 2,
      built.timerDays.entries.length + 3,
    ]);
    const minutes = {};
    for (const [i, entry] of built.timers.entries()) {
      const timer = TASK_TIMERS[i];
      const task = taskOn(built, 'store', timer.task);
      expect(entry).toMatchObject({
        userId: built.users.get(timer.person).id,
        projectId: built.projects.get('store').id,
        projectTaskId: task.id,
        source: 'timer',
        stopReason: 'stopped',
        awayCheckedUntil: entry.endedAt,
      });
      const days = [...built.index.attendance.values()].filter(
        (row) => row.userId === entry.userId && row.workDate === entry.workDate,
      );
      expect(days).toHaveLength(1);
      expect(entry.startedAt >= days[0].checkInAt && entry.endedAt <= days[0].checkOutAt).toBe(
        true,
      );
      expect(entry.startedAt > task.createdAt).toBe(true);
      expect(entry.endedAt <= anchorStart).toBe(true);
      minutes[task.title] = (entry.endedAt - entry.startedAt) / 60_000;
    }
    expect(minutes).toEqual({
      'Checkout fix before client demo': 340,
      'Payment settings page': 195,
      'Product image zoom': 110,
    });
    const perDay = built.timers.map((entry) => `${entry.userId}|${entry.workDate}`);
    expect(new Set(perDay).size).toBe(perDay.length);
  });
});

describe('the demo links', () => {
  it('links the brand guide to the checkout task and leaves the managers-only contract unlinked', () => {
    expect(STORE_LINKS).toEqual([
      { name: 'acme-brand-guide.pdf', task: 'Checkout fix before client demo' },
    ]);
    const byName = new Map(STORE_FILES.map((file) => [file.name, file]));
    for (const link of STORE_LINKS) {
      expect(byName.get(link.name)).toMatchObject({ phase: null, visibility: 'everyone' });
    }
    const managers = STORE_FILES.filter((file) => file.visibility === 'managers');
    expect(managers.map((file) => file.name)).toEqual(['acme-store-contract-signed.pdf']);
    expect(STORE_LINKS.some((link) => link.name === managers[0].name)).toBe(false);
  });
});
