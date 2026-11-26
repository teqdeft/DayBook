// The earlier person's notice and the Table's grouped sends (CONTRACT 28, Notifications):
// `project_task.reassigned` titles and bodies ("took it", "gave it to", "opened it to anyone"),
// linked to the board; not sent when the earlier person is the actor, deactivated, not reachable,
// already reached by the members' `changed`, or the task is done; the grouped bulk texts for 1, 2
// and 5 tasks ("and 2 more"), one per person, cut to 200 and 500 after placing the titles.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent = [];
vi.mock('@/modules/notifications', () => ({
  notifications: {
    notify: vi.fn(async (input) => {
      sent.push(input);
      return input.userIds.length;
    }),
  },
}));
vi.mock('@/modules/projects', () => ({ projects: {} }));
vi.mock('@/modules/audit', () => ({ audit: {} }));

const { reassignedText, sendReassigned, titleList, toldEarlierOf } =
  await import('@/modules/projectTasks/messages');
const { sendBulkChanged, sendBulkReassigned } = await import('@/modules/projectTasks/bulkMessages');

const riya = { id: 1, name: 'Riya Kapoor', role: 'pm', status: 'active' };
const vishal = { id: 2, name: 'Vishal Saini', role: 'employee', status: 'active' };
const simran = { id: 3, name: 'Simran Kaur', role: 'employee', status: 'active' };
const gone = { id: 4, name: 'Gus Gone', role: 'employee', status: 'deactivated' };
const arvind = { id: 7, name: 'Arvind Menon', role: 'admin', status: 'active' };
const project = { id: 12, name: 'acme-store', pmId: riya.id };
const team = { members: [vishal, simran, gone], manager: riya, others: [arvind] };

const TITLES = [
  'Fix the login page',
  'Payment settings page',
  'Checkout fix before client demo',
  'Order emails',
  'Refund flow',
];

const task = (overrides = {}) => ({
  id: 88,
  projectId: 12,
  title: 'Fix the login page',
  priority: 'p1',
  status: 'open',
  assigneeId: vishal.id,
  assignee: { id: vishal.id, name: vishal.name },
  ...overrides,
});
const forPerson = (who, overrides = {}) =>
  task({ assigneeId: who.id, assignee: { id: who.id, name: who.name }, ...overrides });
const forAnyone = (overrides = {}) => task({ assigneeId: null, assignee: null, ...overrides });

beforeEach(() => {
  sent.length = 0;
});

describe('project_task.reassigned to the earlier person', () => {
  it('says the actor took it', async () => {
    const reached = await sendReassigned(
      { before: forPerson(simran), task: forPerson(arvind), project, team, actor: arvind },
      null,
    );
    expect(sent).toEqual([
      {
        userIds: [simran.id],
        type: 'project_task.reassigned',
        title: 'Fix the login page on acme-store is now for Arvind Menon',
        body: 'Arvind Menon took it.',
        link: '/projects/12',
      },
    ]);
    expect(reached).toEqual([{ id: simran.id, name: 'Simran Kaur' }]);
    expect(toldEarlierOf(reached)).toBe('Simran Kaur');
  });

  it('says who the actor gave it to', async () => {
    await sendReassigned(
      { before: forPerson(simran), task: forPerson(vishal), project, team, actor: riya },
      null,
    );
    expect(sent[0]).toMatchObject({
      userIds: [simran.id],
      title: 'Fix the login page on acme-store is now for Vishal Saini',
      body: 'Riya Kapoor gave it to Vishal Saini.',
    });
  });

  it('tells an earlier PM (not a member) when the task is opened to anyone', async () => {
    await sendReassigned(
      { before: forPerson(riya), task: forAnyone(), project, team, actor: arvind },
      null,
    );
    expect(sent[0]).toMatchObject({
      userIds: [riya.id],
      title: 'Fix the login page on acme-store is now open to anyone',
      body: 'Arvind Menon opened it to anyone on the project.',
      link: '/projects/12',
    });
  });

  it('tells an Admin among `others` who had taken it', async () => {
    await sendReassigned(
      { before: forPerson(arvind), task: forPerson(vishal), project, team, actor: riya },
      null,
    );
    expect(sent[0].userIds).toEqual([arvind.id]);
  });

  it('cuts the title to 200 characters', async () => {
    const long = `Fix ${'very '.repeat(60)}long title`;
    await sendReassigned(
      {
        before: forPerson(simran, { title: long }),
        task: forPerson(vishal, { title: long }),
        project,
        team,
        actor: riya,
      },
      null,
    );
    expect(sent[0].title.length).toBeLessThanOrEqual(200);
    expect(sent[0].title.endsWith('…')).toBe(true);
  });

  it.each([
    ['the earlier person is the actor', forPerson(riya), forPerson(vishal), riya],
    ['the earlier person is deactivated', forPerson(gone), forPerson(vishal), riya],
    [
      'the earlier person is not reachable (taken off)',
      forPerson({ id: 99, name: 'Ex Member' }),
      forPerson(vishal),
      riya,
    ],
    ['the members were told by changed', forPerson(simran), forAnyone(), riya],
    ['the task is done', forPerson(simran), forPerson(vishal, { status: 'done' }), riya],
    ['the task was for anyone', forAnyone(), forPerson(vishal), riya],
    ['the person did not change', forPerson(simran), forPerson(simran), riya],
  ])('sends nothing when %s', async (_, before, after, actor) => {
    const reached = await sendReassigned({ before, task: after, project, team, actor }, null);
    expect(reached).toEqual([]);
    expect(sent).toEqual([]);
    expect(toldEarlierOf(reached)).toBeNull();
  });
});

