// My tasks' data per viewer (CONTRACT 28, My tasks: sidebar, page and home cards; Tests, M),
// against the real modules: loadMyTasks (the /my-tasks page and the home cards of /team and
// /overview) gives a PM the open tasks they took or were given on their Active and On hold
// projects, also one given to them on another PM's project where they are a member (no tick there),
// never a done task, a Completed project's or someone else's; an Admin who took a task on a project
// they aren't on sees it with its tick; employees and HR get nothing. Each row carries only what a
// row shows, the company's date, and the files on the task the viewer may see (own files and links,
// a managers-only file only through a link to that task). The home card's first 6 rows by date, the
// 200-row cap (`more`), and the card's data reading as null when the tasks can't be read.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';
import { createTask, emptyFilesDir, linkFile, projectFile, taskFile } from './projectFilesKit.js';

const { loadMyTasks, loadMyTasksCard } = await import('@/app/(app)/my-tasks/myTasksData.js');
const { cardRows, groupByWhen } = await import('@/app/(app)/my-tasks/myTasksView.js');

const NOW = '2026-11-25T06:30:00Z'; // Wednesday 25 November 2026, noon in Kolkata
const TODAY = '2026-11-25';

let w;

const idsOf = (mine) => mine.tasks.map((task) => task.id);
const rowOf = (mine, id) => mine.tasks.find((task) => task.id === id);

async function makeWorld() {
  const user = (name, role = 'employee', extra = {}) =>
    createUser({ name, role, tracksAttendance: role !== 'pm', ...extra });
  const p = {
    pm: await user('Riya Kapoor', 'pm'),
    pm2: await user('Sanjay Kulkarni', 'pm'),
    ceo: await user('Arvind Menon', 'admin', { tracksAttendance: false }),
    meera: await user('Meera Pillai', 'admin'),
    vishal: await user('Vishal Saini'),
    neha: await user('Neha Kapoor', 'hr'),
  };
  const acme = await createProject(p.pm, { name: 'acme-store', color: 'green' });
  const tool = await createProject(p.pm2, { name: 'internal-tool', color: 'violet' });
  const seo = await createProject(p.pm, { name: 'acme-seo', status: 'on_hold' });
  const old = await createProject(p.pm, { name: 'Proposals', status: 'completed' });
  await addMembers(acme, [p.vishal, p.neha]);
  await addMembers(tool, [p.pm, p.vishal]);
  const task = (project, title, extra) => createTask(project, { title, ...extra });
  const t = {
    overdue: await task(acme, 'Get the payment gateway keys from Acme', {
      assigneeId: p.pm.id,
      priority: 'p1',
      dueDate: '2026-11-19',
      phase: 'development',
    }),
    today: await task(acme, 'Check the homepage text', { assigneeId: p.pm.id, dueDate: TODAY }),
    noDate: await task(acme, 'Plan the January support rota', {
      assigneeId: p.pm.id,
      priority: 'p3',
    }),
    held: await task(seo, 'Read the SEO audit', { assigneeId: p.pm.id, dueDate: '2026-12-08' }),
    given: await task(tool, 'HR tries the leave form', {
      assigneeId: p.pm.id,
      dueDate: '2026-11-27',
      phase: 'testing',
    }),
    done: await task(acme, 'Scope signed off', { assigneeId: p.pm.id, status: 'done' }),
    closed: await task(old, 'Send the proposal', { assigneeId: p.pm.id }),
    vishals: await task(acme, 'Fix the login page', { assigneeId: p.vishal.id }),
    anyone: await task(acme, 'Product image zoom'),
    ceos: await task(tool, 'Approve the hosting invoice', {
      assigneeId: p.ceo.id,
      dueDate: TODAY,
    }),
    meeras: await task(acme, 'Payment settings page', {
      assigneeId: p.meera.id,
      dueDate: '2026-12-01',
    }),
  };
  return { p, acme, tool, seo, old, t };
}

