// The Table view as it renders (CONTRACT 28, Table and bulk bar; Tests: taskTable), with
// react-dom/server: "Tasks of acme-store"; the columns per viewer (select boxes and ticks only for
// the project's PM and Admins, Time only in the PM view, Phase only while sorted); `aria-sort` only
// on the sorted header, with its chevron; done rows' boxes disabled; the group rows ("Current",
// "5 open", "+ Add task" with the hidden " to Testing", none on a done phase); "To do" and the
// report line; the person as a button for managers, a face for another PM, "For you" / "Anyone"
// for a member; the data attributes the motion reads; the empty row; the phone's stacked list; the
// bulk bar region and its buttons; "Group by phase again" under the toolbar while sorted. The
// browser path is tests/e2e/board-table.spec.js (F) and the review's screenshots in a copy.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({ actions: null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/12',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastSlot: () => null,
}));
vi.mock('@/app/(app)/projects/[id]/_board/TaskActionsProvider.jsx', () => ({
  useTaskActions: () => page.actions,
}));
vi.mock('@/app/(app)/projects/[id]/_board/TaskEditorProvider.jsx', () => ({
  useTaskEditor: () => null,
}));
vi.mock('@/components/task/TaskWindowProvider', () => ({ useTaskWindow: () => null }));

const { default: TaskTable } = await import('@/app/(app)/projects/[id]/_board/table/TaskTable.jsx');
const { default: BulkBar } = await import('@/app/(app)/projects/[id]/_board/table/BulkBar.jsx');
const { default: FilterLine } = await import('@/app/(app)/projects/[id]/_board/FilterLine.jsx');

const person = (id, name, extra = {}) => ({
  id,
  name,
  initials: name
    .split(' ')
    .map((part) => part[0])
    .join(''),
  role: 'employee',
  status: 'active',
  away: null,
  ...extra,
});
const SIMRAN = person(5, 'Simran Kaur');
const KAVYA = person(9, 'Kavya Reddy', { away: 'Not on the project' });

const task = (id, title, extra = {}) => ({
  id,
  title,
  priority: 'p2',
  status: 'open',
  phase: 'development',
  dueDate: '2026-11-27',
  assignee: null,
  statusChip: null,
  files: { count: 0, chips: [] },
  minutes: 0,
  ...extra,
});
const CHECKOUT = task(8, 'Checkout fix before client demo', {
  priority: 'p1',
  assignee: SIMRAN,
  statusChip: { status: 'in_progress', workDate: '2026-11-23' },
  files: { count: 4, chips: [] },
  minutes: 340,
});
const PAYMENT = task(9, 'Payment settings page', {
  assignee: KAVYA,
  statusChip: { status: 'blocked', workDate: '2026-11-19' },
});
const ZOOM = task(10, 'Product image zoom', { status: 'done' });
const ORDERS = task(41, 'Check the order emails', { phase: 'testing' });
const SCOPE = task(1, 'Scope signed off', { phase: 'design', status: 'done' });

const column = (key, label, extra = {}) => ({
  key,
  label,
  kind: 'phase',
  current: false,
  folded: false,
  finished: false,
  open: [],
  done: [],
  ...extra,
});
const COLUMNS = [
  column('design', 'Design', { folded: true, finished: true, done: [SCOPE] }),
  column('development', 'Development', { open: [CHECKOUT, PAYMENT], done: [ZOOM] }),
  column('testing', 'Testing', { current: true, open: [ORDERS] }),
];

const board = (access, extra = {}) => ({
  access,
  filesAccess: access === 'team' ? 'none' : access,
  status: 'active',
  projectId: 12,
  projectName: 'acme-store',
  viewerId: 3,
  today: '2026-11-24',
  tasks: [CHECKOUT, PAYMENT, ZOOM, ORDERS, SCOPE],
  columns: COLUMNS,
  counts: {},
  filters: { matches: () => true, any: false, showDone: false, state: {}, clear() {} },
  tableSort: { key: null, dir: 'ascending', set() {}, clear() {} },
  view: 'table',
  tick() {},
  addTask() {},
  openTask() {},
  ...extra,
});
const html = (access, extra) =>
  renderToStaticMarkup(createElement(TaskTable, { board: board(access, extra) }));
