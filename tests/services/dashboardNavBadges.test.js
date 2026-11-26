// The My tasks badge in the sidebar (CONTRACT 28, "My tasks and the badge"): getNavBadges adds
// `myTasks`, projectTasks.countMineDue for PMs and Admins (the company's today from the settings),
// 0 for employees, HR, a deactivated person and nobody, also when the person has nothing to
// approve (the approval badges' early return). The wiring is checked against a stand-in count,
// then the real count (overdue plus due today, B's mine.js).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { dashboard } from '@/modules/dashboard';
import { projectTasks } from '@/modules/projectTasks';
import { createUser, resetDatabase } from '../helpers/db.js';

// The approval rights this file takes from one person, to reach the early return with a PM.
const NO_APPROVALS = new Set();
const APPROVAL_KEYS = ['report.approve_edit', 'project_request.handle', 'attendance.correct'];

vi.mock('@/lib/permissions', async (importOriginal) => {
  const original = await importOriginal();
  const can = (user, key) =>
    NO_APPROVALS.has(user?.id) && APPROVAL_KEYS.includes(key) ? false : original.can(user, key);
  return { ...original, can };
});

vi.mock('@/modules/projectTasks', async (importOriginal) => {
  const original = await importOriginal();
  const countMineDue = vi.fn((...args) => original.projectTasks.countMineDue(...args));
  return { ...original, projectTasks: { ...original.projectTasks, countMineDue } };
});

const TODAY = '2026-11-24'; // a Tuesday, Asia/Kolkata (the seeded company timezone)

let people;

beforeAll(async () => {
  await resetDatabase();
  // 01:30 on Tuesday in Kolkata, still Monday in UTC: the badge counts by the company's day.
  setNowForTests('2026-11-23T20:00:00Z');
  people = {
    pm: await createUser({ role: 'pm', tracksAttendance: false }),
    ceo: await createUser({ role: 'admin', tracksAttendance: false }),
    meera: await createUser({ role: 'admin', tracksAttendance: true }),
    vishal: await createUser({ role: 'employee' }),
    neha: await createUser({ role: 'hr' }),
  };
});

afterAll(() => {
  NO_APPROVALS.clear();
});

describe('getNavBadges: myTasks', () => {
  const countMineDue = projectTasks.countMineDue;

  beforeEach(() => {
    countMineDue.mockReset();
    countMineDue.mockImplementation(async ({ viewer }) => (viewer.role === 'pm' ? 3 : 1));
  });

  it("counts a PM's and an Admin's tasks due now, with the company's today", async () => {
    expect(await dashboard.getNavBadges(people.pm)).toEqual({
      requests: 0,
      corrections: 0,
      myTasks: 3,
    });
    expect(await dashboard.getNavBadges(people.ceo)).toMatchObject({ myTasks: 1 });
    expect(await dashboard.getNavBadges(people.meera)).toMatchObject({ myTasks: 1 });
    expect(countMineDue.mock.calls).toEqual([
      [{ viewer: people.pm, today: TODAY }],
      [{ viewer: people.ceo, today: TODAY }],
      [{ viewer: people.meera, today: TODAY }],
    ]);
  });

  it('gives employees, HR, a deactivated PM and nobody 0, without counting', async () => {
    expect(await dashboard.getNavBadges(people.vishal)).toEqual({
      requests: 0,
      corrections: 0,
      myTasks: 0,
    });
    expect(await dashboard.getNavBadges(people.neha)).toEqual({
      requests: 0,
      corrections: 0,
      myTasks: 0,
    });
    const gone = { ...people.pm, status: 'deactivated' };
    expect(await dashboard.getNavBadges(gone)).toEqual({ requests: 0, corrections: 0, myTasks: 0 });
    expect(await dashboard.getNavBadges(null)).toEqual({ requests: 0, corrections: 0, myTasks: 0 });
    expect(countMineDue).not.toHaveBeenCalled();
  });

  it("the approval badges' early return doesn't hide it", async () => {
    NO_APPROVALS.add(people.pm.id);
    try {
      expect(await dashboard.getNavBadges(people.pm)).toEqual({
        requests: 0,
        corrections: 0,
        myTasks: 3,
      });
    } finally {
      NO_APPROVALS.delete(people.pm.id);
    }
  });

  it('a failed count fails the badges, as a failed approval count does (the frame shows none)', async () => {
    countMineDue.mockRejectedValueOnce(new Error('connection lost'));
    await expect(dashboard.getNavBadges(people.pm)).rejects.toThrow('connection lost');
  });
});

describe('getNavBadges: myTasks from the real count', () => {
  let ids;

  /** One project of the PM (active unless `fields` say otherwise); returns its id. */
  async function addProject(name, fields = {}) {
    const client = await db('clients').first('id');
    const [id] = await db('projects').insert({
      name,
      clientId: client.id,
      pmId: people.pm.id,
      createdBy: people.pm.id,
      ...fields,
    });
    return id;
  }

  let count = 0;

  /** One task; returns its id. */
  async function addTask(projectId, assignee, fields = {}) {
    count += 1;
    const [id] = await db('projectTasks').insert({
      projectId,
      title: `Task ${count}`,
      assigneeId: assignee?.id ?? null,
      createdBy: people.pm.id,
      ...fields,
    });
    return id;
  }

  beforeAll(async () => {
    projectTasks.countMineDue.mockReset();
    const original = await vi.importActual('@/modules/projectTasks');
    projectTasks.countMineDue.mockImplementation(original.projectTasks.countMineDue);
    ids = {
      store: await addProject('acme-store'),
      hold: await addProject('pos-app', { status: 'on_hold' }),
      done: await addProject('old-site', { status: 'completed', completedAt: new Date() }),
    };
    await db('projectMembers').insert({ projectId: ids.store, userId: people.vishal.id });
    const { pm, ceo, vishal } = people;
    await addTask(ids.store, pm, { dueDate: '2026-11-20' }); // overdue
    await addTask(ids.store, pm, { dueDate: TODAY });
    await addTask(ids.store, pm, { dueDate: '2026-11-25' }); // tomorrow: not yet
    await addTask(ids.store, pm); // no date
    await addTask(ids.store, pm, { dueDate: '2026-11-20', status: 'done', doneAt: new Date() });
    await addTask(ids.hold, pm, { dueDate: TODAY }); // On hold projects count
    await addTask(ids.done, pm, { dueDate: TODAY }); // a Completed project doesn't
    await addTask(ids.store, ceo, { dueDate: TODAY }); // the CEO took it, not a member
    await addTask(ids.store, vishal, { dueDate: TODAY });
    await addTask(ids.store, null, { dueDate: TODAY }); // Anyone
  });

  it('counts overdue and due today on Active and On hold projects, never Completed', async () => {
    expect(await dashboard.getNavBadges(people.pm)).toMatchObject({ myTasks: 3 });
    expect(await dashboard.getNavBadges(people.ceo)).toMatchObject({ myTasks: 1 });
    expect(await dashboard.getNavBadges(people.meera)).toMatchObject({ myTasks: 0 });
    expect(await dashboard.getNavBadges(people.vishal)).toMatchObject({ myTasks: 0 });
  });
});
