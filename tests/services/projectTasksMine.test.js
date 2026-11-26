// My tasks and the badge (CONTRACT 28): listMine lists the viewer's open tasks on Active and On hold
// projects they are a member of or manage (the PM's own projects, another PM's project they are a
// member of with canManage false, any project for an Admin), by due date (none last), P1 to P3,
// then oldest; Completed projects, done tasks, Anyone tasks and projects someone was taken off are
// left out; `more` past the limit; countMineDue counts overdue plus today, not tomorrow, in one
// query; employees, HR and deactivated people get nothing.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase } from '../helpers/db.js';
import { addMembers, createProject } from './dashboardKit.js';

vi.mock('@/modules/reports', () => ({
  reports: {
    hasEntriesForProjectRequest: vi.fn(async () => false),
    moveProjectRequestEntries: vi.fn(async () => 0),
  },
}));

const T0 = '2026-11-23T05:00:00Z';
const TODAY = '2026-11-23';

let ceo; // Admin, not a member anywhere
let meera; // Admin, member of acme-store
let riya; // PM of acme-store and paused; member of pia's project
let pia; // PM of side
let vishal;
let hr;
let acme;
let paused; // on hold
let done; // completed
let side; // pia's project, riya is a member
let internal; // pia's project, nobody's member
const ids = {};

/** A task row straight into the table, so its created time and status can be set. */
async function task(project, title, overrides = {}) {
  const [id] = await db('projectTasks').insert({
    projectId: project.id,
    title,
    priority: 'p2',
    status: 'open',
    assigneeId: riya.id,
    createdBy: project.pmId,
    updatedBy: project.pmId,
    createdAt: new Date('2026-11-01T05:00:00Z'),
    updatedAt: new Date('2026-11-01T05:00:00Z'),
    ...overrides,
  });
  ids[title] = id;
  return id;
}

const titles = (result) => result.tasks.map((row) => row.title);

beforeAll(async () => {
  await resetDatabase();
  setNowForTests(T0);
  ceo = await createUser({ name: 'Arvind Menon', role: 'admin', tracksAttendance: false });
  meera = await createUser({ name: 'Meera Pillai', role: 'admin' });
  riya = await createUser({ name: 'Riya Kapoor', role: 'pm', tracksAttendance: false });
  pia = await createUser({ name: 'Pia Manager', role: 'pm', tracksAttendance: false });
  vishal = await createUser({ name: 'Vishal Saini' });
  hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  acme = await createProject(riya, { name: 'acme-store', color: 'teal' });
  paused = await createProject(riya, { name: 'paused', status: 'on_hold' });
  done = await createProject(riya, { name: 'finished', status: 'completed' });
  side = await createProject(pia, { name: 'side' });
  internal = await createProject(pia, { name: 'internal-tool' });
  await addMembers(acme, [vishal, meera]);
  await addMembers(side, [riya]);

  await task(acme, 'Overdue P2', { dueDate: '2026-11-20' });
  await task(acme, 'Today P1', { dueDate: TODAY, priority: 'p1' });
  await task(acme, 'Today P3', { dueDate: TODAY, priority: 'p3' });
  await task(acme, 'Tomorrow', { dueDate: '2026-11-24' });
  await task(acme, 'No date old', { createdAt: new Date('2026-10-01T05:00:00Z') });
  await task(acme, 'No date new');
  await task(paused, 'On hold task', { dueDate: '2026-11-22' });
  await task(done, 'Completed project task', { dueDate: '2026-11-01' });
  await task(acme, 'Done task', { status: 'done', dueDate: '2026-11-01' });
  await task(acme, 'Anyone task', { assigneeId: null, dueDate: '2026-11-01' });
  await task(side, 'On side as a member', { dueDate: '2026-12-01' });
  await task(internal, 'Approve the hosting invoice', { assigneeId: ceo.id, dueDate: TODAY });
  await task(acme, 'Meera took it', { assigneeId: meera.id });
  await task(acme, 'For Vishal', { assigneeId: vishal.id, dueDate: TODAY });
});

