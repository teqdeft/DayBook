// The Table view's rows and columns (CONTRACT 28, Table and bulk bar; Tests: tableView): the columns
// per viewer and `filesAccess`; every sort and its reverse (no date, Anyone and No phase yet last
// both ways; Files and Time start "descending"; ties keep the board order); the groups as the
// board's columns (a folded done phase only with "Show done tasks", groups with no rows left out
// while filtering, No phase yet only with rows; open rows first, then done ones when shown); "+
// Add task" only for managers on an open project, never on a done phase or No phase yet; the
// Status column's words ("To do", "Done", the chips) and the line under a title; the empty row;
// a header's click sorting in its first direction (useTableSort, around the board's sort).
import { describe, expect, it, vi } from 'vitest';

const {
  SORTS,
  ariaSortFor,
  boardRank,
  canAddTo,
  columnsFor,
  emptyText,
  groupRows,
  phaseText,
  rowLine,
  sortRows,
  statusRank,
  statusText,
  tableRows,
} = await import('@/app/(app)/projects/[id]/_board/table/tableView.js');

const person = (id, name) => ({ id, name, role: 'employee', status: 'active', away: null });
const SIMRAN = person(5, 'Simran Kaur');
const VISHAL = person(6, 'Vishal Saini');
const RIYA = person(3, 'Riya Kapoor');

const task = (id, extra = {}) => ({
  id,
  title: `Task ${id}`,
  priority: 'p2',
  status: 'open',
  phase: 'development',
  dueDate: null,
  assignee: null,
  statusChip: null,
  files: { count: 0, chips: [] },
  minutes: 0,
  ...extra,
});

const ids = (rows) => rows.map((row) => row.id);

describe('columnsFor', () => {
  it('gives the project’s PM and Admins the select box, the tick, Files and Time', () => {
    expect(columnsFor('manage', 'manage')).toEqual([
      'select',
      'tick',
      'num',
      'task',
      'person',
      'priority',
      'due',
      'status',
      'files',
      'time',
    ]);
  });

  it('adds Phase after Task only while the rows are sorted', () => {
    const keys = columnsFor('manage', 'manage', { sorted: true });
    expect(keys.slice(2, 6)).toEqual(['num', 'task', 'phase', 'person']);
  });

  it('gives another PM no select box or tick but Time, and no Files without file access', () => {
    expect(columnsFor('team', 'none')).toEqual([
      'num',
      'task',
      'person',
      'priority',
      'due',
      'status',
      'time',
    ]);
  });

  it('gives a member #, Task, Person, Priority, Due, Status and Files (no Time)', () => {
    expect(columnsFor('member', 'member')).toEqual([
      'num',
      'task',
      'person',
      'priority',
      'due',
      'status',
      'files',
    ]);
  });
});

