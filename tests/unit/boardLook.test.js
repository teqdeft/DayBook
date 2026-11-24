// The Board's screens match the final prototype (CONTRACT 27, Screens; Look, phone and
// accessibility; docs/design/project-board-prototype.html), where review found them off: the task
// window's header (no 5 px drop under the project line), its thumbnails' size line (the page's
// 1.45 line height), the centred error text, the dashed "Anyone" circle, and on a phone a sheet
// that fills the screen with its footer at the bottom edge and a 44 px X and "Add files"; every
// other project page window's X 44 px on a phone (Dialog stays as it is, so each passes
// `projectWindows.module.css`'s `.window`); New and Edit task's footer at the bottom of their
// sheet; Critical tasks with the Card's own padding (16 px on a phone); and the My projects mini
// band 12 px under the head with 3 px gaps. Browser checks: the review's measurements in a copy.
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
const { default: CriticalTasksCard } =
  await import('@/app/(app)/projects/[id]/CriticalTasksCard.jsx');

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
const WINDOW = css('src/components/task/TaskWindow.module.css');

describe('the task window', () => {
  it('puts the project line at the top and lowers only a lone title to the X', () => {
    expect(rule(WINDOW, '.headText')).not.toContain('padding-top');
    expect(rule(WINDOW, '.headText > .title:first-child')).toBe('padding-top: 5px;');
  });

  it("keeps the page's line height in its sections, so a thumbnail's size line is 17 px", () => {
    expect(rule(WINDOW, '.section')).toContain('line-height: 1.45;');
    expect(rule(WINDOW, '.section')).not.toContain('line-height: 22px');
  });

  it('centres "This task isn\'t available." in a 360 px block', () => {
    const problem = rule(WINDOW, '.problem');
    expect(problem).toContain('max-width: 360px;');
    expect(problem).toContain('margin: 0 auto;');
    expect(problem).toContain('text-align: center;');
  });

  it('draws Anyone on the project as the dashed circle of the cards', () => {
    const anyone = rule(WINDOW, '.anyone');
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
    expect(html).toMatch(/data-dialog="Move Fix" class="_window_[0-9a-f]+"/);
  });

  it('keep New and Edit task footers at the bottom of their phone sheet', () => {
    const form = css(`${PROJECT}/[id]/_board/TaskFormDialog.module.css`);
    expect(rule(form, "[role='dialog'].panel", PHONE)).toContain('inset: 0;');
    expect(rule(form, '.panel > form > [data-modal-body]', PHONE)).toBe('flex: 1 1 auto;');
  });
});

describe('Critical tasks on the Summary tab', () => {
  it("has the Card's 20 x 24 px padding, 16 px on a phone", () => {
    const html = renderToStaticMarkup(
      createElement(CriticalTasksCard, {
        projectId: 5,
        tasks: [],
        today: '2026-11-23',
        canManage: false,
      }),
    );
    expect(html).toMatch(/<section class="[^"]*_padDefault_/);
    expect(html).not.toContain('_padCompact_');
    const overview = css(`${PROJECT}/[id]/Overview.module.css`);
    expect(rule(overview, '.columnCard', PHONE)).toBe('--card-pad: 16px;');
  });
});

describe('the My projects card', () => {
  it('puts the mini band 12 px under the head with 3 px between its parts', () => {
    const band = rule(css(`${PROJECT}/ProjectCard.module.css`), '.band');
    expect(band).toContain('gap: 3px;');
    expect(band).toContain('margin-top: 12px;');
  });
});
