// The task window and the project page's windows match the prototypes (CONTRACT 27, Screens;
// CONTRACT 28, Task window; docs/design/project-tasks-prototype.html): the task window at 720 px
// in two columns (minmax(0, 1fr) and a 220 px rail after a 1 px line, 24 px apart; one column with
// the facts first below a 720 px window), its header (no 5 px drop under the project line), its
// thumbnails' size line (the page's 1.45 line height), the centred error text, the dashed "Anyone"
// circle, its exit and a link's window without an entrance, and on a phone a sheet that fills the
// screen with its footer at the bottom edge and a 44 px X and "Add files"; every other project page
// window's X 44 px on a phone (Dialog stays as it is, so each passes `projectWindows.module.css`'s
// `.window`); and New and Edit task's footer at the bottom of their sheet. Split from
// boardLook.test.js (CONTRACT 28, Files and owners: the cards and the board stay there). Browser
// checks: the review's measurements in a copy.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({ attach: null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastSlot: () => null,
}));
vi.mock('@/app/(app)/projects/[id]/_board/TaskActionsProvider', () => ({
  useTaskActions: () => null,
}));
vi.mock('@/components/files/TaskAttachProvider', () => ({
  useTaskAttach: () => page.attach,
  useTaskBatch: () => null,
  TaskAttachProvider: ({ children }) => children,
}));
// Dialog draws nothing on the server; this one shows the className it is given.
vi.mock('@/components/Dialog', () => ({
  default: ({ className, title, children }) =>
    createElement('div', { 'data-dialog': title, className }, children),
}));

const { default: TaskWindowFiles } = await import('@/components/task/TaskWindowFiles.jsx');
const { default: MoveTaskDialog } =
  await import('@/app/(app)/projects/[id]/_board/MoveTaskDialog.jsx');

