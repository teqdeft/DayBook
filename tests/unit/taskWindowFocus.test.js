// Focus in the task window (CONTRACT 27, Task window: "Focus stays inside while open"; CONTRACT 22,
// BusyButton; CONTRACT 28, Focus after a control goes away): while Mark done and Reopen work the
// pressed button stays focusable (aria-disabled and aria-busy, never disabled), so the browser
// doesn't drop the focus to the page behind the open window; Mark done keeps its Check icon when
// idle (useTransition is held busy here, as it is while the status request runs). Assign to me in
// the rail puts the focus on the "Assigned to" face button, and hands the page's take that button
// to focus again once the new face shows. That the new Reopen takes the focus when the footer
// flips, and that Escape then finds the card again under "› 6 done", runs in the browser.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({ busy: false, actions: null }));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal();
  return { ...react, useTransition: () => [page.busy, () => {}] };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastSlot: () => null,
}));
vi.mock('@/app/(app)/projects/[id]/_board/TaskEditorProvider', () => ({
  useTaskEditor: () => ({ openEdit: () => {}, remove: () => {} }),
  useSavedTask: () => null,
  TaskEditorProvider: ({ children }) => children,
}));

vi.mock('@/app/(app)/projects/[id]/_board/TaskActionsProvider', () => ({
  useTaskActions: () => page.actions,
}));

const { useTaskWindowFooter } = await import('@/components/task/TaskWindowFooter.jsx');
const { useWindowActions } = await import('@/components/task/useWindowActions.js');

const task = (status) => ({ id: 40, projectId: 5, title: 'Go live', status, canManage: true });

function Footer(props) {
  return createElement('footer', null, useTaskWindowFooter(props));
}
const footer = (status) =>
  renderToStaticMarkup(
    createElement(Footer, { task: task(status), mode: 'manage', todo: null, onClose: () => {} }),
  );
/** The <button> tag whose text ends with the label. */
const buttonOf = (html, label) =>
  [...html.matchAll(/<button\b[^>]*>(?:(?!<\/button>).)*<\/button>/g)]
    .map((match) => match[0])
    .find((tag) => tag.replace(/<[^>]+>/g, '').trim() === label);
const openTag = (tag) => tag.match(/^<button\b[^>]*>/)[0];

beforeEach(() => {
  page.busy = false;
});

describe('Mark done and Reopen while they work', () => {
  it.each([
    ['open', 'Mark done'],
    ['done', 'Reopen'],
  ])('keeps the focus on a %s task’s "%s": aria-disabled, never disabled', (status, label) => {
    page.busy = true;
    const tag = openTag(buttonOf(footer(status), label));
    expect(tag).toContain('aria-disabled="true"');
    expect(tag).toContain('aria-busy="true"');
    expect(tag).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it('is an ordinary button when idle, Mark done with its Check icon', () => {
    const markDone = buttonOf(footer('open'), 'Mark done');
    expect(openTag(markDone)).not.toContain('aria-disabled');
    expect(markDone).toContain('lucide-check');
    expect(markDone).not.toContain('lucide-loader-circle');
    expect(openTag(buttonOf(footer('done'), 'Reopen'))).not.toContain('aria-disabled');
  });
});

describe('Assign to me in the task window', () => {
  it('puts the focus on the face button and lets the take focus it again', () => {
    const take = vi.fn();
    page.actions = { take, apply: (tasks) => tasks, openPeople: vi.fn(), openMove: vi.fn() };
    let got = null;
    function Probe() {
      got = useWindowActions({ id: 40, title: 'Go live', assignee: null, status: 'open' });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    const face = { focus: vi.fn() };
    got.faceRef.current = face;
    const button = { tagName: 'BUTTON' };
    got.take(button);
    expect(face.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(take).toHaveBeenCalledTimes(1);
    const [task, options] = take.mock.calls[0];
    expect(task.id).toBe(40);
    expect(options.origin).toBe(button);
    expect(options.focus()).toBe(face);
    page.actions = null;
  });
});
