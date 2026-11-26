// The Table's selection and bulk bar (CONTRACT 28, Bulk actions in the Table; Table and bulk bar;
// Tests: bulkView): the 100 cap (a box and "Select all shown tasks"), rows that leave the
// selection, the header box; what each bulk action sends; the toasts for 1 and n counting the
// answer's `changed` and "Nothing to change." at 0; Undo's changes for the changed tasks only,
// with `shareConfirmed: true`; no Undo when an earlier person is away or an Admin not on the
// project; focus after an action ("Select all shown tasks", on a phone the first changed row's
// box); the row that takes the focus when one leaves; `--toast-offset` set and removed. The hooks
// (useSelection, useBulkActions) run as plain functions (tests/helpers/hookTree.js): what each
// action sends, its toast and Undo, the share confirm handed back to the people window with the
// selected tasks read again, the busy button, and a failure that keeps the selection.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, resetHooks } from '../helpers/hookTree.js';
import { el, installGlobals } from '../helpers/motionFakes.js';

const page = vi.hoisted(() => ({
  get: null,
  post: null,
  toast: null,
  refresh: null,
  actions: null,
  options: [],
}));

vi.mock('react', async (original) =>
  (await import('../helpers/hookTree.js')).reactWithHooks(await original()),
);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: (...args) => page.refresh(...args) }),
}));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => page.toast }));
vi.mock('@/lib/apiClient', () => ({
  api: { get: (...args) => page.get(...args), post: (...args) => page.post(...args) },
}));
vi.mock('@/app/(app)/projects/[id]/_board/TaskActionsProvider.jsx', () => ({
  useTaskActions: () => page.actions,
}));
vi.mock('@/app/(app)/projects/[id]/_board/TaskEditorProvider.jsx', () => ({
  useTaskEditor: () => ({ options: page.options }),
}));

const {
  LIMIT_TEXT,
  MAX_SELECTED,
  NOTHING_TEXT,
  beforeOf,
  bulkBody,
  bulkToast,
  canUndo,
  changesFor,
  headerState,
  nameOf,
  pruneSelection,
  selectAll,
  selectedText,
  toastOffset,
  toggleOne,
  undoBody,
  undoChanges,
} = await import('@/app/(app)/projects/[id]/_board/table/bulkView.js');
const { bulkFocusTarget, keepToastOffset, nextRowId } =
  await import('@/app/(app)/projects/[id]/_board/table/tableDom.js');
const { useSelection } = await import('@/app/(app)/projects/[id]/_board/table/useSelection.js');
const { useBulkActions } = await import('@/app/(app)/projects/[id]/_board/table/useBulkActions.js');

afterEach(() => vi.unstubAllGlobals());

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, at) => from + at);

describe('the selection', () => {
  it('takes up to 100 tasks: a 101st box is refused', () => {
    expect(MAX_SELECTED).toBe(100);
    expect(LIMIT_TEXT).toBe('You can pick up to 100 tasks at a time.');
    const full = range(1, 100);
    expect(toggleOne(full, 101, true)).toEqual({ ids: full, refused: true });
    expect(toggleOne(full, 50, false).ids).toHaveLength(99);
    const some = [3, 5];
    expect(toggleOne(some, 5, true).ids).toBe(some);
    expect(toggleOne(some, 7, true)).toEqual({ ids: [3, 5, 7], refused: false });
  });

  it('"Select all shown tasks" keeps the first 100 shown and says it capped', () => {
    expect(selectAll(range(1, 120))).toEqual({ ids: range(1, 100), capped: true });
    expect(selectAll([4, 2])).toEqual({ ids: [4, 2], capped: false });
  });

  it('lets rows that left go, and keeps the same array when none did', () => {
    const ids = [4, 2, 9];
    expect(pruneSelection(ids, [2, 4, 9, 11])).toBe(ids);
    expect(pruneSelection(ids, [2, 11])).toEqual([2]);
  });

  it('checks the header box when all it can select are selected, mixed when some', () => {
    expect(headerState(0, 5)).toEqual({ checked: false, mixed: false, disabled: false });
    expect(headerState(2, 5)).toEqual({ checked: false, mixed: true, disabled: false });
    expect(headerState(5, 5).checked).toBe(true);
    expect(headerState(100, 140).checked).toBe(true);
    expect(headerState(0, 0).disabled).toBe(true);
  });

  it('says "2 selected"', () => {
    expect(selectedText(2)).toBe('2 selected');
  });
});