describe('titleList', () => {
  it('names 1, 2 and 3 titles, then 3 and "and 2 more"', () => {
    expect(titleList(TITLES.slice(0, 1))).toBe('Fix the login page');
    expect(titleList(TITLES.slice(0, 2))).toBe('Fix the login page and Payment settings page');
    expect(titleList(TITLES.slice(0, 3))).toBe(
      'Fix the login page, Payment settings page and Checkout fix before client demo',
    );
    expect(titleList(TITLES)).toBe(
      'Fix the login page, Payment settings page, Checkout fix before client demo and 2 more',
    );
  });

  it('builds the grouped reassigned text for several tasks', () => {
    const tasks = TITLES.slice(0, 2).map((title, index) =>
      forPerson(riya, { id: index + 1, title }),
    );
    expect(reassignedText({ tasks, project, actor: riya })).toEqual({
      title: '2 of your tasks on acme-store are now for Riya Kapoor',
      body: 'Riya Kapoor took them: Fix the login page and Payment settings page.',
    });
  });
});

/** n tasks moving from `from` to `to` (null = anyone), as bulk change pairs. */
function pairs(n, from, to, overrides = {}) {
  return TITLES.slice(0, n).map((title, index) => {
    const id = 100 + index;
    const before = from ? forPerson(from, { id, title }) : forAnyone({ id, title });
    const after = to ? forPerson(to, { id, title, ...overrides }) : forAnyone({ id, title });
    return { before, task: after };
  });
}

