// The Files tab from the keyboard and with a screen reader (CONTRACT 27, Files tab; Look, phone and
// accessibility): a Delete chosen in a row's "⋯" with Enter or Space (the click's detail 0) gives
// the Undo toast the focus, a click moves it to the next row; after Edit details has saved, focus
// goes to the row's "⋯" while the row is still shown, else to the next row's name (the file moved
// out of the place shown), else to Upload files; Save stays focusable while it saves
// (aria-disabled, never disabled); and a name cut in the middle is read whole ("two-pages.pdf"),
// not as two words. Focus itself moving runs in the browser (tests/e2e/project-files.spec.js).
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const menus = vi.hoisted(() => new Map());
const undo = vi.hoisted(() => ({ remove: null }));
const pending = vi.hoisted(() => ({ value: false }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal();
  // Edit details while it saves: its transition reads pending.
  const useTransition = () => (pending.value ? [true, (run) => run()] : actual.useTransition());
  return { ...actual, useTransition };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams('tab=files&place=all'),
}));
vi.mock('@/lib/apiClient', () => ({
  api: { get: () => new Promise(() => {}), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
// The row menus open in the browser; here each keeps its items, found by the menu's name.
vi.mock('@/components/Menu', () => ({
  default: ({ label, items }) => {
    menus.set(label, items);
    return null;
  },
}));
vi.mock('@/app/(app)/projects/[id]/useUndoDelete', () => ({
  useUndoDelete: () => ({ remove: undo.remove, isHidden: () => false, toast: null }),
}));
vi.mock('@/components/Dialog', () => ({
  default: (props) =>
    props.open
      ? createElement('div', { role: 'dialog' }, [
          createElement('div', { key: 'body' }, props.children),
          createElement('footer', { key: 'footer' }, props.footer),
        ])
      : null,
}));

const { default: FilesView } = await import('@/app/(app)/projects/[id]/_files/FilesView.jsx');
const { default: FileEditDialog } =
  await import('@/app/(app)/projects/[id]/_files/FileEditDialog.jsx');
const { focusAfterEdit } = await import('@/app/(app)/projects/[id]/_files/useFilesTab.js');
const { filesItems } = await import('@/app/(app)/projects/[id]/_files/filesTabView.js');
const { default: FileName } = await import('@/components/files/FileName.jsx');

const LIMITS = { maxFileBytes: 500 * 1024 * 1024, maxTaskFiles: 20, pickMax: 50 };
const PM = { id: 7, name: 'Riya Kapoor' };

function file(id, name) {
  return {
    id,
    projectId: 5,
    scope: 'project',
    taskId: null,
    phase: 'design',
    visibility: 'everyone',
    name,
    ext: name.split('.').pop(),
    kind: 'pdf',
    typeLabel: 'PDF',
    sizeBytes: 1024,
    isPicture: false,
    thumbUrl: null,
    createdBy: PM,
    createdAt: new Date('2026-11-21T05:00:00Z'),
    addedOn: '2026-11-21',
    task: null,
    hasText: false,
    downloadUrl: `/api/project-files/${id}`,
    viewUrl: null,
    canManage: true,
  };
}

const FILES = [file(1, 'brief.pdf'), file(2, 'notes.txt')];

function renderTab() {
  renderToStaticMarkup(
    createElement(FilesView, {
      projectId: 5,
      canManage: true,
      place: 'all',
      currentPhase: 'development',
      pmName: PM.name,
      files: FILES,
      documents: [],
      limits: LIMITS,
      storageReady: true,
    }),
  );
}

/** Chooses Delete in a row's "⋯" with this click. */
function deleteFromMenu(name, click) {
  menus
    .get(`More for ${name}`)
    .find((item) => item.label === 'Delete')
    .onSelect(click);
}

beforeEach(() => {
  menus.clear();
  undo.remove = vi.fn();
  pending.value = false;
  vi.stubGlobal('requestAnimationFrame', () => 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a row's Delete", () => {
  it('gives the Undo toast the focus when Enter or Space chose it', () => {
    renderTab();
    deleteFromMenu('brief.pdf', { detail: 0 });
    expect(undo.remove).toHaveBeenCalledTimes(1);
    const [entry] = undo.remove.mock.calls[0];
    expect(entry).toMatchObject({ key: 'file:1', label: 'File deleted.', keyboard: true });
  });

  it('keeps the focus in the list when it was clicked', () => {
    renderTab();
    deleteFromMenu('brief.pdf', { detail: 1 });
    expect(undo.remove.mock.calls[0][0]).toMatchObject({ key: 'file:1', keyboard: false });
  });
});

/** A page of elements by id, each row name inside its <li> with the row's "⋯". */
function fakePage(ids) {
  const elements = new Map();
  for (const id of ids) {
    const menu = { name: `More for ${id}` };
    const li = { querySelector: (selector) => (selector.includes('menu') ? menu : null) };
    elements.set(id, { id, closest: (selector) => (selector === 'li' ? li : null), menu });
  }
  vi.stubGlobal('document', { getElementById: (id) => elements.get(id) ?? null });
  return elements;
}

describe('focus after Edit details saved', () => {
  const [brief] = filesItems({ files: FILES, documents: [] }).filter((item) => item.id === 1);

  it("goes back to the row's ⋯ while the row is still shown", () => {
    const page = fakePage(['files-row-file-1', 'files-row-file-2', 'files-upload']);
    expect(focusAfterEdit(brief, 'files-row-file-2')()).toBe(page.get('files-row-file-1').menu);
  });

  it("goes to the next row's name when the file left the place shown", () => {
    const page = fakePage(['files-row-file-2', 'files-upload']);
    expect(focusAfterEdit(brief, 'files-row-file-2')()).toBe(page.get('files-row-file-2'));
  });

  it('goes to Upload files when no row is left', () => {
    const page = fakePage(['files-upload', 'files-search']);
    expect(focusAfterEdit(brief, null)()).toBe(page.get('files-upload'));
  });
});

describe("Edit details' Save", () => {
  const [brief] = filesItems({ files: FILES, documents: [] }).filter((item) => item.id === 1);
  const render = () =>
    renderToStaticMarkup(
      createElement(FileEditDialog, {
        item: brief,
        currentPhase: 'development',
        pmName: PM.name,
        onClose: () => {},
        onSaved: () => {},
      }),
    );
  const saveButton = (html) =>
    html.slice(html.lastIndexOf('<button'), html.lastIndexOf('</button>'));

  it('stays focusable while it saves: aria-disabled and busy, never disabled', () => {
    pending.value = true;
    const save = saveButton(render());
    expect(save).toContain('Save changes');
    expect(save).toContain('type="submit"');
    expect(save).toContain('aria-disabled="true"');
    expect(save).toContain('aria-busy="true"');
    expect(save).not.toMatch(/\sdisabled=""/);
  });

  it('is a plain Save button otherwise', () => {
    const save = saveButton(render());
    expect(save).not.toContain('aria-disabled');
    expect(save).not.toMatch(/\sdisabled=""/);
  });
});

describe('a file name cut in the middle', () => {
  /** The whole name for screen readers: visually hidden and never selected. */
  const whole = (name) =>
    new RegExp(`<span class="visually-hidden _nameWhole_[^"]*">${name}</span>`);

  it('is read whole by screen readers: the two shown parts are hidden from them', () => {
    const html = renderToStaticMarkup(createElement(FileName, { name: 'two-pages.pdf' }));
    expect(html).toMatch(/<span class="[^"]*nameHead[^"]*" aria-hidden="true">two-<\/span>/);
    expect(html).toMatch(/<span class="[^"]*nameTail[^"]*" aria-hidden="true">pages.pdf<\/span>/);
    expect(html).toMatch(whole('two-pages.pdf'));
  });

  it('keeps a short name whole too, and an empty one empty', () => {
    expect(renderToStaticMarkup(createElement(FileName, { name: 'logo.png' }))).toMatch(
      whole('logo.png'),
    );
    expect(renderToStaticMarkup(createElement(FileName, { name: null }))).toMatch(whole(''));
  });

  it('is never copied twice: the hidden whole name is not selectable', () => {
    const sheet = readFileSync('src/components/files/Files.module.css', 'utf8');
    expect(sheet).toMatch(/\.nameWhole \{\s*user-select: none;\s*\}/);
  });
});