describe('sortRows', () => {
  const rows = [
    task(9, { title: 'Payment', priority: 'p2', dueDate: '2026-11-20', assignee: VISHAL }),
    task(8, { title: 'Checkout', priority: 'p1', dueDate: '2026-11-27', assignee: SIMRAN }),
    task(42, { title: 'Try a cart', priority: 'p3', dueDate: null, assignee: null }),
    task(37, { title: 'Write the plan', priority: 'p2', dueDate: '2026-11-27', assignee: RIYA }),
  ];
  const rank = new Map([
    [8, 0],
    [9, 1],
    [37, 2],
    [42, 3],
  ]);
  const sorted = (key, dir) => ids(sortRows(rows, { key, dir }, rank));

  it('sorts by number and by title, then reverses', () => {
    expect(sorted('num', 'ascending')).toEqual([8, 9, 37, 42]);
    expect(sorted('num', 'descending')).toEqual([42, 37, 9, 8]);
    expect(sorted('task', 'ascending')).toEqual([8, 9, 42, 37]);
    expect(sorted('task', 'descending')).toEqual([37, 42, 9, 8]);
  });

  it('keeps no date last both ways on Due, then P1 first among the same day', () => {
    expect(sorted('due', 'ascending')).toEqual([9, 8, 37, 42]);
    expect(sorted('due', 'descending')).toEqual([37, 8, 9, 42]);
  });

  it('keeps Anyone last both ways on Person (A to Z)', () => {
    expect(sorted('person', 'ascending')).toEqual([37, 8, 9, 42]);
    expect(sorted('person', 'descending')).toEqual([9, 8, 37, 42]);
  });

  it('sorts P1 first on Priority, then the soonest due date', () => {
    expect(sorted('priority', 'ascending')).toEqual([8, 9, 37, 42]);
    expect(sorted('priority', 'descending')).toEqual([42, 37, 9, 8]);
  });

  it('keeps No phase yet last both ways on Phase, in phase order, ties in the board order', () => {
    const list = [
      task(1, { phase: 'testing' }),
      task(2, { phase: null }),
      task(3, { phase: 'design' }),
      task(4, { phase: 'testing' }),
    ];
    const order = new Map([
      [3, 0],
      [4, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(ids(sortRows(list, { key: 'phase', dir: 'ascending' }, order))).toEqual([3, 4, 1, 2]);
    expect(ids(sortRows(list, { key: 'phase', dir: 'descending' }, order))).toEqual([4, 1, 3, 2]);
  });

  it('sorts Status as Blocked, In progress, To do, a Done line, then done tasks', () => {
    const line = (status) => ({ status, workDate: '2026-11-23' });
    const list = [
      task(1, { status: 'done' }),
      task(2, { statusChip: line('done') }),
      task(3),
      task(4, { statusChip: line('in_progress') }),
      task(5, { statusChip: line('blocked') }),
    ];
    expect(list.map(statusRank)).toEqual([4, 3, 2, 1, 0]);
    expect(ids(sortRows(list, { key: 'status', dir: 'ascending' }))).toEqual([5, 4, 3, 2, 1]);
    expect(ids(sortRows(list, { key: 'status', dir: 'descending' }))).toEqual([1, 2, 3, 4, 5]);
  });

  it('starts Files and Time "descending", most first, and reverses to fewest', () => {
    expect(SORTS.files.first).toBe('descending');
    expect(SORTS.time.first).toBe('descending');
    const list = [
      task(1, { files: { count: 1 }, minutes: 45 }),
      task(2, { files: { count: 4 }, minutes: 340 }),
      task(3, { files: { count: 0 }, minutes: 0 }),
    ];
    expect(ids(sortRows(list, { key: 'files', dir: 'descending' }))).toEqual([2, 1, 3]);
    expect(ids(sortRows(list, { key: 'files', dir: 'ascending' }))).toEqual([3, 1, 2]);
    expect(ids(sortRows(list, { key: 'time', dir: 'descending' }))).toEqual([2, 1, 3]);
  });

  it('breaks ties with the board order, and leaves the rows as they are for no sort', () => {
    const list = [task(1), task(2), task(3)];
    const order = new Map([
      [3, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(ids(sortRows(list, { key: 'files', dir: 'ascending' }, order))).toEqual([3, 1, 2]);
    expect(ids(sortRows(list, { key: null, dir: 'ascending' }, order))).toEqual([1, 2, 3]);
  });

  it('says the real direction only on the sorted header', () => {
    const sort = { key: 'files', dir: 'descending' };
    expect(ariaSortFor('files', sort)).toBe('descending');
    expect(ariaSortFor('due', sort)).toBeUndefined();
  });
});

const column = (key, extra = {}) => ({
  key,
  label: key[0].toUpperCase() + key.slice(1),
  kind: key === 'none' ? 'none' : 'phase',
  current: false,
  folded: false,
  finished: false,
  open: [],
  done: [],
  ...extra,
});
const filtersOf = (extra = {}) => ({
  matches: () => true,
  filtering: false,
  showDone: false,
  ...extra,
});

describe('groupRows', () => {
  const COLUMNS = [
    column('design', { folded: true, finished: true, done: [task(1, { status: 'done' })] }),
    column('development', {
      open: [task(8), task(9)],
      done: [task(10, { status: 'done' })],
    }),
    column('testing', { current: true, open: [task(37)] }),
    column('launch'),
    column('none', { open: [] }),
  ];

  it('groups as the board: a folded done phase and an empty No phase yet are left out', () => {
    const groups = groupRows(COLUMNS, filtersOf());
    expect(groups.map((group) => group.column.key)).toEqual(['development', 'testing', 'launch']);
    expect(ids(groups[0].rows)).toEqual([8, 9]);
    expect(groups[2].rows).toEqual([]);
  });

  it('adds the done rows after the open ones with "Show done tasks" (a folded phase too)', () => {
    const groups = groupRows(COLUMNS, filtersOf({ showDone: true }));
    expect(groups.map((group) => group.column.key)).toEqual([
      'design',
      'development',
      'testing',
      'launch',
    ]);
    expect(ids(groups[1].rows)).toEqual([8, 9, 10]);
  });

  it('hides the rows that don’t match while filtering, done ones too, and empty groups', () => {
    const matches = (one) => [9, 10].includes(one.id);
    const groups = groupRows(COLUMNS, filtersOf({ matches, filtering: true, showDone: true }));
    expect(groups.map((group) => group.column.key)).toEqual(['development']);
    expect(ids(groups[0].rows)).toEqual([9, 10]);
  });

  it('lists the rows flat while sorted, with the board order for ties; selectable = open', () => {
    const board = {
      columns: COLUMNS,
      filters: { matches: () => true, any: false, showDone: true },
    };
    const grouped = tableRows(board, { key: null, dir: 'ascending' });
    expect(grouped.flat).toBe(false);
    expect(ids(grouped.rows)).toEqual([1, 8, 9, 10, 37]);
    expect(ids(grouped.selectable)).toEqual([8, 9, 37]);
    const flat = tableRows(board, { key: 'num', dir: 'descending' });
    expect(flat.flat).toBe(true);
    expect(flat.groups).toEqual([]);
    expect(ids(flat.rows)).toEqual([37, 10, 9, 8, 1]);
    expect(boardRank(COLUMNS).get(10)).toBe(3);
  });
});

describe('the group’s "+ Add task"', () => {
  const manage = { access: 'manage', status: 'active' };

  it('is for managers on an open project, on a phase that isn’t done', () => {
    expect(canAddTo(column('testing'), manage)).toBe(true);
    expect(canAddTo(column('design', { finished: true }), manage)).toBe(false);
    expect(canAddTo(column('none'), manage)).toBe(false);
    expect(canAddTo(column('testing'), { access: 'manage', status: 'completed' })).toBe(false);
    expect(canAddTo(column('testing'), { access: 'team', status: 'active' })).toBe(false);
    expect(canAddTo(column('testing'), { access: 'member', status: 'active' })).toBe(false);
  });
});

describe('the words of a row', () => {
  const line = (status) => ({ status, workDate: '2026-11-23' });

  it('says "To do" without a line, "Done" for a done task, else the chip and its date', () => {
    expect(statusText(task(1))).toEqual({ text: 'To do', tone: null, date: null });
    expect(statusText(task(1, { status: 'done', statusChip: line('blocked') }))).toEqual({
      text: 'Done',
      tone: 'green',
      date: null,
    });
    expect(statusText(task(1, { statusChip: line('blocked') }))).toEqual({
      text: 'Blocked',
      tone: 'red',
      date: 'Mon, 23 Nov',
    });
    expect(statusText(task(1, { statusChip: line('in_progress') })).text).toBe('In progress');
  });

  it('writes the report line under an open task’s title, never under a done one', () => {
    expect(rowLine(task(1, { statusChip: line('blocked') }))).toEqual({
      text: 'Blocked · Mon, 23 Nov',
      tone: 'red',
    });
    expect(rowLine(task(1, { statusChip: line('in_progress') }))).toEqual({
      text: 'In progress · Mon, 23 Nov',
      tone: 'primary',
    });
    expect(rowLine(task(1, { statusChip: line('done') }))?.tone).toBe('green');
    expect(rowLine(task(1, { status: 'done', statusChip: line('done') }))).toBeNull();
    expect(rowLine(task(1))).toBeNull();
  });

  it('names the phase, or "No phase yet"', () => {
    expect(phaseText(task(1, { phase: 'testing' }))).toBe('Testing');
    expect(phaseText(task(1, { phase: null }))).toBe('No phase yet');
  });
});

describe('emptyText', () => {
  it('says "No tasks match." while filtering, else only when there are no tasks at all', () => {
    expect(emptyText({ rows: 0, filtering: true, access: 'manage', total: 5 })).toBe(
      'No tasks match.',
    );
    expect(emptyText({ rows: 0, filtering: false, access: 'manage', total: 5 })).toBeNull();
    expect(emptyText({ rows: 0, filtering: false, access: 'manage', total: 0 })).toBe(
      'No tasks yet.',
    );
    expect(emptyText({ rows: 0, filtering: false, access: 'member', total: 0 })).toBe(
      'Nothing for you on this project yet.',
    );
    expect(emptyText({ rows: 3, filtering: true, access: 'manage', total: 3 })).toBeNull();
  });
});

describe('useTableSort', () => {
  it('sorts a header in its first direction (the board toggles a second click) and says it', async () => {
    const { useTableSort } = await import('@/app/(app)/projects/[id]/_board/table/useTableSort.js');
    const set = vi.fn();
    const sort = useTableSort(
      { tableSort: { key: 'due', dir: 'descending', set } },
      { current: null },
    );
    expect(sort.sorted).toBe(true);
    expect(sort.ariaSort('due')).toBe('descending');
    expect(sort.ariaSort('files')).toBeUndefined();
    sort.sortBy('files');
    expect(set).toHaveBeenLastCalledWith('files', 'descending');
    sort.sortBy('due');
    expect(set).toHaveBeenLastCalledWith('due', 'ascending');
    sort.sortBy('select');
    expect(set).toHaveBeenCalledTimes(2);
    const none = useTableSort({}, { current: null });
    expect(none.sorted).toBe(false);
  });
});
