// Two focus rules of 1.12 (CONTRACT 27, Look, phone and accessibility), with React's hooks
// stood in for so the components run as plain functions: the shared Menu hands the item's click
// to onSelect, so a row's Delete chosen with Enter or Space (detail 0) can give its Undo toast the
// focus; and the task form's Save with a paused file puts focus on that chip's Retry, found by
// the chip's id inside the form's Files box (focusChipRetry, the one way to do it).
import { describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ menuOpen: false }));
const uploads = vi.hoisted(() => ({ items: [] }));
const retryFocus = vi.hoisted(() => ({ calls: [] }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal();
  const noop = () => {};
  return {
    ...actual,
    // The Menu's one state is where its list sits: open at once when menuOpen.
    useState: (initial) => [
      hooks.menuOpen ? { top: 0, left: 0 } : typeof initial === 'function' ? initial() : initial,
      noop,
    ],
    useRef: (initial) => ({ current: initial }),
    useId: () => 'menu-1',
    useEffect: noop,
    useLayoutEffect: noop,
  };
});
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('@/components/files/useUploads', () => ({
  useUploads: () => ({ items: uploads.items, readyKeys: [], forget: () => {} }),
}));
vi.mock('@/components/files/UploadChip', async (importOriginal) => ({
  ...(await importOriginal()),
  focusChipRetry: (...args) => retryFocus.calls.push(args),
}));
vi.mock('@/components/task/useTaskDetails', () => ({ forgetTaskDetails: () => {} }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => () => {} }));
vi.mock('@/lib/apiClient', () => ({ api: { post: vi.fn(), patch: vi.fn() } }));

const { default: Menu } = await import('@/components/Menu.jsx');
const { useTaskForm } = await import('@/app/(app)/projects/[id]/_board/useTaskForm.js');
const chip = await vi.importActual('@/components/files/UploadChip.jsx');

/** Every element of a rendered tree, depth first. */
function elementsOf(node, found = []) {
  if (Array.isArray(node)) node.forEach((child) => elementsOf(child, found));
  else if (node && typeof node === 'object' && node.props) {
    found.push(node);
    elementsOf(node.props.children, found);
  }
  return found;
}

describe('the Menu', () => {
  it("hands the item's click to onSelect, so Enter or Space can be told from a tap", () => {
    hooks.menuOpen = true;
    const chosen = [];
    const items = [
      { label: 'Edit details', onSelect: (event) => chosen.push(['edit', event]) },
      { label: 'Delete', tone: 'danger', onSelect: (event) => chosen.push(['delete', event]) },
    ];
    const tree = Menu({ label: 'More for brief.pdf', items });
    hooks.menuOpen = false;
    const entries = elementsOf(tree).filter((element) => element.props.role === 'menuitem');
    expect(entries).toHaveLength(2);
    const keyboard = { detail: 0 };
    entries[1].props.onClick(keyboard);
    expect(chosen).toEqual([['delete', keyboard]]);
  });

  it('never calls onSelect for a disabled item', () => {
    hooks.menuOpen = true;
    const onSelect = vi.fn();
    const tree = Menu({ label: 'More', items: [{ label: 'Edit', onSelect, disabled: true }] });
    hooks.menuOpen = false;
    elementsOf(tree)
      .find((element) => element.props.role === 'menuitem')
      .props.onClick({ detail: 0 });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("the task form's Save with a paused file", () => {
  it("puts focus on that chip's Retry by its id, inside the form's Files box", async () => {
    uploads.items = [
      { id: 'upload-3', name: 'brief.pdf', state: 'ready' },
      { id: 'upload-4', name: 'brief.pdf', state: 'paused' },
    ];
    retryFocus.calls.length = 0;
    const form = useTaskForm({
      form: { preset: { title: 'Fix the login page', phase: 'design' } },
      task: null,
      details: {},
      projectId: 5,
      plan: { currentPhase: 'design' },
      limits: {},
      onClose: () => {},
      onSaved: () => {},
    });
    const box = { querySelector: () => null };
    form.filesRef.current = box;
    await form.save({ preventDefault: () => {} });
    expect(retryFocus.calls).toEqual([['upload-4', box]]);
  });
});

describe('focusChipRetry', () => {
  it("focuses the Retry with that chip's id, in the box given or else on the page", () => {
    vi.stubGlobal('CSS', { escape: (value) => value.replace(/"/g, '\\"') });
    const retry = { focus: vi.fn() };
    const asked = [];
    const box = { querySelector: (selector) => (asked.push(selector), retry) };
    chip.focusChipRetry('upload-4', box);
    expect(asked).toEqual(['[data-chip-retry="upload-4"]']);
    expect(retry.focus).toHaveBeenCalledTimes(1);
    const page = { querySelector: () => retry };
    vi.stubGlobal('document', page);
    chip.focusChipRetry('upload-5');
    expect(retry.focus).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
