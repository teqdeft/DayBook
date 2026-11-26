// A focus rule of 1.12 (CONTRACT 27, Look, phone and accessibility), with React's hooks stood in
// for so the hook runs as a plain function: the task form's Save with a paused file puts focus on
// that chip's Retry, found by the chip's id inside the form's Files box (focusChipRetry, the one
// way to do it). Split from keyboardFocus.test.js by CONTRACT 28, Files and owners (the Menu's
// rule is in menuFocus.test.js).
import { describe, expect, it, vi } from 'vitest';

const uploads = vi.hoisted(() => ({ items: [] }));
const retryFocus = vi.hoisted(() => ({ calls: [] }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal();
  const noop = () => {};
  return {
    ...actual,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, noop],
    useRef: (initial) => ({ current: initial }),
    useCallback: (fn) => fn,
    useMemo: (make) => make(),
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

const { useTaskForm } = await import('@/app/(app)/projects/[id]/_board/useTaskForm.js');
const chip = await vi.importActual('@/components/files/UploadChip.jsx');

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
