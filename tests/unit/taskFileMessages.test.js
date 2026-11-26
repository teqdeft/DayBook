// Task notifications with files (CONTRACT 27, Notifications): the files line (at most 3 names, then
// "and 2 more"), placed right after the first sentence and before the note, kept when a long note
// is cut to 500; files_added's title cut to 200 and its body with at most 5 names; every link opens
// the task on the project page; told and toldName from the people reached. CONTRACT 28: the files
// line and files_added name uploads and project files linked in the same save together.
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
// shared.js (the priority labels) also holds the writes' checks; their modules aren't used here.
vi.mock('@/modules/projects', () => ({ projects: {} }));
vi.mock('@/modules/audit', () => ({ audit: {} }));

const { filesLine, fit, sendAdded, sendChanged, sendFilesAdded, toldOf } =
  await import('@/modules/projectTasks/messages');

const actor = { id: 1, name: 'Riya Kapoor', status: 'active' };
const vishal = { id: 2, name: 'Vishal Saini', status: 'active' };
const simran = { id: 3, name: 'Simran Kaur', status: 'active' };
const gone = { id: 4, name: 'Gus Gone', status: 'deactivated' };
const project = { id: 12, name: 'acme-store' };
const members = [vishal, simran, gone];

const files = (...names) => names.map((name, index) => ({ id: index + 1, name }));
const task = (overrides = {}) => ({
  id: 88,
  projectId: 12,
  title: 'Fix the login page',
  priority: 'p1',
  status: 'open',
  assigneeId: vishal.id,
  details: null,
  ...overrides,
});

beforeEach(() => {
  sent.length = 0;
});

describe('filesLine', () => {
  it('names one file', () => {
    expect(filesLine(files('brief.pdf'))).toBe('1 file attached: brief.pdf.');
  });

  it('names up to 3 files', () => {
    expect(filesLine(files('a.pdf', 'b.png', 'c.docx'))).toBe(
      '3 files attached: a.pdf, b.png, c.docx.',
    );
  });

  it('names 3 of 5 files, then "and 2 more"', () => {
    expect(filesLine(files('a.pdf', 'b.png', 'c.docx', 'd.txt', 'e.md'))).toBe(
      '5 files attached: a.pdf, b.png, c.docx and 2 more.',
    );
  });

  it('is empty without files', () => {
    expect(filesLine([])).toBe('');
    expect(filesLine(undefined)).toBe('');
  });
});

describe('project_task.added with files', () => {
  it('puts the files line after the first sentence and before the note', async () => {
    const reached = await sendAdded(
      {
        task: task({ details: 'Use the new logo.' }),
        project,
        members,
        manager: null,
        actor,
        files: files('brief.pdf', 'logo.png'),
      },
      null,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      userIds: [vishal.id],
      type: 'project_task.added',
      title: 'New P1 task on acme-store: Fix the login page',
      body: 'Riya Kapoor assigned it to you. 2 files attached: brief.pdf, logo.png. Use the new logo.',
      link: '/projects/12?task=88',
    });
    expect(reached).toEqual([{ id: vishal.id, name: 'Vishal Saini' }]);
    expect(toldOf(reached, task())).toEqual({ told: 'person', toldName: 'Vishal Saini' });
  });

  it('keeps the file names when a 1,000-character note is cut to 500', async () => {
    const note = 'Check every step of the flow. '.repeat(40).slice(0, 1000);
    await sendAdded(
      {
        task: task({ details: note }),
        project,
        members,
        manager: null,
        actor,
        files: files('a.pdf', 'b.png', 'c.docx', 'd.txt', 'e.md'),
      },
      null,
    );
    const { body } = sent[0];
    expect(body.length).toBeLessThanOrEqual(500);
    expect(
      body.startsWith(
        'Riya Kapoor assigned it to you. 5 files attached: a.pdf, b.png, c.docx and 2 more. Check',
      ),
    ).toBe(true);
    expect(body.endsWith('…')).toBe(true);
  });

  it('has no files line without files', async () => {
    await sendAdded({ task: task(), project, members, manager: null, actor }, null);
    expect(sent[0].body).toBe('Riya Kapoor assigned it to you.');
  });

  it('tells every active member of an Anyone task, never the actor or a deactivated one', async () => {
    const reached = await sendAdded(
      {
        task: task({ assigneeId: null }),
        project,
        members: [...members, actor],
        manager: null,
        actor,
        files: files('brief.pdf'),
      },
      null,
    );
    expect(sent[0].userIds).toEqual([vishal.id, simran.id]);
    expect(sent[0].body).toBe(
      'Riya Kapoor added it for anyone on the project. 1 file attached: brief.pdf.',
    );
    expect(toldOf(reached, task({ assigneeId: null }))).toEqual({
      told: 'members',
      toldName: null,
    });
  });

  it('tells nobody, and toldOf says null, when the person is away or the actor', async () => {
    for (const assigneeId of [gone.id, actor.id, 99]) {
      const reached = await sendAdded(
        { task: task({ assigneeId }), project, members, manager: actor, actor },
        null,
      );
      expect(reached).toEqual([]);
      expect(toldOf(reached, task({ assigneeId }))).toEqual({ told: null, toldName: null });
    }
    expect(sent).toEqual([]);
  });
});

