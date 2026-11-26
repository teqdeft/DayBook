// The assignee rule (CONTRACT 28, The assignee rule): assertAssignee accepts anyone on the project
// (null), an active member (any role, tracked or not), the project's PM while active, an active
// Admin setting themself on any project, and the task's current person unchanged, and nothing
// else; teamOf's `others` holds the active Admins among alsoIds who are neither members nor the
// PM; recipients reaches such an Admin, while Anyone still reaches active members only.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  listProjectMembers: vi.fn(),
  findPerson: vi.fn(),
  findPeople: vi.fn(),
}));
vi.mock('@/modules/projectTasks/repo', () => repo);
vi.mock('@/modules/projects', () => ({ projects: {} }));
vi.mock('@/modules/audit', () => ({ audit: {} }));
vi.mock('@/modules/notifications', () => ({ notifications: { notify: vi.fn() } }));

const { ASSIGNEE_MESSAGE, assertAssignee } = await import('@/modules/projectTasks/assignees');
const writes = await import('@/modules/projectTasks/writes');
const { personOf, teamOf } = await import('@/modules/projectTasks/shared');
const { recipients } = await import('@/modules/projectTasks/messages');

const person = (id, name, role = 'employee', extra = {}) => ({
  id,
  name,
  role,
  status: 'active',
  tracksAttendance: true,
  ...extra,
});
const riya = person(1, 'Riya Kapoor', 'pm', { tracksAttendance: false });
const vishal = person(2, 'Vishal Saini');
const simran = person(3, 'Simran Kaur');
const gone = person(4, 'Gus Gone', 'employee', { status: 'deactivated' });
const untracked = person(5, 'Uma Untracked', 'employee', { tracksAttendance: false });
const meera = person(6, 'Meera Pillai', 'admin'); // an Admin on the project
const arvind = person(7, 'Arvind Menon', 'admin', { tracksAttendance: false }); // not on it
const otherAdmin = person(8, 'Omar Admin', 'admin', { tracksAttendance: false }); // not on it
const otherPm = person(9, 'Pia Manager', 'pm', { tracksAttendance: false }); // not on it
const deactivatedAdmin = person(10, 'Dee Admin', 'admin', { status: 'deactivated' });

const team = { members: [vishal, simran, gone, untracked, meera], manager: riya, others: [] };

function refused(run) {
  let error = null;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({
    code: 'VALIDATION_FAILED',
    fields: { assigneeId: ASSIGNEE_MESSAGE },
    message: ASSIGNEE_MESSAGE,
  });
}

describe('assertAssignee', () => {
  it('is the writes function too, with the unchanged words', () => {
    expect(writes.assertAssignee).toBe(assertAssignee);
    expect(ASSIGNEE_MESSAGE).toBe('Pick someone who is on this project, or anyone on the project.');
  });

  it('accepts anyone on the project (null)', () => {
    expect(() => assertAssignee(null, team, { actor: riya })).not.toThrow();
  });

  it('accepts an active member, tracked or not, of any role', () => {
    for (const member of [vishal, untracked, meera]) {
      expect(() => assertAssignee(member.id, team, { actor: riya }), member.name).not.toThrow();
    }
  });

  it('refuses a deactivated member', () => {
    refused(() => assertAssignee(gone.id, team, { actor: riya }));
  });

  it('accepts the project PM while active, and refuses them once deactivated', () => {
    expect(() => assertAssignee(riya.id, team, { actor: meera })).not.toThrow();
    const awayPm = { ...team, manager: { ...riya, status: 'deactivated' } };
    refused(() => assertAssignee(riya.id, awayPm, { actor: meera }));
  });

  it('accepts an active Admin setting themself on a project they are not on', () => {
    expect(() => assertAssignee(arvind.id, team, { actor: arvind })).not.toThrow();
  });

  it('refuses a deactivated Admin setting themself', () => {
    refused(() => assertAssignee(deactivatedAdmin.id, team, { actor: deactivatedAdmin }));
  });

  it('refuses an Admin giving a task to another Admin who is not a member', () => {
    refused(() => assertAssignee(otherAdmin.id, team, { actor: arvind }));
    // even when that Admin is reachable through `others`
    refused(() =>
      assertAssignee(otherAdmin.id, { ...team, others: [otherAdmin] }, { actor: arvind }),
    );
  });

  it('refuses a PM giving a task to an Admin or another PM who is not a member', () => {
    refused(() => assertAssignee(arvind.id, team, { actor: riya }));
    refused(() => assertAssignee(otherPm.id, team, { actor: riya }));
    // a PM can't use the "themself" rule on someone else's project either
    refused(() => assertAssignee(otherPm.id, team, { actor: otherPm }));
  });

  it("keeps the task's current person unchanged, away or an Admin who took it", () => {
    expect(() =>
      assertAssignee(gone.id, team, { actor: riya, before: { assigneeId: gone.id } }),
    ).not.toThrow();
    expect(() =>
      assertAssignee(arvind.id, team, { actor: riya, before: { assigneeId: arvind.id } }),
    ).not.toThrow();
    refused(() =>
      assertAssignee(gone.id, team, { actor: riya, before: { assigneeId: vishal.id } }),
    );
  });

  it('works without a context (1.12 callers)', () => {
    expect(() => assertAssignee(vishal.id, team)).not.toThrow();
    refused(() => assertAssignee(arvind.id, team));
  });
});

