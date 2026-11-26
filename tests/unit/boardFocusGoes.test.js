// Focus after a control of the board goes away (CONTRACT 28, Look and accessibility: never to the
// page): "Group by phase again" hands it to the switch's Table button (as the prototype) and Clear
// all to the search; the Undo of "Project reopened." waits on "Add task" (or the header's "+ New
// task") and gives it to "Reopen project" once that is back, unless the person has moved on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { elementsOf, findAll, render, resetHooks } from '../helpers/hookTree';
import { el, installGlobals } from '../helpers/motionFakes';

const fakes = vi.hoisted(() => ({
  commit: () => {},
  patch: () => Promise.resolve(),
  toast: () => {},
  flipped: [],
}));
vi.mock('react', async (original) =>
  (await import('../helpers/hookTree.js')).reactWithHooks(await original()),
);
vi.mock('react-dom', async (original) => ({
  ...(await original()),
  flushSync(change) {
    change();
    fakes.commit();
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock('@/components/ToastProvider', () => ({
  useToast:
    () =>
    (...args) =>
      fakes.toast(...args),
}));
vi.mock('@/lib/apiClient', () => ({ api: { patch: (...args) => fakes.patch(...args) } }));
vi.mock('@/components/Dialog', () => ({ default: () => null }));
vi.mock('@/app/(app)/projects/[id]/UndoToast.jsx', () => ({
  default: (props) => ({ type: 'undo-toast', props }),
}));
vi.mock('@/app/(app)/projects/[id]/_board/table/useTableSort.js', () => ({
  flipRows(change) {
    fakes.flipped.push('flip');
    change();
  },
}));

const { default: FilterLine } = await import('@/app/(app)/projects/[id]/_board/FilterLine.jsx');
const { default: ViewSwitch } = await import('@/app/(app)/projects/[id]/_board/ViewSwitch.jsx');
const { ProjectStatusProvider } =
  await import('@/app/(app)/projects/[id]/_board/ReopenProject.jsx');
const { REOPEN_ID, viewButtonId } = await import('@/app/(app)/projects/[id]/_board/boardView.js');

let page;
beforeEach(() => {
  page = installGlobals();
  resetHooks();
  fakes.commit = () => {};
  fakes.patch = vi.fn(async () => ({}));
  fakes.toast = vi.fn();
  fakes.flipped.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

/** A button on the page with this id. */
function button(id) {
  const node = el('button', { attrs: { id } });
  page.body.append(node);
  return node;
}
/** A focused element that leaves the page drops the focus to it, as a browser does. */
function leaves(node) {
  node.remove();
  if (page.doc.activeElement === node) page.doc.activeElement = page.body;
}
const active = () => page.doc.activeElement;

describe('the line under the toolbar', () => {
  const board = (more) => ({
    tasks: [{ id: 1, status: 'open' }],
    access: 'manage',
    view: 'table',
    counts: {},
    filters: { state: { query: 'x', mine: false, face: null }, matches: () => true, clear() {} },
    tableSort: { key: 'due', dir: 'ascending', clear: vi.fn() },
    ...more,
  });
  const press = (tree, words) =>
    findAll(tree, (props) => props.children === words)[0].props.onClick();

  it('"Group by phase again" gives the focus to the Table button', () => {
    const table = button('board-view-table');
    const shown = board();
    press(render(FilterLine, { board: shown }), 'Group by phase again');
    expect(shown.tableSort.clear).toHaveBeenCalledTimes(1);
    expect(fakes.flipped).toEqual(['flip']);
    expect(active()).toBe(table);
    expect(table.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('Clear all gives it to the search', () => {
    const search = button('board-search');
    press(render(FilterLine, { board: board() }), 'Clear all');
    expect(active()).toBe(search);
  });

  it('the switch draws those ids', () => {
    const tree = render(ViewSwitch, { view: 'table', onView() {} });
    const ids = findAll(tree, (props) => props.id).map((element) => element.props.id);
    expect(ids).toEqual([viewButtonId('board'), viewButtonId('table')]);
    expect(viewButtonId('table')).toBe('board-view-table');
  });
});

describe('the Undo of "Project reopened."', () => {
  const draw = () => render(ProjectStatusProvider, { projectId: 15, status: 'completed' });
  const toastOf = (tree) => elementsOf(tree).find((one) => one.type === 'undo-toast').props;
  const valueOf = (tree) => findAll(tree, (props) => props.value?.reopen)[0].props.value;

  /** The project reopened from `focusId`: the toast shows, the focus on its Undo. */
  async function reopened(focusId) {
    button(focusId);
    await valueOf(draw()).reopen(focusId);
    const undo = button('undo');
    undo.focus();
    const toast = toastOf(draw());
    expect(toast.pending).toMatchObject({ title: 'Project reopened.', focusId });
    return toast;
  }

  it.each(['board-add-task', 'project-new-task'])(
    'waits on %s, then goes to "Reopen project"',
    async (id) => {
      const toast = await reopened(id);
      const add = page.doc.getElementById(id);
      let answer;
      fakes.patch = vi.fn(() => new Promise((resolve) => (answer = resolve)));
      fakes.commit = () => {
        leaves(add);
        button(REOPEN_ID);
      };
      const done = toast.onUndo();
      expect(active(), 'while the answer is on its way').toBe(add);
      expect(fakes.patch).toHaveBeenCalledWith('/api/projects/15', { status: 'completed' });
      answer({});
      await done;
      expect(active()).toBe(page.doc.getElementById(REOPEN_ID));
      expect(toastOf(draw()).pending).toBeNull();
    },
  );

  it('leaves the focus where the person took it meanwhile', async () => {
    const toast = await reopened('board-add-task');
    const add = page.doc.getElementById('board-add-task');
    const search = button('board-search');
    fakes.commit = () => {
      leaves(add);
      button(REOPEN_ID);
    };
    const done = toast.onUndo();
    search.focus();
    await done;
    expect(active()).toBe(search);
  });

  it('stays on "Add task" when the Undo fails', async () => {
    const toast = await reopened('board-add-task');
    fakes.patch = vi.fn(async () => Promise.reject(new Error('Not now.')));
    await toast.onUndo();
    expect(active()).toBe(page.doc.getElementById('board-add-task'));
    expect(fakes.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't undo", body: 'Not now.' }),
    );
  });
});
