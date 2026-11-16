// "Still open from past reports" in use (CONTRACT 24). CarrySuggestions and StillOpenDialog really
// run: the test keeps their React state itself (the hooks below), so a click is a call to the
// element's handler and a new render, without a browser. Add to today and Add all only call the
// parent; Done already and Not needed call the close route, tell the parent and show "Marked
// done." / "Marked not needed." with Undo, which calls the route with undo and puts the row back;
// a refused close toasts the API's message and keeps the row. The dialog adds by group.
import { Fragment, isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ current: null }));
const apiPost = vi.hoisted(() => vi.fn());
const toasts = vi.hoisted(() => []);

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal();
  /** The rendering component's next hook, made on its first render. */
  const slot = (make) => {
    const instance = hooks.current;
    const index = instance.index++;
    if (!(index in instance.slots)) instance.slots[index] = make(index);
    return instance.slots[index];
  };
  return {
    ...actual,
    useState: (initial) => {
      const cell = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      const set = (next) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
      };
      return [cell.value, set];
    },
    useRef: (initial) => slot(() => ({ current: initial })),
    useId: () => slot((index) => `id-${index}`),
    useCallback: (fn) => fn,
    useMemo: (make) => make(),
    useEffect: (effect) => {
      hooks.current.effects.push(effect);
    },
  };
});
vi.mock('@/lib/apiClient', () => ({ api: { post: apiPost } }));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => (toast) => toasts.push(toast),
  useToastSlot: () => null,
}));
// The Undo toast as a plain element the test can find and press.
vi.mock('@/app/(app)/projects/[id]/UndoToast', () => ({
  default: ({ pending, onUndo, onEnd }) =>
    pending ? { type: 'undo-toast', props: { pending, onUndo, onEnd }, $$typeof: null } : null,
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ open, title, children, footer }) => (open ? [title, children, footer] : null),
}));

const { default: CarrySuggestions } = await import('@/app/(app)/report/CarrySuggestions.jsx');
const { default: StillOpenDialog } = await import('@/app/(app)/report/StillOpenDialog.jsx');

/** A component's output down to host elements, rendering every component with the test's hooks. */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (node?.type === 'undo-toast') return node;
  if (!isValidElement(node)) return node;
  if (typeof node.type === 'function') return expand(node.type(node.props));
  if (node.type === Fragment) return expand(node.props.children);
  return { type: node.type, props: { ...node.props, children: expand(node.props.children) } };
}

/** Renders a component with the test's hooks; `render(changes)` renders it again. */
function mount(Component, props) {
  const instance = { slots: [], cleanups: [], props };
  instance.render = (changes = {}) => {
    Object.assign(instance.props, changes);
    Object.assign(instance, { index: 0, effects: [] });
    hooks.current = instance;
    try {
      instance.tree = expand(Component(instance.props));
    } finally {
      hooks.current = null;
    }
    instance.cleanups.forEach((cleanup) => cleanup?.());
    instance.cleanups = instance.effects.map((effect) => effect());
    return instance;
  };
  return instance.render();
}

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  if (!node || typeof node !== 'object' || !node.props) return undefined;
  visit(node);
  return walk(node.props.children, visit);
}
const find = (view, predicate) => {
  const found = [];
  walk(view.tree, (element) => predicate(element) && found.push(element));
  return found;
};
const named = (view, label) => find(view, (element) => element.props['aria-label'] === label)[0];
const byText = (view, words) =>
  find(view, (element) => element.type === 'button' && flat(element).includes(words))[0];
const undoToast = (view) => find(view, (element) => element.type === 'undo-toast')[0];
/** The text inside an element. */
function flat(node) {
  if (Array.isArray(node)) return node.map(flat).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object' || !node.props) return '';
  return flat(node.props.children);
}

async function press(view, element, event = { detail: 1 }) {
  await element.props.onClick(event);
  return view.render();
}

const item = (taskId, title, status = 'in_progress') => ({
  taskId,
  title,
  status,
  workDate: '2026-11-11',
  dayLabel: 'From Wednesday',
});
const META = item(31, 'Meta descriptions');
const LINKS = item(32, 'Fix the broken links', 'blocked');

/** The box as a parent keeps it: onClosed drops the row, onRestored puts it back. */
function box(items = [META, LINKS]) {
  const parent = { items: [...items], added: [], addedAll: [], closed: [], restored: [] };
  const view = mount(CarrySuggestions, {
    items: parent.items,
    onAdd: (one) => parent.added.push(one),
    onAddAll: (list) => parent.addedAll.push(list),
    onClosed: (taskId) => {
      parent.closed.push(taskId);
      view.props.items = view.props.items.filter((one) => one.taskId !== taskId);
    },
    onRestored: (one) => {
      parent.restored.push(one);
      view.props.items = [...view.props.items, one];
    },
  });
  return { view, parent };
}

