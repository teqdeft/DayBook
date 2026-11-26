// Who sees and does what (CONTRACT 27): the permission table as data, every viewer row against every
// kind of file and document, plus the edges (a deleted file, a task file without its task, an
// inactive viewer, a ctx for one project never seeing another project's file or document). Then
// CONTRACT 28's table of linked files as data: every viewer row against an Everyone and an "Only PM
// and Admins" project file linked to the person's task, to an Anyone task, to no task, and after the
// unlink; a link whose task is on another project never counts.
import { describe, expect, it } from 'vitest';
import {
  accessShape,
  canManageFiles,
  canReadDocument,
  canSeeFile,
  filesAccess,
} from '@/modules/projectFiles/access';

const PROJECT = 12;
const PERSON = 7; // the task's person
const EARLIER = 8; // the task's person before it was reassigned to PERSON
const OTHER = 9;

const ctxOf = ({ userId = OTHER, active = true, manages = false, member = false }) => ({
  projectId: PROJECT,
  userId,
  active,
  manages,
  member,
});

const file = (extra) => ({ projectId: PROJECT, status: 'active', task: null, ...extra });
const doc = (extra) => ({ projectId: PROJECT, kind: 'note', fileId: null, ...extra });

const KINDS = {
  projectEveryone: () => canSee(file({ scope: 'project', visibility: 'everyone' })),
  projectManagers: () => canSee(file({ scope: 'project', visibility: 'managers' })),
  taskForPerson: () =>
    canSee(file({ scope: 'task', visibility: 'managers', task: { assigneeId: PERSON } })),
  taskAnyone: () =>
    canSee(file({ scope: 'task', visibility: 'managers', task: { assigneeId: null } })),
  docEveryone: () =>
    canRead(doc({ visibility: 'everyone' })) &&
    canRead(doc({ kind: 'file', fileId: null, visibility: 'everyone' })),
  docManagers: () =>
    canRead(doc({ visibility: 'managers' })) ||
    canRead(doc({ kind: 'file', fileId: null, visibility: 'managers' })),
  fileText: () =>
    canRead(doc({ kind: 'file', fileId: 31, visibility: 'managers' })) ||
    canRead(doc({ kind: 'file', fileId: 31, visibility: 'everyone' })),
  manage: () => canManageFiles(current),
};

let current;
const canSee = (value) => canSeeFile(current, value);
const canRead = (value) => canReadDocument(current, value);

const Y = true;
const N = false;
// [viewer, ctx, projectEveryone, projectManagers, taskForPerson, taskAnyone, docEveryone,
//  docManagers, fileText, manage, filesAccess]
const TABLE = [
  ['the project PM', { manages: true }, Y, Y, Y, Y, Y, Y, Y, Y, 'manage'],
  ['an Admin (the CEO)', { manages: true }, Y, Y, Y, Y, Y, Y, Y, Y, 'manage'],
  [
    "a member, the task's person",
    { userId: PERSON, member: true },
    Y,
    N,
    Y,
    Y,
    Y,
    N,
    N,
    N,
    'member',
  ],
  ["a member, not the task's person", { member: true }, Y, N, N, Y, Y, N, N, N, 'member'],
  ['HR on the project (a member)', { member: true }, Y, N, N, Y, Y, N, N, N, 'member'],
  ['HR not on the project', {}, N, N, N, N, N, N, N, N, 'none'],
  ['another PM, not a member', {}, N, N, N, N, N, N, N, N, 'none'],
  ['another PM who is a member', { member: true }, Y, N, N, Y, Y, N, N, N, 'member'],
  ['someone taken off the project', { userId: PERSON }, N, N, N, N, N, N, N, N, 'none'],
  [
    "the task's earlier person",
    { userId: EARLIER, member: true },
    Y,
    N,
    N,
    Y,
    Y,
    N,
    N,
    N,
    'member',
  ],
  [
    'a deactivated PM',
    { manages: true, member: true, active: false },
    N,
    N,
    N,
    N,
    N,
    N,
    N,
    N,
    'none',
  ],
  [
    'a deactivated member',
    { userId: PERSON, member: true, active: false },
    N,
    N,
    N,
    N,
    N,
    N,
    N,
    N,
    'none',
  ],
];