const PROJECT = 'src/app/(app)/projects';
const css = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of `selector`'s rule, at the top level or inside `media` (its condition). */
function rule(text, selector, media) {
  let scope = text;
  if (media) {
    const start = text.indexOf(`@media ${media}`);
    if (start < 0) return null;
    scope = text.slice(text.indexOf('{', start) + 1);
  } else {
    scope = text.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  }
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = scope.match(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`));
  return found ? found[1].replace(/\s+/g, ' ').trim() : null;
}

const PHONE = '(max-width: 640px)';
const NARROW = '(max-width: 751px)';
const WINDOW = css('src/components/task/TaskWindow.module.css');
const RAIL = css('src/components/task/TaskWindowRail.module.css');

describe('the task window', () => {
  it('puts the project line at the top and lowers only a lone title to the X', () => {
    expect(rule(WINDOW, '.headText')).not.toContain('padding-top');
    expect(rule(WINDOW, '.headText > .title:first-child')).toBe('padding-top: 5px;');
  });

  it("keeps the page's line height in its sections, so a thumbnail's size line is 17 px", () => {
    expect(rule(WINDOW, '.section')).toContain('line-height: 1.45;');
    expect(rule(WINDOW, '.section')).not.toContain('line-height: 22px');
    expect(rule(WINDOW, '.section + .section')).toBe(
      'margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line);',
    );
  });

  it('is 720 px wide in two columns: the sections, then the 220 px rail after a line', () => {
    const source = readFileSync('src/components/task/TaskWindow.jsx', 'utf8');
    expect(source).toContain("style={{ '--dialog-w': '720px' }}");
    expect(rule(WINDOW, '.columns')).toBe(
      'display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 0 24px;',
    );
    const rail = rule(RAIL, '.rail');
    expect(rail).toContain('gap: 14px;');
    expect(rail).toContain('border-left: 1px solid var(--line);');
    expect(rule(RAIL, '.rail dt')).toBe('font-size: var(--text-small); color: var(--muted);');
    expect(rule(RAIL, '.rail dd')).toContain('font-size: 15px;');
  });

  it('goes to one column with the facts first, two a line, below a 720 px window', () => {
    expect(rule(WINDOW, '.columns', NARROW)).toBe('grid-template-columns: minmax(0, 1fr);');
    const rail = rule(RAIL, '.rail', NARROW);
    expect(rail).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);');
    expect(rail).toContain('order: -1;');
    expect(rail).toContain('border-left: 0;');
  });

  it('fades out when it closes and skips its entrance when a link opened it, as Dialog does', () => {
    const source = readFileSync('src/components/task/TaskWindow.jsx', 'utf8');
    expect(source).toContain('usePresence(open && isClient, DUR.out)');
    expect(source).toContain('{...windowMarks(presence.closing, Boolean(props.instant))}');
    expect(source).toContain('className={dialogStyles.root}');
    expect(source).toContain('onAnimationEnd={presence.onAnimationEnd}');
    const dialog = css('src/components/Dialog.module.css');
    expect(rule(dialog, '.root[data-closing] .panel')).toContain('animation: pop-out');
    expect(dialog).toContain('.root[data-instant] .panel');
    // A phone's full-screen sheet rises in by the sheet's distance token.
    expect(rule(WINDOW, "[role='dialog'].panel", PHONE)).toContain(
      'animation-name: window-sheet-in;',
    );
    expect(WINDOW).toMatch(
      /@keyframes window-sheet-in \{\s*from \{\s*opacity: 0;\s*transform: translateY\(var\(--shift-sheet\)\);/,
    );
  });

  it('draws Anyone on the project as the dashed circle of the cards', () => {
    const anyone = rule(RAIL, '.anyone');
    expect(anyone).toContain('border: 1.5px dashed var(--line-dashed);');
    expect(anyone).toContain('background: transparent;');
    const card = css(`${PROJECT}/[id]/_board/TaskCard.module.css`);
    expect(rule(card, '.anyone')).toContain('border: 1.5px dashed var(--line-dashed);');
  });

  it('fills a phone with its footer at the bottom edge and 44 px X and Add files', () => {
    const sheet = rule(WINDOW, "[role='dialog'].panel", PHONE);
    expect(sheet).toContain('position: fixed;');
    expect(sheet).toContain('inset: 0;');
    expect(rule(WINDOW, "[role='dialog'].panel > [data-modal-body]", PHONE)).toBe(
      'flex: 1 1 auto;',
    );
    expect(rule(WINDOW, '.panel .close', PHONE)).toBe(
      'width: 44px; height: 44px; margin: -4px -6px 0 auto;',
    );
    expect(rule(WINDOW, '.sectionHead .addFiles', PHONE)).toBe('height: 44px;');
    expect(readFileSync('src/components/task/TaskWindow.jsx', 'utf8')).toContain(
      'className={`${dialogStyles.close} ${styles.close}`}',
    );
  });

  it('gives Add files the class that makes it 44 px on a phone', () => {
    page.attach = { add: () => {}, retry: () => {}, remove: () => {} };
    const task = {
      id: 40,
      title: 'Fix',
      files: [],
      fileCount: 0,
      canSeeFiles: true,
      canManage: true,
    };
    const html = renderToStaticMarkup(
      createElement(TaskWindowFiles, {
        task,
        mode: 'manage',
        headingId: 'files',
        removal: { remove: () => {}, isHidden: () => false },
      }),
    );
    expect(html).toMatch(/<button[^>]*class="[^"]*_addFiles_[^"]*"[^>]*>.*Add files/);
  });
});

/** Every .jsx file under a folder. */
function jsxFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return jsxFiles(full);
    return name.endsWith('.jsx') ? [full] : [];
  });
}

describe("the project page's other windows", () => {
  it('make their X 44 px on a phone, its icon where it was', () => {
    const windows = css(`${PROJECT}/[id]/projectWindows.module.css`);
    expect(rule(windows, ".window > :first-child > button[aria-label='Close']", PHONE)).toBe(
      'width: 44px; height: 44px; margin: -4px -6px 0 auto;',
    );
  });

  it('pass that class: every Dialog on the project page', () => {
    const files = jsxFiles(`${PROJECT}/[id]`).filter((file) =>
      /<Dialog\b/.test(readFileSync(file, 'utf8')),
    );
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const dialogs = source.match(/<Dialog\b/g).length;
      const classed = (source.match(/windowStyles\.window/g) ?? []).length;
      expect({ file, classed }).toEqual({ file, classed: dialogs });
    }
    const html = renderToStaticMarkup(
      createElement(MoveTaskDialog, {
        task: { id: 1, title: 'Fix', phase: 'development' },
        counts: {},
        onMove: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toMatch(/data-dialog="Move Fix" class="_window_[0-9a-f]+(?: [^"]+)?"/);
  });

  it('keep New and Edit task footers at the bottom of their phone sheet', () => {
    const form = css(`${PROJECT}/[id]/_board/TaskFormDialog.module.css`);
    expect(rule(form, "[role='dialog'].panel", PHONE)).toContain('inset: 0;');
    expect(rule(form, '.panel > form > [data-modal-body]', PHONE)).toBe('flex: 1 1 auto;');
  });
});