describe('what a bulk action sends', () => {
  const tasks = [
    { id: 9, assignee: { id: 6, name: 'Vishal Saini' }, phase: 'development' },
    { id: 41, assignee: null, phase: null },
  ];

  it('gives each selected task one person (null for anyone) or one phase', () => {
    expect(changesFor(tasks, { assigneeId: 3 })).toEqual([
      { id: 9, assigneeId: 3 },
      { id: 41, assigneeId: 3 },
    ]);
    expect(changesFor(tasks, { assigneeId: null })[1]).toEqual({ id: 41, assigneeId: null });
    expect(changesFor(tasks, { phase: 'testing' })).toEqual([
      { id: 9, phase: 'testing' },
      { id: 41, phase: 'testing' },
    ]);
  });

  it('adds shareConfirmed only after the share confirm', () => {
    const changes = [{ id: 9, assigneeId: 5 }];
    expect(bulkBody(changes)).toEqual({ changes });
    expect(bulkBody(changes, true)).toEqual({ changes, shareConfirmed: true });
  });
});

describe('the toast', () => {
  it('counts what changed, for 1 and for n', () => {
    expect(bulkToast({ changed: 2, assigneeId: 3, viewerId: 3 })).toBe('2 tasks are now yours.');
    expect(bulkToast({ changed: 1, assigneeId: 3, viewerId: 3 })).toBe('1 task is now yours.');
    expect(bulkToast({ changed: 2, assigneeId: 8, viewerId: 3, name: 'Sneha Patil' })).toBe(
      '2 tasks are now for Sneha Patil.',
    );
    expect(bulkToast({ changed: 1, assigneeId: 8, viewerId: 3, name: 'Sneha Patil' })).toBe(
      '1 task is now for Sneha Patil.',
    );
    expect(bulkToast({ changed: 2, assigneeId: null, viewerId: 3 })).toBe(
      '2 tasks are now for anyone on the project.',
    );
    expect(bulkToast({ changed: 2, phase: 'testing' })).toBe('Moved 2 tasks to Testing.');
    expect(bulkToast({ changed: 1, phase: 'testing' })).toBe('Moved 1 task to Testing.');
  });

  it('says "Nothing to change." when nothing changed', () => {
    expect(NOTHING_TEXT).toBe('Nothing to change.');
    expect(bulkToast({ changed: 0, assigneeId: 3, viewerId: 3 })).toBe('Nothing to change.');
    expect(bulkToast({ changed: 0, phase: 'testing' })).toBe('Nothing to change.');
  });

  it('names the picked person from the options, else from a task', () => {
    const options = [{ id: 8, name: 'Sneha Patil' }];
    const tasks = [{ id: 1, assignee: { id: 12, name: 'Arvind Menon' } }];
    expect(nameOf(8, options, tasks)).toBe('Sneha Patil');
    expect(nameOf(12, options, tasks)).toBe('Arvind Menon');
    expect(nameOf(null, options, tasks)).toBeNull();
  });
});

