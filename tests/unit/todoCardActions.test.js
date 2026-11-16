// Today's to-do in use (CONTRACT 24). TodoProvider, TodoCard and the timer form really run: the test
// keeps their React state itself (a small stand-in for React's hooks below, keyed by where each
// component sits, so lines can come and go), so a click is a call to the element's handler and a
// new render, without a browser. Covered: tick and untick, an API error putting the line back,
// inline edit (Enter saves, Escape cancels), "Add a task" (Enter adds and keeps focus, Escape
// clears, duplicates and short titles), removing a line or a project with Undo and the refusal,
// Play, the Slack button and its poll, pasting several lines into "Add a task" (lines without a
// heading go to that project), and the timer form offering the picked project's to-do lines. Also
// an add meeting a row still waiting behind Undo (its DELETE goes first), quick ticks whose
// answers or a refresh come back late (no box unticks itself), and where focus goes when Play or
// the last suggestion's button goes away.
import { Fragment, createElement, isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const R = vi.hoisted(() => ({ inst: null, path: '', index: 0, ids: 0, contexts: new Map() }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const toasts = vi.hoisted(() => []);
const toast = vi.hoisted(() => (item) => toasts.push(item));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal();
  const same = (a, b) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
  /** The hook cell at this place of the component being rendered, made on its first render. */
  const slot = (make) => {
    const key = `${R.path}#${R.index++}`;
    R.inst.seen.add(key);
    if (!R.inst.slots.has(key)) R.inst.slots.set(key, make());
    return R.inst.slots.get(key);
  };
  const memo = (make, deps) => {
    const cell = slot(() => ({ init: false }));
    if (!cell.init || !same(cell.deps, deps))
      Object.assign(cell, { init: true, deps, value: make() });
    return cell.value;
  };
  const effect = (run, deps) => {
    const cell = slot(() => ({ init: false }));
    if (cell.init && deps && same(cell.deps, deps)) return;
    Object.assign(cell, { init: true, deps });
    R.inst.effects.push(() => {
      cell.cleanup?.();
      cell.cleanup = run() ?? null;
    });
  };
  return {
    ...actual,
    useState: (initial) => {
      const inst = R.inst;
      const cell = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      cell.set ??= (next) => {
        const value = typeof next === 'function' ? next(cell.value) : next;
        if (Object.is(value, cell.value)) return;
        cell.value = value;
        inst.dirty = true;
      };
      return [cell.value, cell.set];
    },
    useRef: (initial) => slot(() => ({ current: initial })),
    useId: () => slot(() => `id-${++R.ids}`),
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: effect,
    useLayoutEffect: effect,
    useContext: (context) =>
      R.contexts.has(context) ? R.contexts.get(context) : context._currentValue,
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/apiClient', () => ({ api }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast, useToastSlot: () => null }));
vi.mock('@/app/(app)/projects/[id]/UndoToast', async () => {
  const { createElement: make } = await vi.importActual('react');
  return {
    default: ({ pending, onUndo, onEnd }) =>
      pending ? make('undo-toast', { pending, onUndo, onEnd }) : null,
  };
});
vi.mock('@/components/Dialog', async () => {
  const { createElement: make } = await vi.importActual('react');
  return {
    default: ({ open, title, children, footer }) =>
      open ? make('dialog-mock', { title }, children, footer) : null,
  };
});
vi.mock('@/app/(app)/report/ProjectPicker', async () => {
  const { createElement: make } = await vi.importActual('react');
  return { default: (props) => make('project-picker', { onPick: props.onPick }) };
});

const { default: TodoProvider } = await import('@/app/(app)/today/TodoProvider.jsx');
const { default: TodoCard } = await import('@/app/(app)/today/TodoCard.jsx');
const { default: TimerStartForm } = await import('@/app/(app)/today/TimerStartForm.jsx');
const { default: PriorityCard } = await import('@/app/(app)/today/PriorityCard.jsx');
const { HOURS_REFUSAL, POLL_TIMES } = await import('@/app/(app)/today/useTodoState.js');

const CONTEXT = Symbol.for('react.context');
let focused = null;

/** The tree down to host elements, every component run with the test's hooks at its place. */
function expand(node, path) {
  if (Array.isArray(node)) {
    return node.map((child, index) =>
      expand(child, `${path}[${isValidElement(child) && child.key !== null ? child.key : index}]`),
    );
  }
  if (!isValidElement(node)) return node;
  const { type, props } = node;
  if (typeof type === 'function') {
    const own = `${path}<${type.name || 'C'}>`;
    const saved = [R.path, R.index];
    [R.path, R.index] = [own, 0];
    let out;
    try {
      out = type(props);
    } finally {
      [R.path, R.index] = saved;
    }
    return expand(out, own);
  }
  if (type === Fragment) return expand(props.children, path);
  if (type?.$$typeof === CONTEXT) {
    R.contexts.set(type, props.value);
    return expand(props.children, path);
  }
  // lucide icons and other wrapped components draw nothing the tests look at.
  if (typeof type !== 'string') return null;
  return { type, props: { ...props, children: expand(props.children, `${path}/${type}`) } };
}

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((child) => walk(child, visit));
  if (!node || typeof node !== 'object' || !node.props) return undefined;
  visit(node);
  return walk(node.props.children, visit);
}

/** What React does after a render: refs point at the nodes on the page. */
function attachRefs(inst) {
  const live = new Map();
  walk(inst.tree, (element) => {
    const { ref } = element.props;
    if (!ref) return;
    const node = inst.nodes.get(ref) ?? {
      label: element.props['aria-label'],
      focus() {
        focused = this;
      },
    };
    live.set(ref, node);
    if (typeof ref === 'function') ref(node);
    else ref.current = node;
  });
  for (const ref of inst.nodes.keys())
    if (!live.has(ref) && typeof ref === 'object') ref.current = null;
  inst.nodes = live;
}

const mounted = [];

function mount(Component, props) {
  const inst = { slots: new Map(), nodes: new Map(), props, dirty: false };
  const once = () => {
    Object.assign(inst, { seen: new Set(), effects: [] });
    R.contexts = new Map();
    R.inst = inst;
    try {
      inst.tree = expand(createElement(Component, inst.props), 'root');
    } finally {
      R.inst = null;
    }
    attachRefs(inst);
    for (const [key, cell] of inst.slots) {
      if (inst.seen.has(key)) continue;
      cell.cleanup?.();
      inst.slots.delete(key);
    }
    inst.effects.forEach((run) => run());
  };
  inst.render = (changes = {}) => {
    Object.assign(inst.props, changes);
    let rounds = 0;
    do {
      inst.dirty = false;
      once();
    } while (inst.dirty && ++rounds < 25);
    return inst;
  };
  inst.unmount = () => inst.slots.forEach((cell) => cell.cleanup?.());
  mounted.push(inst);
  return inst.render();
}

async function flush() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

/** Runs a handler, lets its promises settle, renders again. */
async function act(view, run) {
  await run?.();
  await flush();
  return view.render();
}

const find = (view, predicate) => {
  const found = [];
  walk(view.tree, (element) => predicate(element) && found.push(element));
  return found;
};
const named = (view, label) => find(view, (element) => element.props['aria-label'] === label)[0];
/** The text inside an element. */
function flat(node) {
  if (Array.isArray(node)) return node.map(flat).join(' ');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object' || !node.props) return '';
  return flat(node.props.children);
}
const textOf = (view) => flat(view.tree).replace(/\s+/g, ' ');
const button = (view, words) =>
  find(view, (element) => element.type === 'button' && flat(element).trim() === words)[0];
const undoToast = (view) => find(view, (element) => element.type === 'undo-toast')[0];
const key = (name) => ({ key: name, preventDefault: vi.fn(), nativeEvent: { isComposing: false } });
const click = { detail: 1, preventDefault: () => {} };

const TZ = 'Asia/Kolkata';
const AT = '2026-11-13T04:11:00.000Z';
const PTL = { id: 3, name: 'Pine Tree Lane', color: 'green' };
const SU = { id: 5, name: 'Studio Ubique', color: 'violet' };
const DOT = { id: 8, name: 'Dotado', color: 'orange' };
const PICKER = { urgent: [], mine: [PTL, SU, DOT], others: [], requests: [] };

const line = (id, title, extra = {}) => ({
  id,
  title,
  status: 'in_progress',
  done: false,
  projectTaskId: null,
  now: false,
  carriedFrom: null,
  canStart: true,
  ...extra,
});

function groups() {
  return [
    {
      entryId: 1,
      project: PTL,
      minutes: 0,
      lines: [line(11, 'Monitoring google ads', { status: 'done', done: true, canStart: false })],
    },
    {
      entryId: 2,
      project: SU,
      minutes: 0,
      lines: [
        line(21, '1 web blog publish'),
        line(22, 'Analysing the gsc stats'),
        line(23, '1 listicle content post', { now: true, canStart: false }),
        line(24, 'Waiting on the client', { status: 'blocked' }),
      ],
    },
  ];
}

function todo(extra = {}) {
  const list = extra.groups ?? groups();
  const lines = list.flatMap((group) => group.lines);
  return {
    workDate: '2026-11-13',
    reportId: 9,
    editable: true,
    submitted: false,
    done: lines.filter((item) => item.done).length,
    total: lines.length,
    post: { state: 'none', at: null, changed: false, postedAt: null },
    slack: { canPost: true },
    timer: { canStart: true },
    groups: list,
    suggestions: {},
    ...extra,
  };
}

/** The page: the provider and the card. */
function Page({ initialTodo }) {
  return createElement(
    TodoProvider,
    { initialTodo },
    createElement(TodoCard, { picker: PICKER, priority: {}, tz: TZ }),
  );
}

const card = (state = todo()) => mount(Page, { initialTodo: state });
const lineOf = (view, id) => find(view, (element) => element.props['data-todo-line'] === id)[0];

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('requestAnimationFrame', (run) => run());
  focused = null;
});

afterEach(() => {
  mounted.splice(0).forEach((view) => view.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.values(api).forEach((fn) => fn.mockReset());
  router.refresh.mockReset();
  toasts.length = 0;
});

describe('ticking a line', () => {
  it('marks it Done at once, sends it, and takes the answer', async () => {
    const view = card();
    let answer;
    api.patch.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    named(view, 'Done: Analysing the gsc stats').props.onChange({ target: { checked: true } });
    view.render();
    expect(api.patch).toHaveBeenCalledWith('/api/me/todo/lines/22', { done: true });
    expect(textOf(view)).toContain('2 of 5 done');
    expect(named(view, 'Done: Analysing the gsc stats').props.checked).toBe(true);
    // The answer replaces the state (here the server also says 22 is Done).
    const saved = todo();
    saved.groups[1].lines[1] = { ...saved.groups[1].lines[1], done: true, status: 'done' };
    await act(view, () => answer({ data: todo({ groups: saved.groups }) }));
    expect(textOf(view)).toContain('2 of 5 done');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('unticks a Done line back to In progress', async () => {
    const view = card();
    api.patch.mockResolvedValueOnce({ data: todo() });
    named(view, 'Done: Monitoring google ads').props.onChange({ target: { checked: false } });
    view.render();
    expect(api.patch).toHaveBeenCalledWith('/api/me/todo/lines/11', { done: false });
    expect(textOf(view)).toContain('0 of 5 done');
  });

  it('puts the line back and toasts the API message when it fails', async () => {
    const view = card();
    api.patch.mockRejectedValueOnce(
      Object.assign(new Error('Your report is in. Change tasks in the report.'), {
        code: 'REPORT_LOCKED',
      }),
    );
    await act(view, () =>
      named(view, 'Done: Analysing the gsc stats').props.onChange({ target: { checked: true } }),
    );
    expect(named(view, 'Done: Analysing the gsc stats').props.checked).toBe(false);
    expect(textOf(view)).toContain('1 of 5 done');
    expect(toasts.at(-1)).toEqual({
      title: "Couldn't change the task",
      body: 'Your report is in. Change tasks in the report.',
      tone: 'error',
    });
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe('editing a title in place', () => {
  it('saves with Enter and cancels with Escape', async () => {
    const view = card();
    named(view, 'Edit task: 1 web blog publish').props.onClick(click);
    view.render();
    const field = () =>
      find(
        view,
        (element) =>
          element.type === 'input' &&
          element.props.value !== undefined &&
          element.props['aria-label'] === 'Edit task: 1 web blog publish',
      )[0];
    expect(field().props.value).toBe('1 web blog publish');
    field().props.onChange({ target: { value: '2 web blog posts' } });
    view.render();
    api.patch.mockResolvedValueOnce({ data: todo() });
    field().props.onKeyDown(key('Enter'));
    view.render();
    expect(api.patch).toHaveBeenCalledWith('/api/me/todo/lines/21', { title: '2 web blog posts' });
    expect(named(view, 'Edit task: 2 web blog posts').type).toBe('button');
    await act(view);

    named(view, 'Edit task: Waiting on the client').props.onClick(click);
    view.render();
    const other = find(
      view,
      (element) =>
        element.type === 'input' &&
        element.props['aria-label'] === 'Edit task: Waiting on the client',
    )[0];
    other.props.onChange({ target: { value: 'Something else' } });
    view.render();
    find(
      view,
      (element) =>
        element.type === 'input' &&
        element.props['aria-label'] === 'Edit task: Waiting on the client',
    )[0].props.onKeyDown(key('Escape'));
    view.render();
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(named(view, 'Edit task: Waiting on the client').type).toBe('button');
  });

  it('refuses a title under 2 characters', () => {
    const view = card();
    named(view, 'Edit task: 1 web blog publish').props.onClick(click);
    view.render();
    const input = () =>
      find(
        view,
        (element) =>
          element.type === 'input' &&
          element.props['aria-label'] === 'Edit task: 1 web blog publish',
      )[0];
    input().props.onChange({ target: { value: 'x' } });
    view.render();
    input().props.onKeyDown(key('Enter'));
    view.render();
    expect(api.patch).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toEqual({ title: 'Write at least 2 characters.', tone: 'error' });
    expect(input().props.value).toBe('x');
  });
});

describe('Add a task', () => {
  const addInput = (view, name = 'Studio Ubique') => named(view, `Add a task to ${name}`);
  const type = (view, value) => {
    addInput(view).props.onChange({ target: { value } });
    view.render();
  };

  it('adds with Enter, keeps focus, and clears with Escape', async () => {
    const view = card();
    addInput(view).props.ref.current.focus();
    const node = focused;
    type(view, 'Shortlist 5 topics');
    const saved = todo();
    saved.groups[1].lines.push(line(25, 'Shortlist 5 topics'));
    api.post.mockResolvedValueOnce({
      data: { ...todo({ groups: saved.groups }), added: true, lineId: 25 },
    });
    addInput(view).props.onKeyDown(key('Enter'));
    view.render();
    expect(api.post).toHaveBeenCalledWith('/api/me/todo/lines', {
      projectId: 5,
      title: 'Shortlist 5 topics',
    });
    // Shown at once, the field empty and still focused for the next one.
    expect(textOf(view)).toContain('Shortlist 5 topics');
    expect(textOf(view)).toContain('1 of 6 done');
    expect(addInput(view).props.value).toBe('');
    await act(view);
    expect(lineOf(view, 25)).toBeTruthy();
    expect(focused).toBe(node);
    expect(addInput(view).props.ref.current).toBe(node);

    type(view, 'Never mind');
    addInput(view).props.onKeyDown(key('Escape'));
    view.render();
    expect(addInput(view).props.value).toBe('');
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('skips a title the project already has and keeps a short one', () => {
    const view = card();
    type(view, '1 WEB  blog publish');
    addInput(view).props.onKeyDown(key('Enter'));
    view.render();
    expect(api.post).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toEqual({ title: 'Already in your to-do.' });
    expect(addInput(view).props.value).toBe('');

    type(view, 'x');
    addInput(view).props.onKeyDown(key('Enter'));
    view.render();
    expect(toasts.at(-1)).toEqual({ title: 'Write at least 2 characters.', tone: 'error' });
    expect(addInput(view).props.value).toBe('x');
  });

  it('takes the line back and puts the text back when the add fails', async () => {
    const view = card();
    type(view, 'Shortlist 5 topics');
    api.post.mockRejectedValueOnce(
      Object.assign(new Error('A project can have up to 50 tasks.'), { code: 'VALIDATION_FAILED' }),
    );
    await act(view, () => addInput(view).props.onKeyDown(key('Enter')));
    expect(textOf(view)).not.toContain('Shortlist 5 topics');
    expect(addInput(view).props.value).toBe('Shortlist 5 topics');
    expect(toasts.at(-1)).toMatchObject({
      title: "Couldn't add the task",
      body: 'A project can have up to 50 tasks.',
    });
  });

  it('opens the paste dialog with text of several lines, and adds them', async () => {
    const view = card();
    const event = {
      clipboardData: { getData: () => 'Project: Dotado\n* One topic\n* Two topics' },
      preventDefault: vi.fn(),
    };
    addInput(view).props.onPaste(event);
    view.render();
    expect(event.preventDefault).toHaveBeenCalled();
    const dialog = find(view, (element) => element.type === 'dialog-mock')[0];
    expect(dialog.props.title).toBe('Paste your to-do');
    expect(find(view, (element) => element.type === 'textarea')[0].props.value).toBe(
      'Project: Dotado\n* One topic\n* Two topics',
    );
    api.post.mockResolvedValueOnce({ data: { added: 2, skipped: 0, todo: todo() } });
    await act(view, () => button(view, 'Add 2 tasks').props.onClick(click));
    expect(api.post).toHaveBeenCalledWith('/api/me/todo/lines/bulk', {
      groups: [
        {
          projectId: 8,
          lines: [
            { title: 'One topic', status: 'in_progress' },
            { title: 'Two topics', status: 'in_progress' },
          ],
        },
      ],
    });
    expect(toasts.at(-1)).toEqual({ title: 'Added 2 tasks.' });
    expect(find(view, (element) => element.type === 'dialog-mock')).toHaveLength(0);
  });

  it('leaves one line pasted to the field', () => {
    const view = card();
    const event = { clipboardData: { getData: () => 'Just one line\n' }, preventDefault: vi.fn() };
    addInput(view).props.onPaste(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('removing with Undo', () => {
  it('hides a line behind "Task removed." and Undo brings it back', async () => {
    const view = card();
    named(view, 'Remove 1 listicle content post').props.onClick(click);
    view.render();
    expect(lineOf(view, 23)).toBeUndefined();
    expect(textOf(view)).toContain('1 of 4 done');
    expect(undoToast(view).props.pending.title).toBe('Task removed.');
    undoToast(view).props.onUndo();
    view.render();
    expect(lineOf(view, 23)).toBeTruthy();
    expect(api.delete).not.toHaveBeenCalled();

    api.delete.mockResolvedValueOnce({ data: todo() });
    named(view, 'Remove 1 listicle content post').props.onClick(click);
    view.render();
    await act(view, () => undoToast(view).props.onEnd());
    expect(api.delete).toHaveBeenCalledWith('/api/me/todo/lines/23');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('hides a project behind "Project removed." and deletes it when the toast ends', async () => {
    const view = card();
    named(view, 'Remove Pine Tree Lane').props.onClick(click);
    view.render();
    expect(textOf(view)).not.toContain('Pine Tree Lane');
    expect(undoToast(view).props.pending.title).toBe('Project removed.');
    api.delete.mockResolvedValueOnce({ data: todo() });
    await act(view, () => undoToast(view).props.onEnd());
    expect(api.delete).toHaveBeenCalledWith('/api/me/todo/projects/1');
  });

  it('refuses a project with hours in the report', () => {
    const list = groups();
    list[1].minutes = 90;
    const view = card(todo({ groups: list }));
    named(view, 'Remove Studio Ubique').props.onClick(click);
    view.render();
    expect(textOf(view)).toContain('Studio Ubique');
    expect(undoToast(view)).toBeUndefined();
    expect(toasts.at(-1)).toEqual({
      title: "Couldn't remove the project",
      body: HOURS_REFUSAL,
      tone: 'error',
    });
  });

  it('puts a line back when its delete fails', async () => {
    const view = card();
    api.delete.mockRejectedValueOnce(Object.assign(new Error('Try again.'), { status: 500 }));
    named(view, 'Remove 1 web blog publish').props.onClick(click);
    view.render();
    await act(view, () => undoToast(view).props.onEnd());
    expect(lineOf(view, 21)).toBeTruthy();
    expect(toasts.at(-1)).toMatchObject({ title: "Couldn't remove the task", body: 'Try again.' });
  });
});

describe('Play', () => {
  it('shows only where a timer can start and starts it on the line', async () => {
    const view = card();
    const plays = find(view, (element) =>
      String(element.props['aria-label']).startsWith('Start a timer'),
    );
    expect(plays.map((element) => element.props['aria-label'])).toEqual([
      'Start a timer for 1 web blog publish',
      'Start a timer for Analysing the gsc stats',
      'Start a timer for Waiting on the client',
    ]);
    api.post.mockResolvedValueOnce({
      data: { ...todo(), timerState: { running: { projectId: 5 } } },
    });
    await act(view, () =>
      named(view, 'Start a timer for Analysing the gsc stats').props.onClick(click),
    );
    expect(api.post).toHaveBeenCalledWith('/api/me/todo/lines/22/timer');
    expect(toasts.at(-1)).toEqual({ title: 'Timer started on Studio Ubique.' });
  });

  it('toasts a refusal as it comes', async () => {
    const view = card();
    api.post.mockRejectedValueOnce(
      Object.assign(new Error('End your break to start a timer.'), { code: 'ALREADY_ON_BREAK' }),
    );
    await act(view, () => named(view, 'Start a timer for 1 web blog publish').props.onClick(click));
    expect(toasts.at(-1)).toEqual({
      title: "Couldn't start the timer",
      body: 'End your break to start a timer.',
      tone: 'error',
    });
  });
});

describe('Post to Slack', () => {
  it('posts, says Posting…, asks every 5 s while it sends, then Posted at 9:41 AM', async () => {
    vi.useFakeTimers();
    const view = card();
    let answer;
    api.post.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    button(view, 'Post to Slack').props.onClick(click);
    view.render();
    expect(api.post).toHaveBeenCalledWith('/api/me/todo/slack');
    expect(button(view, 'Posting…').props.disabled).toBe(true);
    const sending = todo({ post: { state: 'sending', at: AT, changed: false, postedAt: null } });
    await act(view, () => answer({ data: { queued: 'post', todo: sending } }));
    expect(button(view, 'Posting…').props.disabled).toBe(true);

    api.get.mockResolvedValue({ data: sending });
    await vi.advanceTimersByTimeAsync(5000);
    view.render();
    expect(api.get).toHaveBeenCalledWith('/api/me/todo');
    api.get.mockResolvedValue({
      data: todo({ post: { state: 'sent', at: AT, changed: false, postedAt: AT } }),
    });
    await vi.advanceTimersByTimeAsync(5000);
    view.render();
    expect(textOf(view)).toContain('Posted at 9:41 AM');
    expect(button(view, 'Post to Slack')).toBeUndefined();
    const calls = api.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(api.get.mock.calls.length).toBe(calls);
  });

  it('asks for up to a minute, then stops', async () => {
    vi.useFakeTimers();
    const sending = todo({ post: { state: 'sending', at: AT, changed: false, postedAt: null } });
    card(sending);
    api.get.mockResolvedValue({ data: sending });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(api.get).toHaveBeenCalledTimes(POLL_TIMES);
  });

  it('updates the post after a change, from "Update post"', async () => {
    const view = card(todo({ post: { state: 'sent', at: AT, changed: true, postedAt: AT } }));
    api.post.mockResolvedValueOnce({ data: { queued: 'update', todo: todo() } });
    button(view, 'Update post').props.onClick(click);
    view.render();
    expect(button(view, 'Updating…').props.disabled).toBe(true);
    await act(view);
    expect(api.post).toHaveBeenCalledWith('/api/me/todo/slack');
  });
});

describe('the timer form', () => {
  const form = (todoGroups) =>
    mount(TimerStartForm, {
      picker: { urgent: [], mine: [PTL, SU, DOT], others: [], requests: [] },
      tasks: {},
      busy: false,
      starting: false,
      switching: true,
      onStart: vi.fn(),
      onCancel: vi.fn(),
      todoGroups,
      onStartLine: vi.fn(),
    });
  const note = (view) =>
    find(
      view,
      (element) =>
        element.type === 'input' && element.props.placeholder === 'What are you working on?',
    )[0];
  const pick = (view, project) => {
    find(view, (element) => element.type === 'project-picker')[0].props.onPick({
      projectId: project.id,
      name: project.name,
      color: project.color,
    });
    view.render();
  };

  it("offers the picked project's to-do lines that aren't done, and starts one", () => {
    const view = form(groups());
    pick(view, SU);
    expect(note(view).props.role).toBe('combobox');
    note(view).props.onFocus();
    view.render();
    expect(textOf(view)).toContain('Your to-do on Studio Ubique');
    const options = find(view, (element) => element.props.role === 'option');
    expect(options.map(flat)).toEqual([
      '1 web blog publish',
      'Analysing the gsc stats',
      'Waiting on the client',
    ]);
    note(view).props.onChange({ target: { value: 'waiting' } });
    view.render();
    const [only] = find(view, (element) => element.props.role === 'option');
    expect(flat(only)).toBe('Waiting on the client');
    only.props.onClick();
    expect(view.props.onStartLine).toHaveBeenCalledWith(24);
  });

  it('stays a plain field for a project without to-do lines', () => {
    const view = form(groups());
    pick(view, DOT);
    expect(note(view).props.role).toBeUndefined();
    const none = form(undefined);
    pick(none, SU);
    expect(note(none).props.role).toBeUndefined();
  });
});

const addField = (view, name = 'Studio Ubique') => named(view, `Add a task to ${name}`);
function typeInto(view, value, name) {
  addField(view, name).props.onChange({ target: { value } });
  view.render();
}
/** A request that answers when the test says so. */
function deferred(fn) {
  const answers = [];
  fn.mockImplementation(() => new Promise((resolve, reject) => answers.push({ resolve, reject })));
  return answers;
}
const suggested = (taskId, title) => ({
  taskId,
  title,
  status: 'in_progress',
  workDate: '2026-11-11',
  dayLabel: 'From Wednesday',
});
/** The to-do without Studio Ubique's old entry, its new lines on a new entry. */
function studioReplaced(entryId, lines) {
  const list = groups();
  list[1] = { entryId, project: SU, minutes: 0, lines };
  return todo({ groups: list });
}

describe('an add meeting a row waiting behind Undo', () => {
  it('sends the hidden line’s DELETE first, then adds the retyped line, shown at once', async () => {
    const view = card();
    named(view, 'Remove Analysing the gsc stats').props.onClick(click);
    view.render();
    const deletes = deferred(api.delete);
    const saved = todo();
    saved.groups[1].lines.splice(1, 1, line(25, 'analysing the GSC stats'));
    api.post.mockResolvedValueOnce({
      data: { ...todo({ groups: saved.groups }), added: true, lineId: 25 },
    });
    typeInto(view, 'analysing the GSC stats');
    addField(view).props.onKeyDown(key('Enter'));
    await act(view);
    // The DELETE went at once (its toast with it); the add waits for its answer.
    expect(api.delete).toHaveBeenCalledWith('/api/me/todo/lines/22');
    expect(undoToast(view)).toBeUndefined();
    expect(api.post).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('analysing the GSC stats');
    expect(textOf(view)).toContain('1 of 5 done');
    await act(view, () => deletes[0].resolve({ data: {} }));
    expect(api.post).toHaveBeenCalledWith('/api/me/todo/lines', {
      projectId: 5,
      title: 'analysing the GSC stats',
    });
    expect(toasts).not.toContainEqual({ title: 'Already in your to-do.' });
    expect(lineOf(view, 25)).toBeTruthy();
    expect(lineOf(view, 22)).toBeUndefined();
  });

  it('waits for a DELETE already on its way too', async () => {
    const view = card();
    named(view, 'Remove Analysing the gsc stats').props.onClick(click);
    view.render();
    const deletes = deferred(api.delete);
    await act(view, () => undoToast(view).props.onEnd());
    expect(api.delete).toHaveBeenCalledTimes(1);
    api.post.mockResolvedValueOnce({ data: { ...todo(), added: true, lineId: 25 } });
    typeInto(view, 'Analysing the gsc stats');
    addField(view).props.onKeyDown(key('Enter'));
    await act(view);
    expect(api.post).not.toHaveBeenCalled();
    await act(view, () => deletes[0].resolve({ data: {} }));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('pastes into a removed project only after its DELETE, as a new group shown at once', async () => {
    const view = card();
    named(view, 'Remove Studio Ubique').props.onClick(click);
    view.render();
    const deletes = deferred(api.delete);
    button(view, 'Paste a list').props.onClick(click);
    view.render();
    find(view, (element) => element.type === 'textarea')[0].props.onChange({
      target: { value: 'Project: Studio Ubique\n* One topic\n* Two topics' },
    });
    view.render();
    api.post.mockResolvedValueOnce({
      data: {
        added: 2,
        skipped: 0,
        todo: studioReplaced(7, [line(71, 'One topic'), line(72, 'Two topics')]),
      },
    });
    button(view, 'Add 2 tasks').props.onClick(click);
    await act(view);
    expect(api.delete).toHaveBeenCalledWith('/api/me/todo/projects/2');
    expect(api.post).not.toHaveBeenCalled();
    // The new lines show at once, without the removed project's old ones.
    expect(textOf(view)).toContain('One topic');
    expect(textOf(view)).not.toContain('1 web blog publish');
    await act(view, () => deletes[0].resolve({ data: {} }));
    expect(api.post).toHaveBeenCalledWith('/api/me/todo/lines/bulk', {
      groups: [
        {
          projectId: 5,
          lines: [
            { title: 'One topic', status: 'in_progress' },
            { title: 'Two topics', status: 'in_progress' },
          ],
        },
      ],
    });
    expect(toasts.at(-1)).toEqual({ title: 'Added 2 tasks.' });
    expect(lineOf(view, 71)).toBeTruthy();
    expect(textOf(view)).toContain('1 of 3 done');
  });

  it('adds from the Still open dialog to a removed project after its DELETE', async () => {
    // The dialog keeps focus inside it (it reads the page's focus).
    vi.stubGlobal('document', { activeElement: { isConnected: true }, body: {} });
    const view = card(todo({ suggestions: { p5: [suggested(70, 'Old open thing')] } }));
    named(view, 'Remove Studio Ubique').props.onClick(click);
    view.render();
    const deletes = deferred(api.delete);
    button(view, 'Studio Ubique (1)').props.onClick(click);
    view.render();
    api.post.mockResolvedValueOnce({
      data: { ...studioReplaced(7, [line(73, 'Old open thing')]), added: true, lineId: 73 },
    });
    named(view, 'Add to today: Old open thing').props.onClick(click);
    await act(view);
    expect(api.delete).toHaveBeenCalledWith('/api/me/todo/projects/2');
    expect(api.post).not.toHaveBeenCalled();
    await act(view, () => deletes[0].resolve({ data: {} }));
    expect(api.post).toHaveBeenCalledWith('/api/me/todo/lines', {
      projectId: 5,
      title: 'Old open thing',
      carriedFromTaskId: 70,
    });
    expect(toasts.at(-1)).toEqual({ title: 'Added to today.' });
    expect(lineOf(view, 73)).toBeTruthy();
  });

  it('adds a priority task to a removed project after its DELETE, and shows "In to-do"', async () => {
    const priority = {
      rows: [
        {
          id: 40,
          priority: 'P1',
          title: 'Fix the sitemap',
          projectId: 5,
          project: { name: SU.name, color: SU.color },
          forYou: true,
        },
      ],
      initial: 5,
    };
    function WithPriority({ initialTodo }) {
      return createElement(
        TodoProvider,
        { initialTodo },
        createElement(TodoCard, { picker: PICKER, priority: {}, tz: TZ }),
        createElement(PriorityCard, { priority }),
      );
    }
    const view = mount(WithPriority, { initialTodo: todo() });
    named(view, 'Remove Studio Ubique').props.onClick(click);
    view.render();
    const deletes = deferred(api.delete);
    api.post.mockResolvedValueOnce({
      data: {
        ...studioReplaced(7, [line(74, 'Fix the sitemap', { projectTaskId: 40 })]),
        added: true,
        lineId: 74,
      },
    });
    named(view, 'Add to to-do: Fix the sitemap').props.onClick(click);
    await act(view);
    expect(api.delete).toHaveBeenCalledWith('/api/me/todo/projects/2');
    // Shown at once: the line, and "In to-do" instead of the Plus.
    expect(textOf(view)).toContain('In to-do');
    expect(named(view, 'Add to to-do: Fix the sitemap')).toBeUndefined();
    await act(view, () => deletes[0].resolve({ data: {} }));
    expect(api.post).toHaveBeenCalledWith('/api/me/todo/lines', {
      projectId: 5,
      title: 'Fix the sitemap',
      projectTaskId: 40,
    });
    expect(lineOf(view, 74)).toBeTruthy();
  });

  it('leaves a waiting delete of another project alone', () => {
    const view = card();
    named(view, 'Remove Pine Tree Lane').props.onClick(click);
    view.render();
    api.post.mockResolvedValueOnce({ data: { ...todo(), added: true, lineId: 25 } });
    typeInto(view, 'Shortlist 5 topics');
    addField(view).props.onKeyDown(key('Enter'));
    view.render();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.delete).not.toHaveBeenCalled();
    expect(undoToast(view).props.pending.title).toBe('Project removed.');
  });
});

/** The to-do with these Studio Ubique lines Done. */
function ticked(ids) {
  const list = groups();
  list[1].lines = list[1].lines.map((item) =>
    ids.includes(item.id) ? { ...item, done: true, status: 'done', canStart: false } : item,
  );
  return todo({ groups: list });
}
const boxes = (view) =>
  ['1 web blog publish', 'Analysing the gsc stats'].map(
    (title) => named(view, `Done: ${title}`).props.checked,
  );
function tickBoth(view) {
  named(view, 'Done: 1 web blog publish').props.onChange({ target: { checked: true } });
  view.render();
  named(view, 'Done: Analysing the gsc stats').props.onChange({ target: { checked: true } });
  view.render();
}

describe('quick ticks', () => {
  it('never untick a box when an answer read before the next tick comes back', async () => {
    const view = card();
    const answers = deferred(api.patch);
    tickBoth(view);
    expect(boxes(view)).toEqual([true, true]);
    await act(view, () => answers[0].resolve({ data: ticked([21]) }));
    expect(boxes(view)).toEqual([true, true]);
    await act(view, () => answers[1].resolve({ data: ticked([21, 22]) }));
    expect(boxes(view)).toEqual([true, true]);
  });

  it('drops an older answer that comes back after a newer one', async () => {
    const view = card();
    const answers = deferred(api.patch);
    tickBoth(view);
    await act(view, () => answers[1].resolve({ data: ticked([21, 22]) }));
    await act(view, () => answers[0].resolve({ data: ticked([21]) }));
    expect(boxes(view)).toEqual([true, true]);
    expect(textOf(view)).toContain('3 of 5 done');
  });

  it('keeps them over a page refresh read before them, and takes the one after', async () => {
    const view = card();
    const answers = deferred(api.patch);
    tickBoth(view);
    await act(view, () => answers[0].resolve({ data: ticked([21]) }));
    await act(view, () => answers[1].resolve({ data: ticked([21, 22]) }));
    view.render({ initialTodo: todo() });
    expect(boxes(view)).toEqual([true, true]);
    // The next refresh was read after that one arrived, so it is the server's word (here the
    // report tab unticked one meanwhile).
    view.render({ initialTodo: ticked([21]) });
    expect(boxes(view)).toEqual([true, false]);
  });

  it('takes back only the tick that failed', async () => {
    const view = card();
    const answers = deferred(api.patch);
    tickBoth(view);
    await act(view, () => answers[0].resolve({ data: ticked([21]) }));
    await act(view, () => answers[1].reject(new Error('Try again.')));
    expect(boxes(view)).toEqual([true, false]);
  });
});

describe('focus after the buttons go', () => {
  const BODY = { tag: 'body' };

  it('moves focus from Play to the line’s title once the timer runs', async () => {
    const view = card();
    const play = { label: 'play', isConnected: true };
    vi.stubGlobal('document', { activeElement: play, body: BODY });
    const now = todo();
    now.groups[1].lines[1] = { ...now.groups[1].lines[1], now: true, canStart: false };
    api.post.mockResolvedValueOnce({ data: { ...now, timerState: { running: { projectId: 5 } } } });
    await act(view, () =>
      named(view, 'Start a timer for Analysing the gsc stats').props.onClick({
        detail: 0,
        currentTarget: play,
      }),
    );
    expect(named(view, 'Start a timer for Analysing the gsc stats')).toBeUndefined();
    expect(focused?.label).toBe('Edit task: Analysing the gsc stats');
  });

  it('leaves focus where it is after a refusal, or when it moved on meanwhile', async () => {
    const view = card();
    const play = { label: 'play', isConnected: true };
    vi.stubGlobal('document', { activeElement: play, body: BODY });
    api.post.mockRejectedValueOnce(new Error('End your break to start a timer.'));
    await act(view, () =>
      named(view, 'Start a timer for 1 web blog publish').props.onClick({
        detail: 0,
        currentTarget: play,
      }),
    );
    expect(focused).toBeNull();
    let answer;
    api.post.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    named(view, 'Start a timer for 1 web blog publish').props.onClick({
      detail: 0,
      currentTarget: play,
    });
    document.activeElement = { label: 'elsewhere', isConnected: true };
    await act(view, () => answer({ data: todo() }));
    expect(focused).toBeNull();
  });

  it('moves focus to "Add a task" when a keyboard add empties the suggestion box', () => {
    const view = card(todo({ suggestions: { p5: [suggested(70, 'Old open thing')] } }));
    api.post.mockResolvedValueOnce({ data: todo() });
    named(view, 'Add to today: Old open thing').props.onClick({ detail: 0 });
    view.render();
    expect(focused?.label).toBe('Add a task to Studio Ubique');
    expect(named(view, 'Add to today: Old open thing')).toBeUndefined();
  });

  it('does so for "Add all to today" too, but not for a mouse click or while rows are left', () => {
    vi.stubGlobal('document', { activeElement: { isConnected: true }, body: BODY });
    const two = { p5: [suggested(70, 'Old open thing'), suggested(71, 'Another old thing')] };
    api.post.mockResolvedValue({ data: { added: 2, skipped: 0, todo: todo() } });
    const mouse = card(todo({ suggestions: two }));
    button(mouse, 'Add all to today').props.onClick({ detail: 1 });
    mouse.render();
    expect(focused).toBeNull();
    const left = card(todo({ suggestions: two }));
    named(left, 'Add to today: Old open thing').props.onClick({ detail: 0 });
    left.render();
    expect(focused).toBeNull();
    const keyboard = card(todo({ suggestions: two }));
    button(keyboard, 'Add all to today').props.onClick({ detail: 0 });
    keyboard.render();
    expect(focused?.label).toBe('Add a task to Studio Ubique');
  });
});

describe('the timer form’s Play on a to-do line', () => {
  it('takes the answer like a write: shown, but never over a tick still on its way', async () => {
    const view = card();
    const value = [...R.contexts.values()].find((item) => item?.track);
    const answers = deferred(api.patch);
    named(view, 'Done: 1 web blog publish').props.onChange({ target: { checked: true } });
    view.render();
    const now = todo();
    now.groups[1].lines[1] = { ...now.groups[1].lines[1], now: true, canStart: false };
    const result = await value.track(() =>
      Promise.resolve({ data: { ...now, timerState: { running: { projectId: 5 } } } }),
    );
    view.render();
    expect(result.data.timerState).toEqual({ running: { projectId: 5 } });
    expect(named(view, 'Start a timer for Analysing the gsc stats')).toBeUndefined();
    expect(named(view, 'Done: 1 web blog publish').props.checked).toBe(true);
    await act(view, () => answers[0].resolve({ data: ticked([21]) }));
    expect(named(view, 'Done: 1 web blog publish').props.checked).toBe(true);
  });
});

describe('pasting into a project’s "Add a task"', () => {
  it('puts the lines without a heading on that project, ready to add', async () => {
    const view = card();
    addField(view).props.onPaste({
      clipboardData: { getData: () => '* Audit the sitemap\n* Fix broken links' },
      preventDefault: vi.fn(),
    });
    view.render();
    expect(textOf(view)).toContain('We found 1 project and 2 tasks.');
    expect(textOf(view)).not.toContain('These tasks have no project.');
    expect(named(view, 'Change the project for tasks without a project')).toBeTruthy();
    api.post.mockResolvedValueOnce({ data: { added: 2, skipped: 0, todo: todo() } });
    await act(view, () => button(view, 'Add 2 tasks').props.onClick(click));
    expect(api.post).toHaveBeenCalledWith('/api/me/todo/lines/bulk', {
      groups: [
        {
          projectId: 5,
          lines: [
            { title: 'Audit the sitemap', status: 'in_progress' },
            { title: 'Fix broken links', status: 'in_progress' },
          ],
        },
      ],
    });
  });
});