describe('the permission table (CONTRACT 27, Who sees and does what)', () => {
  const names = Object.keys(KINDS);
  for (const [viewer, ctx, ...expected] of TABLE) {
    const access = expected.pop();
    it(`${viewer}: every kind of file and document`, () => {
      current = ctxOf(ctx);
      const actual = Object.fromEntries(names.map((name) => [name, KINDS[name]()]));
      expect(actual).toEqual(Object.fromEntries(names.map((name, i) => [name, expected[i]])));
      expect(filesAccess(current)).toBe(access);
    });
  }
});

describe('canSeeFile edges', () => {
  const pm = ctxOf({ manages: true });
  const member = ctxOf({ userId: PERSON, member: true });

  it('never shows a deleted file, even to the PM', () => {
    const deleted = file({ scope: 'project', visibility: 'everyone', status: 'deleted' });
    expect(canSeeFile(pm, deleted)).toBe(false);
    expect(canSeeFile(member, deleted)).toBe(false);
  });

  it('never shows a task file whose task is gone', () => {
    const orphan = file({ scope: 'task', task: null });
    expect(canSeeFile(pm, orphan)).toBe(false);
    expect(canSeeFile(member, orphan)).toBe(false);
  });

  it('a ctx for project 12 never sees a file of project 13', () => {
    const elsewhere = { ...file({ scope: 'project', visibility: 'everyone' }), projectId: 13 };
    expect(canSeeFile(pm, elsewhere)).toBe(false);
    expect(canSeeFile(member, elsewhere)).toBe(false);
    const anyone = { ...file({ scope: 'task', task: { assigneeId: null } }), projectId: '13' };
    expect(canSeeFile(member, anyone)).toBe(false);
  });

  it('compares ids as numbers (a string id from the database or a URL)', () => {
    const own = file({ scope: 'task', task: { assigneeId: String(PERSON) } });
    expect(canSeeFile({ ...member, projectId: String(PROJECT) }, own)).toBe(true);
  });

  it('answers false for a missing ctx or file, and for an unknown scope', () => {
    expect(canSeeFile(null, file({ scope: 'project', visibility: 'everyone' }))).toBe(false);
    expect(canSeeFile(member, null)).toBe(false);
    expect(canSeeFile(member, file({ scope: 'other', visibility: 'everyone' }))).toBe(false);
  });

  it('a missing visibility is Only PM and Admins', () => {
    expect(canSeeFile(member, file({ scope: 'project' }))).toBe(false);
    expect(canSeeFile(pm, file({ scope: 'project' }))).toBe(true);
  });
});

describe('canReadDocument edges', () => {
  const pm = ctxOf({ manages: true });
  const member = ctxOf({ member: true });

  it('a ctx for project 12 never reads a document of project 13', () => {
    const elsewhere = { ...doc({ visibility: 'everyone' }), projectId: 13 };
    expect(canReadDocument(pm, elsewhere)).toBe(false);
    expect(canReadDocument(member, elsewhere)).toBe(false);
  });

  it('an inactive viewer reads nothing', () => {
    expect(canReadDocument({ ...pm, active: false }, doc({ visibility: 'everyone' }))).toBe(false);
  });

  it('a missing visibility is Only PM and Admins; a missing fileId is text only', () => {
    expect(canReadDocument(member, doc({}))).toBe(false);
    expect(
      canReadDocument(member, { projectId: PROJECT, kind: 'file', visibility: 'everyone' }),
    ).toBe(true);
  });
});

describe('canManageFiles and filesAccess', () => {
  it('needs an active manager', () => {
    expect(canManageFiles(ctxOf({ manages: true }))).toBe(true);
    expect(canManageFiles(ctxOf({ manages: true, active: false }))).toBe(false);
    expect(canManageFiles(ctxOf({ member: true }))).toBe(false);
    expect(canManageFiles(null)).toBe(false);
  });

  it("a PM who is a member of another PM's project gets the member's file rights", () => {
    expect(filesAccess(ctxOf({ member: true }))).toBe('member');
    expect(filesAccess(ctxOf({ manages: true, member: true }))).toBe('manage');
    expect(filesAccess(null)).toBe('none');
  });
});