describe('Undo', () => {
  const before = beforeOf([
    { id: 9, assignee: { id: 6 }, phase: 'development' },
    { id: 41, assignee: null, phase: null },
    { id: 37, assignee: { id: 3 }, phase: 'testing' },
  ]);

  it('puts back only the tasks the save changed, each as it was', () => {
    const changed = [
      { id: 9, assigneeId: 8, phase: 'development' },
      { id: 41, assigneeId: 8, phase: null },
    ];
    expect(undoChanges('person', before, changed)).toEqual([
      { id: 9, assigneeId: 6 },
      { id: 41, assigneeId: null },
    ]);
    expect(undoChanges('phase', before, changed)).toEqual([
      { id: 9, phase: 'development' },
      { id: 41, phase: null },
    ]);
    expect(undoChanges('person', before, [])).toEqual([]);
  });

  it('always confirms the share (the earlier people could open the files a moment ago)', () => {
    const changes = [{ id: 9, assigneeId: 6 }];
    expect(undoBody(changes)).toEqual({ changes, shareConfirmed: true });
  });

  it('is offered only when every earlier person can be picked now', () => {
    const options = [
      { id: 3, kind: 'me' },
      { id: 6, kind: 'member' },
    ];
    expect(canUndo([{ id: 9, assigneeId: 6 }], options)).toBe(true);
    expect(canUndo([{ id: 41, assigneeId: null }], options)).toBe(true);
    // Away (not on the project, deactivated) or an Admin not on the project: not an option.
    expect(
      canUndo(
        [
          { id: 9, assigneeId: 6 },
          { id: 2, assigneeId: 12 },
        ],
        options,
      ),
    ).toBe(false);
    expect(canUndo([{ id: 9, phase: null }], [])).toBe(true);
  });
});

/** A fake element that is drawn (or not), for the "shown" checks. */
function drawn(node, shown = true) {
  node.getClientRects = () => (shown ? [node.rect] : []);
  return node;
}

function tableAndStack({ phone }) {
  const { html } = installGlobals();
  const box = (id, extra = {}) => {
    const input = drawn(el('input', { attrs: { type: 'checkbox', ...extra } }), true);
    input.disabled = Boolean(extra.disabled);
    return input;
  };
  const header = box('all', { id: 'board-table-select-all' });
  const thead = drawn(
    el('thead', { attrs: { 'data-table-head': '' }, children: [header] }),
    !phone,
  );
  const row = (id, extra) =>
    drawn(el('tr', { attrs: { 'data-flip': `row:${id}` }, children: [box(id, extra)] }), !phone);
  const card = (id, extra) =>
    drawn(el('div', { attrs: { 'data-flip': `row:${id}` }, children: [box(id, extra)] }), phone);
  const table = drawn(el('table', { children: [thead, row(9), row(41)] }), !phone);
  const stack = drawn(
    el('div', { attrs: { 'data-stack': '' }, children: [card(9), card(41)] }),
    phone,
  );
  const root = el('div', { children: [table, stack] });
  html.append(root);
  // a hidden parent hides its children
  for (const node of [...table.querySelectorAll('*'), table]) if (phone) drawn(node, false);
  for (const node of stack.querySelectorAll('*')) if (!phone) drawn(node, false);
  return { root, header, cards: stack.querySelectorAll('input') };
}

describe('focus after a bulk action', () => {
  it('goes to "Select all shown tasks" on a computer', () => {
    const { root, header } = tableAndStack({ phone: false });
    expect(bulkFocusTarget(root, [41])).toBe(header);
  });

  it('goes to the first changed row’s box on a phone, else the first row’s', () => {
    const { root, cards } = tableAndStack({ phone: true });
    expect(bulkFocusTarget(root, [41])).toBe(cards[1]);
    expect(bulkFocusTarget(root, [])).toBe(cards[0]);
  });

  it('hands a leaving row’s focus to the next row, else the previous one', () => {
    expect(nextRowId([1, 2, 3], [1, 3], 2)).toBe(3);
    expect(nextRowId([1, 2, 3], [1, 2], 3)).toBe(2);
    expect(nextRowId([1, 2, 3], [], 2)).toBeNull();
    expect(nextRowId([1, 2, 3], [1, 2, 3], 2)).toBe(2);
  });
});

