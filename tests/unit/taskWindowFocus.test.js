// Focus in the task window while Mark done and Reopen work (CONTRACT 27, Task window: "Focus stays
// inside while open"; CONTRACT 22, BusyButton): the pressed button stays focusable (aria-disabled
// and aria-busy, never disabled), so the browser doesn't drop the focus to the page behind the
// open window; Mark done keeps its Check icon when idle. useTransition is held busy here, as it is
// while the status request runs. That the new Reopen takes the focus when the footer flips, and
// that Escape then finds the card again under "› 6 done", runs in the browser.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({ busy: false }));

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

const { useTaskWindowFooter } = await import('@/components/task/TaskWindowFooter.jsx');

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