// ---------- CONTRACT 28: files linked to tasks ----------

const LINKS = {
  person: [{ taskId: 88, assigneeId: PERSON, projectId: PROJECT }],
  anyone: [{ taskId: 89, assigneeId: null, projectId: PROJECT }],
  none: undefined, // a 1.12 shape: no links read at all
  unlinked: [],
};
const linked = (visibility, links) => file({ scope: 'project', visibility, links });

// [viewer, ctx, Everyone file linked to: the person's task, an Anyone task, no task, after the
//  unlink; then the same for an "Only PM and Admins" file]
const LINK_TABLE = [
  ['the project PM', { manages: true }, Y, Y, Y, Y, Y, Y, Y, Y],
  ['an Admin who is a member', { manages: true, member: true }, Y, Y, Y, Y, Y, Y, Y, Y],
  ['an Admin who is not a member', { manages: true }, Y, Y, Y, Y, Y, Y, Y, Y],
  ['a member, the task person', { userId: PERSON, member: true }, Y, Y, Y, Y, Y, Y, N, N],
  ['a member, not the task person', { member: true }, Y, Y, Y, Y, N, Y, N, N],
  ['HR on the project (a member)', { member: true }, Y, Y, Y, Y, N, Y, N, N],
  ['HR not on the project', {}, N, N, N, N, N, N, N, N],
  ['another PM, not a member', {}, N, N, N, N, N, N, N, N],
  ['another PM who is a member', { member: true }, Y, Y, Y, Y, N, Y, N, N],
  ['someone taken off the project', { userId: PERSON }, N, N, N, N, N, N, N, N],
  [
    'the earlier person (the task is now PERSON)',
    { userId: EARLIER, member: true },
    Y,
    Y,
    Y,
    Y,
    N,
    Y,
    N,
    N,
  ],
  ['a deactivated member', { userId: PERSON, member: true, active: false }, N, N, N, N, N, N, N, N],
];

describe('linked files (CONTRACT 28, Links: who sees a linked file)', () => {
  const cases = ['everyone', 'managers'].flatMap((visibility) =>
    Object.entries(LINKS).map(([on, links]) => [`${visibility}:${on}`, linked(visibility, links)]),
  );
  for (const [viewer, ctx, ...expected] of LINK_TABLE) {
    it(`${viewer}: an Everyone and an Only PM and Admins file, linked or not`, () => {
      const viewerCtx = ctxOf(ctx);
      const actual = Object.fromEntries(
        cases.map(([key, one]) => [key, canSeeFile(viewerCtx, one)]),
      );
      expect(actual).toEqual(Object.fromEntries(cases.map(([key], i) => [key, expected[i]])));
    });
  }

  it('never counts a link whose task is on another project', () => {
    const member = ctxOf({ userId: PERSON, member: true });
    const elsewhere = [{ taskId: 90, assigneeId: PERSON, projectId: 13 }];
    expect(canSeeFile(member, linked('managers', elsewhere))).toBe(false);
    const anyoneElsewhere = [{ taskId: 91, assigneeId: null, projectId: '13' }];
    expect(canSeeFile(member, linked('managers', anyoneElsewhere))).toBe(false);
    expect(canSeeFile(member, linked('managers', [...elsewhere, ...LINKS.person]))).toBe(true);
  });

  it('accessShape carries the links of the database, [] by default', () => {
    const row = { projectId: PROJECT, scope: 'project', status: 'active', visibility: 'managers' };
    expect(accessShape(row)).toEqual({ ...row, task: null, links: [] });
    expect(accessShape(row, LINKS.person).links).toEqual(LINKS.person);
    const taskRow = { ...row, scope: 'task', taskRowId: 88, taskAssigneeId: null };
    expect(accessShape(taskRow).task).toEqual({ assigneeId: null });
  });
});