describe('--toast-offset', () => {
  it('is the bar’s height plus 12 px while it shows, and goes with it', () => {
    expect(toastOffset(56)).toBe('68px');
    const root = { style: new Map() };
    root.style.setProperty = (name, value) => root.style.set(name, value);
    root.style.removeProperty = (name) => root.style.delete(name);
    let resize = null;
    const observed = [];
    class Observer {
      constructor(callback) {
        resize = callback;
      }
      observe(target) {
        observed.push(target);
      }
      disconnect() {
        observed.length = 0;
      }
    }
    const bar = { offsetHeight: 56 };
    const stop = keepToastOffset(bar, { root, Observer });
    expect(root.style.get('--toast-offset')).toBe('68px');
    expect(observed).toEqual([bar]);
    bar.offsetHeight = 110; // a phone wraps its buttons
    resize();
    expect(root.style.get('--toast-offset')).toBe('122px');
    stop();
    expect(root.style.has('--toast-offset')).toBe(false);
    expect(observed).toEqual([]);
  });
});

// ---- the hooks, run as plain functions

const VISHAL = { id: 6, name: 'Vishal Saini' };
const SELECTED = [
  { id: 9, title: 'Payment settings page', assignee: VISHAL, phase: 'development' },
  { id: 41, title: 'Check the order emails', assignee: null, phase: 'testing' },
];
const OPTIONS = [
  { id: 3, name: 'Riya Kapoor', kind: 'me' },
  { id: 6, name: 'Vishal Saini', kind: 'member' },
  { id: 8, name: 'Sneha Patil', kind: 'member' },
];
const answer = (tasks, changed = tasks.length) => ({
  data: { tasks, changed, told: { people: [], members: false } },
});
const shareError = () =>
  Object.assign(new Error('A task you picked has a file only for PM and Admins.'), {
    fields: { shareConfirmed: 'A task you picked has a file only for PM and Admins.' },
  });

let selection;
const run = () =>
  render(() =>
    useBulkActions({
      board: { projectId: 12, viewerId: 3 },
      selection,
      rootRef: { current: null },
    }),
  );

