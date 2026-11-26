// The board's filters (CONTRACT 28, Board toolbar, filters, faces, Mine and search; boardFilters.js):
// the search ("#9", "9", "pay", "404" in a title, case and accents), Critical, With files, Overdue
// (the company's today), Blocked, Show done (no fading and no line on its own; it counts in the
// badge), Mine, one face, Anyone, and their combination; the counts (open tasks only); the line
// under the toolbar; the faces in order (the PM first, then A to Z, at most 5 then "+n", Anyone
// apart); open cards faded on the Board, done cards never; rows hidden in the Table; `?show=`.
import { describe, expect, it } from 'vitest';
import {
  ANYONE,
  FACES_SHOWN,
  anyoneLabel,
  badgeCount,
  faceLabel,
  facesOf,
  filterCounts,
  filterLine,
  firstFilters,
  isDimmed,
  isFiltering,
  matches,
  menuItems,
  noFilters,
  searchMatches,
} from '@/app/(app)/projects/[id]/_board/boardFilters';

const TODAY = '2026-11-23';
const RIYA = { id: 7, name: 'Riya Kapoor', avatarUrl: null, initials: 'RK' };
const VISHAL = { id: 9, name: 'Vishal Saini', avatarUrl: null, initials: 'VS' };
const SIMRAN = { id: 11, name: 'Simran Kaur', avatarUrl: null, initials: 'SK' };

const task = (id, more = {}) => ({
  id,
  title: `Task ${id}`,
  priority: 'p2',
  status: 'open',
  phase: 'development',
  dueDate: null,
  assignee: null,
  statusChip: null,
  files: { count: 0, chips: [] },
  fileCount: 0,
  ...more,
});
const withFiles = (count) => ({ files: { count, chips: [] }, fileCount: count });

const TASKS = [
  task(9, { title: 'Payment settings page', assignee: VISHAL, dueDate: '2026-11-20' }),
  task(8, {
    title: 'Checkout fix before client demo',
    priority: 'p1',
    assignee: SIMRAN,
    ...withFiles(3),
    statusChip: { status: 'in_progress', workDate: '2026-11-23' },
  }),
  task(41, { title: 'Fix the 404 page', assignee: RIYA, dueDate: TODAY }),
  task(88, {
    title: 'Café menu',
    priority: 'p1',
    statusChip: { status: 'blocked', workDate: '2026-11-19' },
  }),
  task(12, {
    title: 'Old done one',
    status: 'done',
    priority: 'p1',
    ...withFiles(1),
    dueDate: '2026-11-01',
  }),
];
const ids = (list) => list.map((one) => one.id);
const on = (more) => ({ ...noFilters(), ...more });
const matching = (filters, viewerId = 7) =>
  ids(TASKS.filter((one) => matches(one, filters, viewerId, TODAY)));

describe('the search', () => {
  it('finds a title that contains the text, whatever the case', () => {
    expect(searchMatches(TASKS[0], 'pay')).toBe(true);
    expect(searchMatches(TASKS[0], '  PAYMENT ')).toBe(true);
    expect(searchMatches(TASKS[0], 'checkout')).toBe(false);
    expect(searchMatches(TASKS[0], '')).toBe(true);
  });

  it('finds a task by "#9" and by "9", and digits in a title too', () => {
    expect(ids(TASKS.filter((one) => searchMatches(one, '#9')))).toEqual([9]);
    expect(ids(TASKS.filter((one) => searchMatches(one, '9')))).toEqual([9]);
    expect(ids(TASKS.filter((one) => searchMatches(one, '404')))).toEqual([41]);
    expect(ids(TASKS.filter((one) => searchMatches(one, '#88')))).toEqual([88]);
    expect(ids(TASKS.filter((one) => searchMatches(one, '# 8')))).toEqual([8]);
  });

  it('matches accented titles however the letters were typed (NFC)', () => {
    const decomposed = 'café';
    expect(searchMatches(TASKS[3], decomposed)).toBe(true);
    expect(searchMatches(TASKS[3], 'CAFÉ')).toBe(true);
  });
});

describe('the menu items, Mine and the faces', () => {
  it('keeps Critical, With files, Overdue and Blocked tasks', () => {
    expect(matching(on({ critical: true }))).toEqual([8, 88, 12]);
    expect(matching(on({ files: true }))).toEqual([8, 12]);
    expect(matching(on({ overdue: true }))).toEqual([9]);
    expect(matching(on({ blocked: true }))).toEqual([88]);
  });

  it("keeps the viewer's own tasks with Mine, one person's with a face, Anyone's", () => {
    expect(matching(on({ mine: true }), 7)).toEqual([41]);
    expect(matching(on({ face: 11 }))).toEqual([8]);
    expect(matching(on({ face: ANYONE }))).toEqual([88, 12]);
  });

  it('combines them: every one that is on must match', () => {
    expect(matching(on({ critical: true, query: 'café' }))).toEqual([88]);
    expect(matching(on({ critical: true, face: 11 }))).toEqual([8]);
    expect(matching(on({ critical: true, mine: true }), 7)).toEqual([]);
  });

  it('never takes a task out with Show done tasks', () => {
    const filters = on({ showDone: true });
    expect(matching(filters)).toEqual(ids(TASKS));
    expect(isFiltering(filters)).toBe(false);
    expect(badgeCount(filters)).toBe(1);
    expect(filterLine({ count: 4, view: 'board', filters })).toBeNull();
    expect(TASKS.some((one) => isDimmed(one, filters, 7, TODAY))).toBe(false);
  });

  it('counts the items that are on in the badge, Mine, faces and search apart', () => {
    expect(badgeCount(noFilters())).toBe(0);
    expect(badgeCount(on({ critical: true, overdue: true, showDone: true }))).toBe(3);
    expect(badgeCount(on({ mine: true, face: 9, query: 'pay' }))).toBe(0);
  });
});