beforeAll(async () => {
  await resetDatabase();
  await emptyFilesDir();
  setNowForTests(NOW);
  await setSettings({ timezone: 'Asia/Kolkata' });
  w = await makeWorld();
  const { p, acme, tool, t } = w;
  await taskFile({ user: p.pm, projectId: acme.id, taskId: t.overdue.id, name: 'keys.pdf' });
  const brief = await projectFile({ user: p.pm, projectId: acme.id, name: 'brief.pdf' });
  await linkFile({ user: p.pm, project: acme, task: t.overdue, fileIds: brief.id });
  // On the other PM's project the PM is a member: a managers-only file reaches them through a
  // link to their task only, after the share confirm; an unlinked one never does.
  const contract = await projectFile({
    user: p.pm2,
    projectId: tool.id,
    visibility: 'managers',
    name: 'contract.pdf',
  });
  await projectFile({ user: p.pm2, projectId: tool.id, visibility: 'managers', name: 'pay.pdf' });
  await linkFile({
    user: p.pm2,
    project: tool,
    task: t.given,
    fileIds: contract.id,
    shareConfirmed: true,
    shareWith: p.pm.id,
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await emptyFilesDir();
});

describe("the PM's My tasks", () => {
  it('lists their open tasks on Active and On hold projects, by due date', async () => {
    const mine = await loadMyTasks({ user: w.p.pm });
    const { t } = w;
    expect(idsOf(mine)).toEqual([t.overdue.id, t.today.id, t.given.id, t.held.id, t.noDate.id]);
    expect(mine.today).toBe(TODAY);
    expect(mine.more).toBe(false);
    expect(mine.viewerId).toBe(w.p.pm.id); // the task window's "(you)"
  });

  it('gives each row only what it shows', async () => {
    const mine = await loadMyTasks({ user: w.p.pm });
    expect(rowOf(mine, w.t.overdue.id)).toEqual({
      id: w.t.overdue.id,
      title: 'Get the payment gateway keys from Acme',
      priority: 'p1',
      phase: 'development',
      dueDate: '2026-11-19',
      project: { id: w.acme.id, name: 'acme-store', color: 'green', status: 'active' },
      canManage: true,
      fileCount: 2,
    });
    expect(rowOf(mine, w.t.held.id).project.status).toBe('on_hold');
  });

  it("ticks only on their own projects: another PM's task given to them has no tick", async () => {
    const mine = await loadMyTasks({ user: w.p.pm });
    expect(rowOf(mine, w.t.given.id)).toMatchObject({ canManage: false, phase: 'testing' });
    expect(rowOf(mine, w.t.today.id).canManage).toBe(true);
  });

  it('counts a managers-only file only through the link to their task', async () => {
    const mine = await loadMyTasks({ user: w.p.pm });
    expect(rowOf(mine, w.t.given.id).fileCount).toBe(1);
    expect(rowOf(mine, w.t.noDate.id).fileCount).toBe(0);
  });

  it("lists no done task, no Completed project's, no one else's and no Anyone task", async () => {
    const ids = idsOf(await loadMyTasks({ user: w.p.pm }));
    for (const key of ['done', 'closed', 'vishals', 'anyone', 'ceos', 'meeras']) {
      expect(ids).not.toContain(w.t[key].id);
    }
  });
});

describe('an Admin', () => {
  it('sees a task they took on a project they are not on, with its tick', async () => {
    const mine = await loadMyTasks({ user: w.p.ceo });
    expect(idsOf(mine)).toEqual([w.t.ceos.id]);
    expect(rowOf(mine, w.t.ceos.id)).toMatchObject({
      canManage: true,
      project: { name: 'internal-tool' },
    });
    expect(await db('projectMembers').where({ userId: w.p.ceo.id })).toEqual([]);
    expect(idsOf(await loadMyTasks({ user: w.p.meera }))).toEqual([w.t.meeras.id]);
  });
});

describe('employees and HR', () => {
  it('get nothing (they keep Today)', async () => {
    expect(await loadMyTasks({ user: w.p.vishal })).toEqual({
      tasks: [],
      more: false,
      today: TODAY,
      viewerId: w.p.vishal.id,
    });
    expect((await loadMyTasks({ user: w.p.neha })).tasks).toEqual([]);
  });
});

describe('the home card', () => {
  it('shows the first 6 by date under their headings', async () => {
    const card = await loadMyTasksCard({ user: w.p.pm });
    const { groups, total, more } = cardRows(card.tasks, 6, card.today);
    expect(groups.map((group) => [group.label, group.count])).toEqual([
      ['Overdue', 1],
      ['Today', 1],
      ['This week', 1],
      ['Later', 1],
      ['No date', 1],
    ]);
    expect([total, more]).toEqual([5, 0]);
  });

  it('reads as null when the tasks cannot be read, so the dashboard still shows', async () => {
    const spy = vi.spyOn(projectTasks, 'listMine').mockRejectedValueOnce(new Error('down'));
    expect(await loadMyTasksCard({ user: w.p.pm })).toBeNull();
    spy.mockRestore();
  });
});

describe('a long list', () => {
  it('stops at 200 rows and says there are more', async () => {
    const lots = await createUser({ name: 'Busy PM', role: 'pm', tracksAttendance: false });
    const project = await createProject(lots, { name: 'Big project' });
    await db('projectTasks').insert(
      Array.from({ length: 201 }, (_, index) => ({
        projectId: project.id,
        title: `Task ${index + 1}`,
        priority: 'p2',
        status: 'open',
        assigneeId: lots.id,
        createdBy: lots.id,
      })),
    );
    const mine = await loadMyTasks({ user: lots });
    expect(mine.tasks).toHaveLength(200);
    expect(mine.more).toBe(true);
    expect(groupByWhen(mine.tasks, mine.today).map((group) => group.label)).toEqual(['No date']);
  });
});