describe('useBulkActions', () => {
  beforeEach(() => {
    resetHooks();
    page.get = vi.fn().mockRejectedValue(new Error("You're offline or Daybook can't be reached."));
    page.post = vi.fn();
    page.toast = vi.fn();
    page.refresh = vi.fn();
    page.actions = { openPeople: vi.fn(), openMove: vi.fn() };
    page.options = OPTIONS;
    selection = { tasks: SELECTED, clear: vi.fn() };
  });

  it('Assign to me sends every selected task to the viewer, then offers Undo', async () => {
    page.post.mockResolvedValue(
      answer([
        { id: 9, assigneeId: 3, phase: 'development' },
        { id: 41, assigneeId: 3, phase: 'testing' },
      ]),
    );
    await run().takeAll();
    expect(page.post).toHaveBeenCalledWith('/api/projects/12/tasks/bulk', {
      changes: [
        { id: 9, assigneeId: 3 },
        { id: 41, assigneeId: 3 },
      ],
    });
    expect(selection.clear).toHaveBeenCalled();
    expect(page.refresh).toHaveBeenCalledTimes(1);
    const after = run();
    expect(after.undo.pending.title).toBe('2 tasks are now yours.');
    expect(page.toast).not.toHaveBeenCalled();

    page.post.mockResolvedValue(answer([]));
    await after.undo.run();
    expect(page.post).toHaveBeenLastCalledWith('/api/projects/12/tasks/bulk', {
      changes: [
        { id: 9, assigneeId: 6 },
        { id: 41, assigneeId: null },
      ],
      shareConfirmed: true,
    });
    expect(run().undo.pending).toBeNull();
  });

  it('puts back only what changed, and says "Nothing to change." without Undo at 0', async () => {
    page.post.mockResolvedValue(answer([{ id: 41, assigneeId: 3, phase: 'testing' }]));
    await run().takeAll();
    const pending = run().undo.pending;
    expect(pending.title).toBe('1 task is now yours.');
    expect(pending.changes).toEqual([{ id: 41, assigneeId: null }]);

    resetHooks();
    page.post.mockResolvedValue(answer([], 0));
    await run().takeAll();
    expect(page.toast).toHaveBeenCalledWith({ title: 'Nothing to change.' });
    expect(run().undo.pending).toBeNull();
  });

  it('has no Undo when an earlier person can’t be picked now (away, or an Admin not on it)', async () => {
    page.options = [{ id: 3, name: 'Riya Kapoor', kind: 'me' }];
    page.post.mockResolvedValue(answer([{ id: 9, assigneeId: 3, phase: 'development' }]));
    await run().takeAll();
    expect(page.toast).toHaveBeenCalledWith({ title: '1 task is now yours.' });
    expect(run().undo.pending).toBeNull();
  });

  it('keeps the selection when the save fails, with the API’s message', async () => {
    const message = 'Something else changed at the same moment. Try again.';
    page.post.mockRejectedValue(new Error(message));
    await run().takeAll();
    expect(selection.clear).not.toHaveBeenCalled();
    expect(page.toast).toHaveBeenCalledWith({
      title: "Couldn't change the tasks",
      body: message,
      tone: 'error',
    });
  });

  it('turns the pressed button busy and takes no second press meanwhile', async () => {
    let finish;
    page.post.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const first = run().takeAll();
    expect(run().busy).toBe('take');
    await run().takeAll();
    expect(page.post).toHaveBeenCalledTimes(1);
    finish(answer([], 0));
    await first;
    expect(run().busy).toBeNull();
  });

  it('Give to… opens the people window and hands a share confirm back to it', async () => {
    run().giveAll();
    const [{ tasks, onPick }] = page.actions.openPeople.mock.calls[0];
    expect(tasks).toBe(SELECTED);
    page.post.mockRejectedValueOnce(shareError());
    await expect(onPick(8, { shareConfirmed: false })).rejects.toThrow(/only for PM and Admins/);
    expect(page.toast).not.toHaveBeenCalled();
    page.post.mockResolvedValueOnce(
      answer([
        { id: 9, assigneeId: 8, phase: 'development' },
        { id: 41, assigneeId: 8, phase: 'testing' },
      ]),
    );
    await onPick(8, { shareConfirmed: true });
    expect(page.post).toHaveBeenLastCalledWith('/api/projects/12/tasks/bulk', {
      changes: [
        { id: 9, assigneeId: 8 },
        { id: 41, assigneeId: 8 },
      ],
      shareConfirmed: true,
    });
    expect(run().undo.pending.title).toBe('2 tasks are now for Sneha Patil.');
  });

  it('reads the selected tasks again when the server asks for the share confirm', async () => {
    const simran = { id: 5, name: 'Simran Kaur', role: 'employee', status: 'active' };
    page.options = [...OPTIONS, { id: 5, name: 'Simran Kaur', kind: 'member' }];
    page.get.mockImplementation(async (path) =>
      path === '/api/project-tasks/9'
        ? { data: { id: 9, privateLinkCount: 1, assignee: simran } }
        : { data: { id: 41, privateLinkCount: 0, assignee: null } },
    );
    run().giveAll();
    const [{ onPick }] = page.actions.openPeople.mock.calls[0];
    page.post.mockRejectedValueOnce(shareError());
    const asked = await onPick(8, { shareConfirmed: false }).catch((error) => error);
    expect(page.get.mock.calls.map(([path]) => path)).toEqual([
      '/api/project-tasks/9',
      '/api/project-tasks/41',
    ]);
    expect(asked.fields.shareConfirmed).toMatch(/^A task you picked/);
    expect(asked.tasks).toEqual([
      { ...SELECTED[0], privateLinkCount: 1, assignee: simran },
      { ...SELECTED[1], privateLinkCount: 0 },
    ]);
    expect(run().busy).toBeNull();

    // "Give and share" saves the tasks as the window has them now: Undo goes back to Simran.
    page.post.mockResolvedValueOnce(answer([{ id: 9, assigneeId: 8, phase: 'development' }]));
    await onPick(8, { shareConfirmed: true, tasks: asked.tasks });
    expect(run().undo.pending.changes).toEqual([{ id: 9, assigneeId: 5 }]);
  });

  it('keeps a task it can’t read again as it was, and reads a few at a time, in order', async () => {
    const many = range(1, 14).map((id) => ({ id, assignee: null, phase: null }));
    selection = { tasks: many, clear: vi.fn() };
    let running = 0;
    let most = 0;
    page.get.mockImplementation(async (path) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((done) => setTimeout(done, 0));
      running -= 1;
      const id = Number(path.split('/').at(-1));
      if (id === 7) throw new Error('This task is gone.');
      return { data: { id, privateLinkCount: 1, assignee: null } };
    });
    run().giveAll();
    page.post.mockRejectedValueOnce(shareError());
    const [{ onPick }] = page.actions.openPeople.mock.calls[0];
    const { tasks } = await onPick(8, { shareConfirmed: false }).catch((error) => error);
    expect(tasks.map((task) => task.id)).toEqual(range(1, 14));
    expect(tasks[6]).toBe(many[6]);
    expect(tasks.filter((task) => task.privateLinkCount === 1)).toHaveLength(13);
    expect(most).toBeLessThanOrEqual(6);
  });

  it('reads nothing again when another action fails', async () => {
    page.post.mockRejectedValue(shareError());
    await run().takeAll();
    expect(page.get).not.toHaveBeenCalled();
    expect(page.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't change the tasks" }),
    );
  });

  it('Move to phase… moves the selection through the bulk route', async () => {
    const origin = { id: 'move' };
    run().moveAll(origin);
    const [{ tasks, onMove, origin: from }] = page.actions.openMove.mock.calls[0];
    expect(tasks).toBe(SELECTED);
    expect(from).toBe(origin);
    page.post.mockResolvedValue(answer([{ id: 9, assigneeId: 6, phase: 'testing' }]));
    await onMove('testing');
    expect(page.post).toHaveBeenCalledWith('/api/projects/12/tasks/bulk', {
      changes: [
        { id: 9, phase: 'testing' },
        { id: 41, phase: 'testing' },
      ],
    });
    const pending = run().undo.pending;
    expect(pending.title).toBe('Moved 1 task to Testing.');
    expect(pending.changes).toEqual([{ id: 9, phase: 'development' }]);
  });

  it('says "Couldn’t undo" with the API’s message when the Undo fails', async () => {
    const message = 'Pick someone who is on this project, or anyone on the project.';
    page.post.mockResolvedValue(answer([{ id: 9, assigneeId: 3, phase: 'development' }]));
    await run().takeAll();
    page.post.mockRejectedValue(new Error(message));
    await run().undo.run();
    expect(page.toast).toHaveBeenCalledWith({
      title: "Couldn't undo",
      body: message,
      tone: 'error',
    });
  });

  it('Clear empties the selection', () => {
    run().clear();
    expect(selection.clear).toHaveBeenCalled();
  });
});