/** The table's part of the markup (the phone list comes after it). */
const tablePart = (markup) => markup.slice(0, markup.indexOf('data-stack'));
const stackPart = (markup) => markup.slice(markup.indexOf('data-stack'));
const count = (text, part) => text.split(part).length - 1;

beforeEach(() => {
  page.actions = { openPeople: vi.fn(), openMove: vi.fn() };
});

describe('the Table for the project’s PM and Admins', () => {
  it('is one table named for the project, its body and rows marked for the motion', () => {
    const table = html('manage');
    expect(table).toContain('aria-label="Tasks of acme-store"');
    expect(table).toContain('tabindex="-1"');
    expect(table).toContain('data-table-body=""');
    expect(tablePart(table)).toContain('data-flip="row:8"');
    expect(table).toMatch(/data-flip="row:8" data-person="5" data-phase="development"/);
    expect(table).toMatch(/data-flip="row:41" data-person="anyone" data-phase="testing"/);
    expect(table).toContain('data-flip="group:development"');
    expect(table).toContain('data-row-title=""');
  });

  it('has the select boxes, the tick and every column but Phase, in order', () => {
    const table = tablePart(html('manage'));
    expect(table).toContain('aria-label="Select all shown tasks"');
    expect(table).toContain('aria-label="Select Payment settings page"');
    expect(table).toContain('aria-label="Done: Payment settings page"');
    expect(table).toContain('<span class="visually-hidden">Done</span>');
    const heads = [...table.matchAll(/<button type="button" class="_sort[^>]*>([^<]+)/g)];
    expect(heads.map((match) => match[1])).toEqual([
      '#',
      'Task',
      'Person',
      'Priority',
      'Due',
      'Status',
      'Files',
      'Time',
    ]);
  });

  it('sorts nothing at first: no aria-sort, the rows grouped by phase', () => {
    const table = tablePart(html('manage'));
    expect(table).not.toContain('aria-sort');
    expect(table).toContain('data-flip="group:testing"');
  });

  it('says aria-sort only on the sorted header, lists flat and shows Phase while sorted', () => {
    const sorted = { key: 'files', dir: 'descending', set() {}, clear() {} };
    const table = tablePart(html('manage', { tableSort: sorted }));
    expect(count(table, 'aria-sort=')).toBe(1);
    expect(table).toMatch(/<th scope="col" aria-sort="descending"[^>]*><button[^>]*>Files<svg/);
    expect(table).toContain('lucide-chevron-down');
    expect(table).not.toContain('data-flip="group:');
    expect(table).toMatch(/>Phase</);
    expect(table).toContain('>Testing</td>');
  });

  it('disables a done row’s box (shown with "Show done tasks")', () => {
    const filters = { matches: () => true, any: false, showDone: true, state: {}, clear() {} };
    const table = tablePart(html('manage', { filters }));
    expect(table).toMatch(/aria-label="Select Product image zoom"[^>]*disabled=""/);
    expect(table).not.toMatch(/aria-label="Select Payment settings page"[^>]*disabled/);
    expect(table).toContain('data-flip="group:design"');
  });

  it('draws the groups with Current, the open count and "+ Add task" to that phase', () => {
    const table = tablePart(html('manage'));
    expect(table).toMatch(/>Development<\/h3><span class="_groupCount_[^"]*">2 open</);
    expect(table).toMatch(/>Testing<\/h3><span[^>]*>Current<\/span>/);
    expect(table).toContain('Add task<span class="visually-hidden"> to Testing</span>');
    expect(table).not.toContain('data-flip="group:design"');
  });

  it('has no "+ Add task" on a Completed project', () => {
    expect(html('manage', { status: 'completed' })).not.toContain('Add task');
  });

  it('writes the person as a button, the report line, the status and "To do"', () => {
    const table = tablePart(html('manage'));
    expect(table).toContain('aria-label="Assigned to Simran Kaur. Change person"');
    expect(table).toContain('aria-label="Assigned to anyone on the project. Change person"');
    expect(table).toContain('Anyone on the project');
    expect(table).toContain('Not on the project');
    expect(table).toContain('In progress · Mon, 23 Nov');
    expect(table).toContain('Blocked · Thu, 19 Nov');
    expect(table).toMatch(/title="Thu, 19 Nov"[^>]*>Blocked<span class="visually-hidden">, Thu/);
    expect(table).toContain('>To do<');
    expect(table).toContain('<span class="visually-hidden">4 files</span>');
    expect(table).toContain('5h 40m');
  });
});

describe('the Table for others', () => {
  it('gives another PM no box, no tick, a face that isn’t a button, and Time', () => {
    const table = tablePart(html('team'));
    expect(table).not.toContain('Select');
    expect(table).not.toContain('Done: ');
    expect(table).not.toContain('Change person');
    expect(table).toContain('Simran Kaur');
    expect(table).toContain('>Time<');
    expect(table).not.toContain('>Files<');
  });

  it('gives a member "For you" and "Anyone", no Time, no "+ Add task"', () => {
    const table = tablePart(html('member'));
    expect(table).toContain('For you');
    expect(table).toContain('Anyone<');
    expect(table).not.toContain('>Time<');
    expect(table).toContain('>Files<');
    expect(table).not.toContain('Add task');
    expect(table).not.toContain('Select');
  });

  it('says "No tasks match." while filtering with nothing left, and the member’s empty line', () => {
    const none = { matches: () => false, any: true, showDone: false, state: {}, clear() {} };
    expect(html('manage', { filters: none })).toContain('No tasks match.');
    const empty = { tasks: [], columns: [column('testing', 'Testing')] };
    expect(html('member', empty)).toContain('Nothing for you on this project yet.');
    expect(html('manage', empty)).toContain('No tasks yet.');
  });
});

describe('the phone’s stacked list', () => {
  it('has the same groups and a small card per task, with the box for managers', () => {
    const stack = stackPart(html('manage'));
    expect(stack).toContain('data-flip="group:testing"');
    expect(stack).toContain('data-flip="row:8"');
    expect(stack).toContain('aria-label="Select Checkout fix before client demo"');
    expect(stack).toContain('#8');
    expect(stack).toContain('Assigned to Simran Kaur. Change person');
    expect(stack).not.toContain('Done: ');
    expect(stack).not.toContain('In progress · Mon');
  });

  it('has no boxes for a member', () => {
    expect(stackPart(html('member'))).not.toContain('Select');
  });
});

describe('the bulk bar', () => {
  const bar = (props) =>
    renderToStaticMarkup(
      createElement(BulkBar, {
        count: 2,
        busy: null,
        onTake() {},
        onGive() {},
        onMove() {},
        onClear() {},
        ...props,
      }),
    );

  it('is a region "Selected tasks" with "2 selected" and its four controls', () => {
    const markup = bar();
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Selected tasks"');
    expect(markup).toContain('2 selected');
    for (const words of ['Assign to me', 'Give to…', 'Move to phase…', 'Clear']) {
      expect(markup).toContain(words);
    }
    expect(count(markup, 'aria-haspopup="dialog"')).toBe(2);
    expect(markup).not.toContain('aria-disabled');
  });

  it('turns the pressed button busy and makes the others wait', () => {
    const markup = bar({ busy: 'take' });
    expect(markup).toMatch(/aria-busy="true"[^>]*>.*lucide-loader-circle.*Assign to me/s);
    expect(count(markup, 'aria-disabled="true"')).toBe(4);
  });

  it('is not there without a selection', () => {
    expect(bar({ count: 0 })).toBe('');
  });
});

describe('the line under the toolbar', () => {
  it('offers "Group by phase again" while the Table is sorted, and not on the Board', () => {
    const line = (extra) =>
      renderToStaticMarkup(createElement(FilterLine, { board: board('manage', extra) }));
    const sorted = { key: 'due', dir: 'ascending', set() {}, clear() {} };
    expect(line({ tableSort: sorted })).toContain('Group by phase again');
    expect(line({})).not.toContain('Group by phase again');
    expect(line({ tableSort: sorted, view: 'board' })).not.toContain('Group by phase again');
  });
});
