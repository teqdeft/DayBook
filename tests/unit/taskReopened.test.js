// A task opened again from the task window (CONTRACT 28, Task window; taskEvents.js): the footer's
// Reopen tells the page's tick holds (TASK_REOPENED) as the "Marked done." toast's Undo does, once
// the server has it and before the page's refresh, so a card ticked a moment ago is open again at
// once, not after its hold ends. Mark done says nothing, nor does a Reopen the server refused. The
// board's own side is in tickLeave.test.js, My tasks' in mineTick.test.js.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findAll, render, resetHooks, textOf } from '../helpers/hookTree.js';

vi.mock('react', async (original) =>
  (await import('../helpers/hookTree.js')).reactWithHooks(await original()),
);

const page = vi.hoisted(() => ({ calls: [], fail: null, editor: null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => page.calls.push(['refresh']) }),
}));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => (toast) => page.calls.push(['toast', toast.title]),
  useToastSlot: () => null,
}));
vi.mock('@/lib/apiClient', () => ({
  api: {
    post: async (url, body) => {
      page.calls.push(['post', url, body.status]);
      if (page.fail) throw page.fail;
    },
  },
}));
vi.mock('@/app/(app)/projects/[id]/_board/TaskEditorProvider', () => ({
  useTaskEditor: () => page.editor,
}));
vi.mock('@/app/(app)/projects/[id]/TaskUndoProvider', () => ({
  useTaskUndo: () => (tick) => page.calls.push(['undo', tick.taskId]),
}));

const { useTaskWindowFooter } = await import('@/components/task/TaskWindowFooter.jsx');
const { TASK_REOPENED } = await import('@/app/(app)/projects/[id]/taskEvents.js');

const Footer = (props) => ({
  type: 'footer',
  props: { children: useTaskWindowFooter(props) },
});

/** Presses the footer's button with this label; resolves once its request has been answered. */
async function press(label, { status, mode = 'manage' }) {
  resetHooks();
  const task = { id: 88, projectId: 5, title: 'Go live', status, canManage: true };
  const tree = render(Footer, { task, mode, todo: null, onClose: () => {} });
  const button = findAll(tree, (props) => props.onClick).find((one) => textOf(one) === label);
  button.props.onClick({ detail: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return page.calls;
}

beforeEach(() => {
  Object.assign(page, { calls: [], fail: null });
  page.editor = { openEdit: () => {}, remove: () => {} };
  const target = new EventTarget();
  target.addEventListener(TASK_REOPENED, (event) =>
    page.calls.push(['reopened', event.detail.taskId]),
  );
  vi.stubGlobal('window', target);
});

describe("the task window's Reopen", () => {
  it.each(['manage', 'mine'])('tells the page before its refresh (%s)', async (mode) => {
    expect(await press('Reopen', { status: 'done', mode })).toEqual([
      ['post', '/api/project-tasks/88/status', 'open'],
      ['reopened', 88],
      ['toast', 'Reopened.'],
      ['refresh'],
    ]);
  });

  it('says nothing when the server refused it', async () => {
    page.fail = new Error('No connection.');
    expect(await press('Reopen', { status: 'done' })).toEqual([
      ['post', '/api/project-tasks/88/status', 'open'],
      ['toast', "Couldn't change the task"],
    ]);
  });

  it('Mark done offers Undo and says nothing', async () => {
    expect(await press('Mark done', { status: 'open' })).toEqual([
      ['post', '/api/project-tasks/88/status', 'done'],
      ['undo', 88],
      ['refresh'],
    ]);
  });
});