describe('useSelection', () => {
  beforeEach(() => {
    resetHooks();
    page.toast = vi.fn();
  });
  const rows = (count) => range(1, count).map((id) => ({ id }));

  it('ticks and clears rows, and refuses a 101st with the error toast', () => {
    const shown = rows(101);
    render(() => useSelection(shown)).toggleAll(true);
    const all = render(() => useSelection(shown));
    expect(all.count).toBe(100);
    expect(page.toast).toHaveBeenCalledWith({ title: LIMIT_TEXT, tone: 'error' });
    all.toggle(101, true);
    expect(page.toast).toHaveBeenCalledTimes(2);
    expect(render(() => useSelection(shown)).has(101)).toBe(false);
    render(() => useSelection(shown)).toggleAll(false);
    expect(render(() => useSelection(shown)).count).toBe(0);
  });

  it('lets a row that leaves go, and keeps the order rows are drawn in', () => {
    const shown = rows(3);
    render(() => useSelection(shown)).toggle(3, true);
    render(() => useSelection(shown)).toggle(1, true);
    expect(render(() => useSelection(shown)).tasks.map((task) => task.id)).toEqual([1, 3]);
    const fewer = render(() => useSelection(rows(2)));
    expect(fewer.ids).toEqual([1]);
    expect(render(() => useSelection(shown)).has(3)).toBe(false);
  });
});