describe('listMine', () => {
  it("lists the PM's tasks by due date, none last, then P1 to P3, then oldest", async () => {
    const mine = await projectTasks.listMine({ viewer: riya, today: TODAY });
    expect(titles(mine)).toEqual([
      'Overdue P2',
      'On hold task',
      'Today P1',
      'Today P3',
      'Tomorrow',
      'On side as a member',
      'No date old',
      'No date new',
    ]);
    expect(mine.more).toBe(false);
  });

  it('gives each row its project and canManage (false on another PM project)', async () => {
    const mine = await projectTasks.listMine({ viewer: riya, today: TODAY });
    expect(mine.tasks.find((row) => row.title === 'Today P1')).toEqual({
      id: ids['Today P1'],
      projectId: acme.id,
      title: 'Today P1',
      priority: 'p1',
      status: 'open',
      assigneeId: riya.id,
      phase: null,
      dueDate: TODAY,
      project: { id: acme.id, name: 'acme-store', color: 'teal', status: 'active' },
      canManage: true,
    });
    expect(mine.tasks.find((row) => row.title === 'On hold task').project.status).toBe('on_hold');
    expect(mine.tasks.find((row) => row.title === 'On side as a member').canManage).toBe(false);
  });

  it('lists a task an Admin took on a project they are not on (the CEO)', async () => {
    const mine = await projectTasks.listMine({ viewer: ceo, today: TODAY });
    expect(titles(mine)).toEqual(['Approve the hosting invoice']);
    expect(mine.tasks[0].canManage).toBe(true);
    expect(titles(await projectTasks.listMine({ viewer: meera, today: TODAY }))).toEqual([
      'Meera took it',
    ]);
  });

  it('says `more` past the limit', async () => {
    const mine = await projectTasks.listMine({ viewer: riya, today: TODAY, limit: 3 });
    expect(titles(mine)).toEqual(['Overdue P2', 'On hold task', 'Today P1']);
    expect(mine.more).toBe(true);
  });

  it('gives employees, HR, deactivated people and no one nothing', async () => {
    for (const viewer of [vishal, hr, { ...riya, status: 'deactivated' }, null]) {
      expect(await projectTasks.listMine({ viewer, today: TODAY })).toEqual({
        tasks: [],
        more: false,
      });
    }
  });

  it('drops the tasks of a project the PM was taken off', async () => {
    await db('projectMembers').where({ projectId: side.id, userId: riya.id }).del();
    expect(titles(await projectTasks.listMine({ viewer: riya, today: TODAY }))).not.toContain(
      'On side as a member',
    );
    await addMembers(side, [riya]);
  });
});

describe('countMineDue', () => {
  it('counts overdue plus today (On hold in, Completed and done out), not tomorrow', async () => {
    expect(await projectTasks.countMineDue({ viewer: riya, today: TODAY })).toBe(4);
    expect(await projectTasks.countMineDue({ viewer: ceo, today: TODAY })).toBe(1);
    expect(await projectTasks.countMineDue({ viewer: meera, today: TODAY })).toBe(0);
    expect(await projectTasks.countMineDue({ viewer: riya, today: '2026-11-24' })).toBe(5);
  });

  it('runs one query, and none for people without My tasks', async () => {
    const sql = [];
    const record = (query) => sql.push(query.sql);
    db.on('query', record);
    await projectTasks.countMineDue({ viewer: riya, today: TODAY });
    const forRiya = sql.length;
    await projectTasks.countMineDue({ viewer: vishal, today: TODAY });
    await projectTasks.countMineDue({ viewer: hr, today: TODAY });
    await projectTasks.countMineDue({ viewer: riya, today: 'not a date' });
    db.removeListener('query', record);
    expect(forRiya).toBe(1);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/`project_tasks`/);
  });
});