describe('fading and hiding', () => {
  it('fades the open cards that do not match on the Board, never a done card', () => {
    const filters = on({ critical: true });
    const faded = TASKS.filter((one) => isDimmed(one, filters, 7, TODAY));
    expect(ids(faded)).toEqual([9, 41]);
    // the done P1 is never faded further, and a done card that doesn't match neither
    expect(isDimmed(task(3, { status: 'done' }), filters, 7, TODAY)).toBe(false);
    expect(TASKS.some((one) => isDimmed(one, noFilters(), 7, TODAY))).toBe(false);
  });

  it('hides the rows that do not match in the Table, done rows too', () => {
    const filters = on({ query: 'page' });
    expect(matching(filters)).toEqual([9, 41]);
    expect(matches(TASKS[4], filters, 7, TODAY)).toBe(false);
  });
});

describe('the counts and the words', () => {
  it('counts open tasks only', () => {
    expect(filterCounts(TASKS, 7, TODAY)).toEqual({
      critical: 2,
      files: 1,
      overdue: 1,
      blocked: 1,
      mine: 1,
    });
  });

  it('names the menu items, With files only for a viewer who may see files', () => {
    const counts = filterCounts(TASKS, 7, TODAY);
    expect(menuItems(counts).map((item) => item.label)).toEqual([
      'Critical (2)',
      'With files (1)',
      'Overdue (1)',
      'Blocked (1)',
      'Show done tasks',
    ]);
    expect(menuItems(counts, { files: false }).map((item) => item.key)).toEqual([
      'critical',
      'overdue',
      'blocked',
      'showDone',
    ]);
  });

  it('says what changed under the toolbar, counting open tasks', () => {
    const filters = on({ critical: true });
    expect(filterLine({ count: 3, view: 'board', filters })).toEqual({
      text: '3 tasks match. The others are faded.',
      clear: 'Clear all',
    });
    expect(filterLine({ count: 3, view: 'table', filters }).text).toBe('3 tasks match.');
    expect(filterLine({ count: 1, view: 'table', filters }).text).toBe('1 task matches.');
    expect(filterLine({ count: 1, view: 'board', filters }).text).toBe(
      '1 task matches. The others are faded.',
    );
    expect(filterLine({ count: 0, view: 'board', filters }).text).toBe('No tasks match.');
    expect(filterLine({ count: 2, view: 'board', filters: noFilters() })).toBeNull();
  });

  it('offers "Show everyone" when only a face is on', () => {
    expect(filterLine({ count: 1, view: 'board', filters: on({ face: 9 }) }).clear).toBe(
      'Show everyone',
    );
    expect(
      filterLine({ count: 1, view: 'board', filters: on({ face: 9, showDone: true }) }).clear,
    ).toBe('Show everyone');
    expect(
      filterLine({ count: 1, view: 'board', filters: on({ face: 9, mine: true }) }).clear,
    ).toBe('Clear all');
  });
});

describe('the faces', () => {
  it('lists people with open tasks, the PM first, then A to Z, and Anyone apart', () => {
    const tasks = [
      ...TASKS,
      task(50, { assignee: { id: 20, name: 'Aarav Shah' } }),
      task(51, { assignee: SIMRAN }),
      task(52, { assignee: { id: 21, name: 'Zoya Ali' }, status: 'done' }),
    ];
    const { people, anyone } = facesOf(tasks, 7);
    expect(people.map((face) => [face.name, face.count])).toEqual([
      ['Riya Kapoor', 1],
      ['Aarav Shah', 1],
      ['Simran Kaur', 2],
      ['Vishal Saini', 1],
    ]);
    expect(anyone).toBe(1);
    expect(faceLabel(people[2])).toBe("Show only Simran Kaur's tasks (2)");
    expect(anyoneLabel(anyone)).toBe('Show only tasks for anyone on the project (1)');
  });

  it('shows 5 faces, then "+n" for the rest', () => {
    const tasks = Array.from({ length: 7 }, (_, index) =>
      task(100 + index, { assignee: { id: 200 + index, name: `Person ${index}` } }),
    );
    const { people } = facesOf(tasks, null);
    expect(FACES_SHOWN).toBe(5);
    expect(people.slice(FACES_SHOWN).map((face) => face.name)).toEqual(['Person 5', 'Person 6']);
  });
});

describe('what the page opens with', () => {
  it('ticks Critical or With files from ?show= for the PM view', () => {
    expect(firstFilters({ access: 'manage', filesAccess: 'manage', show: 'critical' })).toEqual(
      on({ critical: true }),
    );
    expect(firstFilters({ access: 'team', filesAccess: 'member', show: ['files'] })).toEqual(
      on({ files: true }),
    );
  });

  it('ticks nothing for With files without file rights, for a member, or anything else', () => {
    expect(firstFilters({ access: 'team', filesAccess: 'none', show: 'files' })).toEqual(
      noFilters(),
    );
    expect(firstFilters({ access: 'member', filesAccess: 'member', show: 'critical' })).toEqual(
      noFilters(),
    );
    expect(firstFilters({ access: 'manage', filesAccess: 'manage', show: 'all' })).toEqual(
      noFilters(),
    );
  });
});