describe('the grouped bulk sends', () => {
  it('uses the single texts and the task link for one task', async () => {
    const told = await sendBulkChanged(
      { changes: pairs(1, simran, vishal), project, team, actor: riya },
      null,
    );
    const earlier = await sendBulkReassigned(
      { changes: pairs(1, simran, vishal), project, team, actor: riya },
      null,
    );
    expect(sent).toEqual([
      {
        userIds: [vishal.id],
        type: 'project_task.changed',
        title: 'P1 task on acme-store assigned to you: Fix the login page',
        body: 'Riya Kapoor assigned it to you.',
        link: '/projects/12?task=100',
      },
      {
        userIds: [simran.id],
        type: 'project_task.reassigned',
        title: 'Fix the login page on acme-store is now for Vishal Saini',
        body: 'Riya Kapoor gave it to Vishal Saini.',
        link: '/projects/12',
      },
    ]);
    expect(told).toEqual({ people: [{ id: vishal.id, name: 'Vishal Saini' }], members: false });
    expect(earlier).toEqual([{ id: simran.id, name: 'Simran Kaur' }]);
  });

  it('sends one notification per person for 2 tasks, linked to the board', async () => {
    await sendBulkChanged({ changes: pairs(2, simran, vishal), project, team, actor: riya }, null);
    await sendBulkReassigned(
      { changes: pairs(2, simran, vishal), project, team, actor: riya },
      null,
    );
    expect(sent).toEqual([
      {
        userIds: [vishal.id],
        type: 'project_task.changed',
        title: '2 tasks on acme-store assigned to you',
        body: 'Riya Kapoor assigned them to you: Fix the login page and Payment settings page.',
        link: '/projects/12',
      },
      {
        userIds: [simran.id],
        type: 'project_task.reassigned',
        title: '2 of your tasks on acme-store are now for Vishal Saini',
        body: 'Riya Kapoor gave them to Vishal Saini: Fix the login page and Payment settings page.',
        link: '/projects/12',
      },
    ]);
  });

  it('names 3 of 5 titles and "and 2 more", and says "took them" for the actor', async () => {
    await sendBulkReassigned(
      { changes: pairs(5, simran, arvind), project, team, actor: arvind },
      null,
    );
    expect(sent).toEqual([
      {
        userIds: [simran.id],
        type: 'project_task.reassigned',
        title: '5 of your tasks on acme-store are now for Arvind Menon',
        body:
          'Arvind Menon took them: Fix the login page, Payment settings page, Checkout fix ' +
          'before client demo and 2 more.',
        link: '/projects/12',
      },
    ]);
  });

  it('tells every active member once for tasks opened to anyone, and an earlier PM', async () => {
    const changes = pairs(2, riya, null);
    const told = await sendBulkChanged({ changes, project, team, actor: arvind }, null);
    await sendBulkReassigned({ changes, project, team, actor: arvind }, null);
    expect(sent).toEqual([
      {
        userIds: [vishal.id, simran.id],
        type: 'project_task.changed',
        title: '2 tasks on acme-store are open to anyone',
        body:
          'Arvind Menon opened them to anyone on the project: Fix the login page and Payment ' +
          'settings page.',
        link: '/projects/12',
      },
      {
        userIds: [riya.id],
        type: 'project_task.reassigned',
        title: '2 of your tasks on acme-store are now open to anyone',
        body:
          'Arvind Menon opened them to anyone on the project: Fix the login page and Payment ' +
          'settings page.',
        link: '/projects/12',
      },
    ]);
    expect(told).toEqual({ people: [], members: true });
  });

  it('never tells an earlier member twice when tasks open to anyone', async () => {
    await sendBulkReassigned({ changes: pairs(2, simran, null), project, team, actor: riya }, null);
    expect(sent).toEqual([]);
  });

  it('leaves done tasks out', async () => {
    const changes = pairs(2, simran, vishal, { status: 'done' });
    expect(await sendBulkChanged({ changes, project, team, actor: riya }, null)).toEqual({
      people: [],
      members: false,
    });
    expect(await sendBulkReassigned({ changes, project, team, actor: riya }, null)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('cuts the title to 200 and the body to 500 after placing the titles', async () => {
    const long = (index) => `${index} ${'Long task title '.repeat(12)}`.trim();
    const changes = [0, 1, 2, 3].map((index) => ({
      before: forPerson(simran, { id: index + 1, title: long(index) }),
      task: forPerson(vishal, { id: index + 1, title: long(index) }),
    }));
    const projectWithLongName = { ...project, name: `acme-${'store'.repeat(40)}` };
    await sendBulkChanged({ changes, project: projectWithLongName, team, actor: riya }, null);
    expect(sent[0].title.length).toBeLessThanOrEqual(200);
    expect(sent[0].body.length).toBeLessThanOrEqual(500);
    expect(sent[0].body.startsWith('Riya Kapoor assigned them to you: 0 Long task title')).toBe(
      true,
    );
    expect(sent[0].body.endsWith('…')).toBe(true);
  });
});