afterEach(() => {
  apiPost.mockReset();
  toasts.length = 0;
});

describe('CarrySuggestions', () => {
  it('Add to today and Add all to today only call the parent', async () => {
    const { view, parent } = box();
    await press(view, named(view, 'Add to today: Fix the broken links'));
    await press(view, byText(view, 'Add all to today'));
    expect(parent.added).toEqual([LINKS]);
    expect(parent.addedAll).toEqual([[META, LINKS]]);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('Done already closes the line, tells the parent and offers Undo', async () => {
    apiPost.mockResolvedValue({ data: { taskId: 31, closed: true, reason: 'done' } });
    const { view, parent } = box();
    await press(view, named(view, 'Done already: Meta descriptions'));
    expect(apiPost).toHaveBeenCalledWith('/api/me/carry-suggestions/31/close', { reason: 'done' });
    expect(parent.closed).toEqual([31]);
    expect(named(view, 'Done already: Meta descriptions')).toBeUndefined();
    expect(undoToast(view).props.pending).toMatchObject({ title: 'Marked done.', keyboard: false });

    apiPost.mockResolvedValue({ data: { taskId: 31, closed: false, reason: null } });
    await undoToast(view).props.onUndo();
    view.render();
    expect(apiPost).toHaveBeenLastCalledWith('/api/me/carry-suggestions/31/close', {
      reason: 'done',
      undo: true,
    });
    expect(parent.restored).toEqual([META]);
    expect(undoToast(view)).toBeUndefined();
    expect(named(view, 'Done already: Meta descriptions')).toBeDefined();
  });

  it('Not needed says "Marked not needed." and keeps the toast after the last row goes', async () => {
    apiPost.mockResolvedValue({ data: { taskId: 32, closed: true, reason: 'dropped' } });
    const { view, parent } = box([LINKS]);
    // From the keyboard (detail 0) focus moves to Undo.
    await press(view, named(view, 'Not needed: Fix the broken links'), { detail: 0 });
    expect(apiPost).toHaveBeenCalledWith('/api/me/carry-suggestions/32/close', {
      reason: 'dropped',
    });
    expect(parent.closed).toEqual([32]);
    expect(find(view, (element) => element.props.role === 'region')).toHaveLength(0);
    expect(undoToast(view).props.pending).toMatchObject({
      title: 'Marked not needed.',
      keyboard: true,
    });
    undoToast(view).props.onEnd();
    view.render();
    expect(undoToast(view)).toBeUndefined();
  });

  it('a refused close toasts the API’s message and keeps the row', async () => {
    apiPost.mockRejectedValue(
      Object.assign(new Error("We couldn't find that open task."), { code: 'NOT_FOUND' }),
    );
    const { view, parent } = box();
    await press(view, named(view, 'Done already: Meta descriptions'));
    expect(parent.closed).toEqual([]);
    expect(toasts).toEqual([
      { title: "Couldn't mark the task", body: "We couldn't find that open task.", tone: 'error' },
    ]);
    expect(named(view, 'Done already: Meta descriptions')).toBeDefined();
    expect(undoToast(view)).toBeUndefined();
  });

  it('sends one close at a time for a row', async () => {
    let finish;
    apiPost.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { view } = box();
    const first = named(view, 'Done already: Meta descriptions').props.onClick({ detail: 1 });
    view.render();
    expect(named(view, 'Done already: Meta descriptions').props['aria-busy']).toBe(true);
    await named(view, 'Not needed: Meta descriptions').props.onClick({ detail: 1 });
    expect(apiPost).toHaveBeenCalledTimes(1);
    finish({ data: {} });
    await first;
  });
});

describe('StillOpenDialog', () => {
  const groups = [
    { key: 'p3', project: { id: 3, name: 'Acme booking app', color: 'orange' }, items: [META] },
    { key: 'r4', request: { id: 4, name: 'Riverkraft website' }, items: [LINKS] },
  ];

  it('adds by group and closes without adding a project; Undo says which group', async () => {
    const calls = { added: [], closed: [], restored: [] };
    const view = mount(StillOpenDialog, {
      open: true,
      onClose: () => {},
      groups,
      onAdd: (key, one) => calls.added.push([key, one]),
      onClosed: (taskId) => calls.closed.push(taskId),
      onRestored: (one, key) => calls.restored.push([key, one]),
    });
    await press(view, named(view, 'Add to today: Fix the broken links'));
    expect(calls.added).toEqual([['r4', LINKS]]);

    apiPost.mockResolvedValue({ data: {} });
    await press(view, named(view, 'Done already: Meta descriptions'));
    expect(calls.closed).toEqual([31]);
    expect(calls.added).toHaveLength(1);
    await undoToast(view).props.onUndo();
    expect(calls.restored).toEqual([['p3', META]]);
    expect(byText(view, 'Close')).toBeDefined();
  });
});