describe('teamOf', () => {
  beforeEach(() => {
    repo.listProjectMembers.mockReset().mockResolvedValue([vishal, simran, gone]);
    repo.findPerson.mockReset().mockResolvedValue(riya);
    repo.findPeople.mockReset();
  });

  it('finds the active Admins among alsoIds who are neither members nor the PM as `others`', async () => {
    repo.findPeople.mockResolvedValue([arvind, otherPm, deactivatedAdmin]);
    const found = await teamOf({ id: 12, pmId: riya.id }, null, {
      alsoIds: [arvind.id, vishal.id, riya.id, null, otherPm.id, deactivatedAdmin.id, arvind.id],
    });
    expect(found.members).toEqual([vishal, simran, gone]);
    expect(found.manager).toEqual(riya);
    expect(found.others).toEqual([arvind]);
    // members and the PM are never read again; repeats and nulls are dropped
    expect(repo.findPeople).toHaveBeenCalledWith(
      [arvind.id, otherPm.id, deactivatedAdmin.id],
      null,
    );
  });

  it('reads nobody more without alsoIds, as 1.12', async () => {
    repo.findPeople.mockResolvedValue([]);
    const found = await teamOf({ id: 12, pmId: riya.id }, null);
    expect(found).toEqual({ members: [vishal, simran, gone], manager: riya, others: [] });
    expect(repo.findPeople).toHaveBeenCalledWith([], null);
  });

  it('personOf finds a team person, else reads the row, and null is anyone', async () => {
    const found = { members: [vishal], manager: riya, others: [arvind] };
    expect(await personOf(found, arvind.id)).toEqual({
      id: arvind.id,
      name: 'Arvind Menon',
      role: 'admin',
      status: 'active',
    });
    expect(await personOf(found, null)).toBeNull();
    repo.findPerson.mockResolvedValueOnce(gone);
    expect(await personOf(found, gone.id)).toMatchObject({ id: gone.id, status: 'deactivated' });
    repo.findPerson.mockResolvedValueOnce(undefined);
    expect(await personOf(found, 999)).toMatchObject({ id: 999, status: 'deactivated' });
  });
});

describe('recipients', () => {
  const withOthers = { ...team, others: [arvind] };

  it('reaches an Admin in `others` who took the task', () => {
    expect(
      recipients({ task: { assigneeId: arvind.id }, ...withOthers, actorId: riya.id }),
    ).toEqual([arvind]);
  });

  it('never reaches the actor, a deactivated person or someone not on the team', () => {
    expect(
      recipients({ task: { assigneeId: arvind.id }, ...withOthers, actorId: arvind.id }),
    ).toEqual([]);
    expect(recipients({ task: { assigneeId: gone.id }, ...withOthers, actorId: riya.id })).toEqual(
      [],
    );
    expect(
      recipients({ task: { assigneeId: otherPm.id }, ...withOthers, actorId: riya.id }),
    ).toEqual([]);
  });

  it('sends a task for anyone to active members only, never the PM or `others`', () => {
    const people = recipients({ task: { assigneeId: null }, ...withOthers, actorId: vishal.id });
    expect(people.map((row) => row.name)).toEqual(['Simran Kaur', 'Uma Untracked', 'Meera Pillai']);
  });

  it('reaches the PM as the task person', () => {
    expect(recipients({ task: { assigneeId: riya.id }, ...team, actorId: meera.id })).toEqual([
      riya,
    ]);
  });
});
