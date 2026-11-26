// Today's Priority tasks with the 1.13 Today rule (CONTRACT 28, Today; Tests, M), against the real
// modules: a tracked Admin (Meera) sees a task she took on a project she isn't on, "For you", with
// its due date for the Due column, beside her own project's tasks and its Anyone tasks; a task on a
// Completed project or one already done doesn't show; someone taken off a project loses their
// tasks there; the CEO (an Admin who isn't tracked) has no Today page, so the task he took shows
// only in My tasks; a row without a due date has none.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { navigationFor } from '@/config/navigation';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import { createTask } from './projectFilesKit.js';

const { loadToday } = await import('@/app/(app)/today/todayData.js');
const { loadMyTasks } = await import('@/app/(app)/my-tasks/myTasksData.js');

const NOW = '2026-11-25T06:30:00Z'; // Wednesday 25 November 2026, noon in Kolkata

let p;
let t;

const rowsOf = async (user) => (await loadToday({ user, ip: null })).priority.rows;
const byTitle = (rows) =>
  Object.fromEntries(rows.map((row) => [row.title, { forYou: row.forYou, due: row.dueDate }]));

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(NOW);
  await setSettings({ timezone: 'Asia/Kolkata' });
  p = {
    pm: await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false }),
    ceo: await createUser({ name: 'Arvind Menon', role: 'admin', tracksAttendance: false }),
    meera: await createUser({ name: 'Meera Pillai', role: 'admin', tracksAttendance: true }),
    vishal: await createUser({ name: 'Vishal Saini' }),
    sneha: await createUser({ name: 'Sneha Patil' }),
  };
  const acme = await createProject(p.pm, { name: 'acme-store', color: 'green' });
  const tool = await createProject(p.pm, { name: 'internal-tool', color: 'violet' });
  const old = await createProject(p.pm, { name: 'Proposals', status: 'completed' });
  await addMembers(tool, [p.meera, p.vishal, p.sneha]);
  await addMembers(acme, [p.vishal]);
  const task = (project, title, extra) => createTask(project, { title, ...extra });
  t = {
    taken: await task(acme, 'Checkout fix before client demo', {
      assigneeId: p.meera.id,
      priority: 'p1',
      dueDate: '2026-11-27',
    }),
    own: await task(tool, 'Permissions check', { assigneeId: p.meera.id, dueDate: '2026-12-01' }),
    anyone: await task(tool, 'Release notes', { priority: 'p3' }),
    others: await task(acme, 'Fix the login page', { assigneeId: p.vishal.id }),
    doneTaken: await task(acme, 'Scope signed off', { assigneeId: p.meera.id, status: 'done' }),
    closed: await task(old, 'Send the proposal', { assigneeId: p.meera.id, dueDate: '2026-11-20' }),
    ceos: await task(tool, 'Approve the hosting invoice', {
      assigneeId: p.ceo.id,
      dueDate: '2026-11-25',
    }),
    snehas: await task(tool, 'Stock sync with the warehouse', { assigneeId: p.sneha.id }),
  };
});

describe("a tracked Admin's Today", () => {
  it('shows the task she took on a project she is not on, For you, with its due date', async () => {
    const rows = await rowsOf(p.meera);
    expect(byTitle(rows)).toEqual({
      'Checkout fix before client demo': { forYou: true, due: '2026-11-27' },
      'Permissions check': { forYou: true, due: '2026-12-01' },
      'Release notes': { forYou: false, due: null },
    });
    expect(rows[0]).toMatchObject({
      id: t.taken.id,
      priority: 'p1',
      projectId: expect.any(Number),
    });
    expect(rows[0].project).toEqual({ name: 'acme-store', color: 'green' });
  });

  it('is not made a member of that project by taking the task', async () => {
    const members = await db('projectMembers').where({ userId: p.meera.id }).pluck('projectId');
    expect(members).toHaveLength(1);
  });

  it("never shows a done task, a Completed project's task or another person's task", async () => {
    const titles = (await rowsOf(p.meera)).map((row) => row.title);
    expect(titles).not.toContain('Scope signed off');
    expect(titles).not.toContain('Send the proposal');
    expect(titles).not.toContain('Fix the login page');
    expect(titles).not.toContain('Approve the hosting invoice');
  });
});

describe("an employee's Today", () => {
  it('has the due dates, and loses the tasks of a project they were taken off', async () => {
    expect(byTitle(await rowsOf(p.sneha))).toEqual({
      'Stock sync with the warehouse': { forYou: true, due: null },
      'Release notes': { forYou: false, due: null },
    });
    await db('projectMembers').where({ userId: p.sneha.id }).delete();
    expect(await rowsOf(p.sneha)).toEqual([]);
  });
});

describe('the CEO', () => {
  it('has no Today page: the task he took shows in My tasks', async () => {
    const hrefs = navigationFor(p.ceo).map((item) => item.href);
    expect(hrefs).not.toContain('/today');
    expect(hrefs).toContain('/my-tasks');
    expect(navigationFor(p.meera).map((item) => item.href)).toContain('/today');
    const mine = await loadMyTasks({ user: p.ceo });
    expect(mine.tasks.map((task) => task.title)).toEqual(['Approve the hosting invoice']);
  });
});