describe('project_task.changed with files', () => {
  it('adds the files line when the same save added files', async () => {
    await sendChanged(
      {
        before: task({ priority: 'p2' }),
        task: task(),
        project,
        members,
        manager: null,
        actor,
        files: files('brief.pdf'),
      },
      null,
    );
    expect(sent[0]).toMatchObject({
      type: 'project_task.changed',
      title: 'Fix the login page on acme-store is now P1',
      body: 'Riya Kapoor changed it from P2 to P1. 1 file attached: brief.pdf.',
      link: '/projects/12?task=88',
    });
  });

  it('is as before without files', async () => {
    await sendChanged(
      { before: task({ priority: 'p2' }), task: task(), project, members, manager: null, actor },
      null,
    );
    expect(sent[0].body).toBe('Riya Kapoor changed it from P2 to P1.');
  });
});

describe('project_task.files_added', () => {
  it('names the actor, the count and the task, and up to 5 files in the body', async () => {
    await sendFilesAdded(
      {
        task: task(),
        project,
        members,
        manager: null,
        actor,
        files: files('brief.pdf', 'logo.png'),
      },
      null,
    );
    expect(sent[0]).toEqual({
      userIds: [vishal.id],
      type: 'project_task.files_added',
      title: 'Riya Kapoor added 2 files to Fix the login page',
      body: 'acme-store: brief.pdf, logo.png',
      link: '/projects/12?task=88',
    });
    sent.length = 0;
    await sendFilesAdded(
      {
        task: task(),
        project,
        members,
        manager: null,
        actor,
        files: files('a.pdf', 'b.png', 'c.docx', 'd.txt', 'e.md', 'f.zip', 'g.mp4'),
      },
      null,
    );
    expect(sent[0].body).toBe('acme-store: a.pdf, b.png, c.docx, d.txt, e.md and 2 more');
    sent.length = 0;
    await sendFilesAdded(
      { task: task(), project, members, manager: null, actor, files: files('brief.pdf') },
      null,
    );
    expect(sent[0].title).toBe('Riya Kapoor added 1 file to Fix the login page');
  });

  it('cuts the title to 200 characters', async () => {
    const title = `Fix ${'the checkout page '.repeat(11)}`.trim().slice(0, 200);
    await sendFilesAdded(
      { task: task({ title }), project, members, manager: null, actor, files: files('a.pdf') },
      null,
    );
    expect(sent[0].title.length).toBeLessThanOrEqual(200);
    expect(sent[0].title.startsWith('Riya Kapoor added 1 file to Fix the checkout page')).toBe(
      true,
    );
    expect(sent[0].title.endsWith('…')).toBe(true);
  });

  it('sends nothing for a done task or without files', async () => {
    expect(
      await sendFilesAdded(
        {
          task: task({ status: 'done' }),
          project,
          members,
          manager: null,
          actor,
          files: files('a'),
        },
        null,
      ),
    ).toEqual([]);
    expect(
      await sendFilesAdded(
        { task: task(), project, members, manager: null, actor, files: [] },
        null,
      ),
    ).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('reaches the PM as the person even when the PM is not a member', async () => {
    const pm = { id: 7, name: 'Paul Manager', status: 'active' };
    const reached = await sendFilesAdded(
      {
        task: task({ assigneeId: pm.id }),
        project,
        members,
        manager: pm,
        actor,
        files: files('a.pdf'),
      },
      null,
    );
    expect(sent[0].userIds).toEqual([pm.id]);
    expect(toldOf(reached, task({ assigneeId: pm.id }))).toEqual({
      told: 'person',
      toldName: 'Paul Manager',
    });
  });
});

describe('uploads and links together (CONTRACT 28)', () => {
  const linked = (id, name) => ({ id, name, linked: true });

  it('names the uploads and the linked project files in one files line', async () => {
    await sendAdded(
      {
        task: task(),
        project,
        members,
        manager: null,
        actor,
        files: [...files('brief.pdf', 'logo.png'), linked(9, 'contract.pdf')],
      },
      null,
    );
    expect(sent[0].body).toBe(
      'Riya Kapoor assigned it to you. 3 files attached: brief.pdf, logo.png, contract.pdf.',
    );
  });

  it('names both in one files_added for the batch', async () => {
    await sendFilesAdded(
      {
        task: task(),
        project,
        members,
        manager: null,
        actor,
        files: [...files('brief.pdf'), linked(9, 'acme-brand-guide.pdf')],
      },
      null,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'project_task.files_added',
      title: 'Riya Kapoor added 2 files to Fix the login page',
      body: 'acme-store: brief.pdf, acme-brand-guide.pdf',
    });
  });

  it('puts linked files in the changed files line', async () => {
    await sendChanged(
      {
        before: task({ assigneeId: simran.id }),
        task: task(),
        project,
        members,
        manager: null,
        actor,
        files: [linked(9, 'acme-brand-guide.pdf')],
      },
      null,
    );
    expect(sent[0].body).toBe(
      'Riya Kapoor assigned it to you. 1 file attached: acme-brand-guide.pdf.',
    );
  });
});

describe('fit', () => {
  it('cuts at a word with an ellipsis', () => {
    expect(fit('one two three', 9)).toBe('one two…');
    expect(fit('short', 9)).toBe('short');
  });
});
