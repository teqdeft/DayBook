// The Files windows and pieces as the final prototype draws them (CONTRACT 27, Files tab, Picture
// viewer, Task window), and Retry where a row says "press Retry":
// - the Uploads card's failed row of a file stopped by a 401 ("Sign in again, then press Retry.")
//   has its Retry button, and its batch waits for that Retry (the toast and the refresh);
// - Upload files, New note, Edit details and the note window are full-screen sheets on a phone with
//   the main button first at full width, the others under it and Delete last;
// - the note window's meta line is a 13 px muted line, not body text;
// - the picture viewer on a phone keeps Previous and Next under the picture (not on top of it,
//   where a light picture hides them) and its top bar keeps only icons, named by aria-label; the
//   size has no tabular figures;
// - a thumbnail's X stays a 28 px box on a phone (the ::before gives the 44 px target).
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const dialogs = vi.hoisted(() => []);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams('tab=files'),
}));
vi.mock('@/lib/apiClient', () => ({
  api: { get: () => new Promise(() => {}), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
// The windows open in the browser; here they render their parts in place.
vi.mock('@/components/Dialog', () => ({
  default: (props) => {
    dialogs.push(props);
    if (!props.open) return null;
    return createElement('div', { role: 'dialog', className: props.className }, [
      createElement('h2', { key: 'title' }, props.title),
      createElement('p', { key: 'description' }, props.description),
      createElement('div', { key: 'body' }, props.children),
      createElement('footer', { key: 'footer' }, props.footer),
    ]);
  },
}));
// The picture viewer draws in a portal once in the browser; here it draws in place.
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  createPortal: (node) => node,
}));
vi.mock('@/components/useModal', () => ({ useIsClient: () => true, useModal: () => {} }));

const { default: UploadsCard } = await import('@/app/(app)/projects/[id]/_files/UploadsCard.jsx');
const { default: UploadDialog } = await import('@/app/(app)/projects/[id]/_files/UploadDialog.jsx');
const { default: NoteDialog } = await import('@/app/(app)/projects/[id]/_files/NoteDialog.jsx');
const { default: FileEditDialog } =
  await import('@/app/(app)/projects/[id]/_files/FileEditDialog.jsx');
const { default: NoteView } = await import('@/app/(app)/projects/[id]/_files/NoteView.jsx');
const { filesItems } = await import('@/app/(app)/projects/[id]/_files/filesTabView.js');
const { default: PictureViewer } = await import('@/components/files/PictureViewer.jsx');
const { answerOf, failureOf } = await import('@/components/files/uploadHttp.js');
const { itemAfter } = await import('@/components/files/uploadItems.js');
const { batchSettled } = await import('@/app/(app)/projects/[id]/_files/useFilesUploads.js');

const LIMITS = { maxFileBytes: 500 * 1024 * 1024, maxTaskFiles: 20, pickMax: 50 };

/** A CSS file without its comments. */
const css = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of `selector`'s rule inside the `(max-width: 640px)` block, one line. */
function phoneRule(text, selector) {
  const start = text.indexOf('@media (max-width: 640px)');
  expect(start).toBeGreaterThan(-1);
  const block = text.slice(text.indexOf('{', start) + 1);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = block.match(new RegExp(`(?:^|[}\\s,])${escaped}\\s*\\{([^}]*)\\}`));
  return found ? found[1].replace(/\s+/g, ' ').trim() : null;
}

/** The class names of the last button whose text is `words` (the footer's), from static markup. */
function classesOf(html, words) {
  const at = html.lastIndexOf(`>${words}<`);
  expect(at).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<button', at);
  return html.slice(open, at).match(/class="([^"]*)"/)[1];
}

const text = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

describe('the Uploads card', () => {
  it('keeps Retry on a failed row stopped by a 401, as its message says', () => {
    const body = { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } };
    const answer = answerOf(401, () => null, JSON.stringify(body));
    const before = {
      id: 'up-1',
      name: 'signed-out.bin',
      size: 3 * 1024 * 1024,
      ext: 'bin',
      state: 'uploading',
      percent: 40,
    };
    const item = itemAfter(before, { phase: 'error', percent: 40, failure: failureOf(answer) });
    expect(item).toMatchObject({ state: 'error', canRetry: true });
    const html = renderToStaticMarkup(
      createElement(UploadsCard, {
        active: [],
        reading: [],
        failed: [item],
        onRemove: () => {},
        onRetry: () => {},
        onCancelAll: () => {},
      }),
    );
    expect(text(html)).toContain('You were signed out. Sign in again, then press Retry.');
    expect(html).toContain('data-chip-retry="up-1"');
    expect(text(html)).toContain('Retry signed-out.bin');
    expect(html).toContain('aria-label="Remove signed-out.bin"');
  });

  it('gives no Retry to a failed row that cannot try again', () => {
    const html = renderToStaticMarkup(
      createElement(UploadsCard, {
        active: [],
        reading: [],
        failed: [
          {
            id: 'up-2',
            name: 'old-site.zip',
            size: 1024,
            ext: 'zip',
            state: 'error',
            canRetry: false,
            message:
              "Couldn't read old-site.zip. It may have been moved or changed. Choose it again.",
          },
        ],
        onRemove: () => {},
        onRetry: () => {},
        onCancelAll: () => {},
      }),
    );
    expect(html).not.toContain('data-chip-retry');
  });

  it('waits for the Retry of a file stopped by a 401 before the batch ends (its toast)', () => {
    const items = (...list) => new Map(list.map((item) => [item.id, item]));
    const done = { id: 'a', state: 'done' };
    const signedOut = { id: 'b', state: 'error', canRetry: true };
    const bad = { id: 'b', state: 'error', canRetry: false };
    expect(batchSettled(['a', 'b'], items(done, signedOut))).toBe(false);
    expect(batchSettled(['a', 'b'], items(done, { id: 'b', state: 'paused' }))).toBe(false);
    expect(batchSettled(['a', 'b'], items(done, bad))).toBe(true);
    expect(batchSettled(['a', 'b'], items(done))).toBe(true); // removed
    expect(batchSettled(['a', 'b'], items(done, { id: 'b', state: 'done' }))).toBe(true);
  });
});

describe('the Files windows on a phone', () => {
  const sheet = css('src/app/(app)/projects/[id]/_files/FileDialogs.module.css');
  const PM = { id: 7, name: 'Riya Kapoor' };
  const [fileItem] = filesItems({
    files: [
      {
        id: 1,
        projectId: 5,
        scope: 'project',
        taskId: null,
        phase: 'design',
        visibility: 'everyone',
        name: 'brief.pdf',
        ext: 'pdf',
        kind: 'pdf',
        typeLabel: 'PDF',
        sizeBytes: 348_160,
        isPicture: false,
        createdBy: PM,
        createdAt: new Date('2026-11-21T05:00:00Z'),
        task: null,
        hasText: false,
        downloadUrl: '/api/project-files/1',
        viewUrl: null,
        canManage: true,
        addedOn: '2026-11-21',
      },
    ],
  });
  const [noteItem] = filesItems({
    documents: [
      {
        id: 11,
        projectId: 5,
        phase: 'development',
        kind: 'note',
        title: 'Weekly call with Acme Retail',
        pages: null,
        pagesTotal: null,
        visibility: 'managers',
        fileId: null,
        createdBy: 7,
        createdByName: 'Riya Kapoor',
        createdAt: new Date('2026-11-19T05:00:00Z'),
        updatedAt: new Date('2026-11-19T05:00:00Z'),
        addedOn: '2026-11-19',
      },
    ],
  });

  const windows = {
    'Upload files': () =>
      createElement(UploadDialog, {
        dialog: {
          uploads: { items: [], add: vi.fn(), remove: vi.fn(), retry: vi.fn(), notices: [] },
          ready: 0,
        },
        place: 'design',
        currentPhase: 'development',
        pmName: 'Riya Kapoor',
        limits: LIMITS,
        onClose: () => {},
        onUpload: () => {},
      }),
    'New note': () =>
      createElement(NoteDialog, {
        open: true,
        projectId: 5,
        place: 'design',
        currentPhase: 'development',
        pmName: 'Riya Kapoor',
        onClose: () => {},
        onSaved: () => {},
        onDelete: () => {},
      }),
    'Edit details': () =>
      createElement(FileEditDialog, {
        item: fileItem,
        currentPhase: 'development',
        pmName: 'Riya Kapoor',
        onClose: () => {},
      }),
  };

  it.each([
    ['Upload files', 'Upload files'],
    ['New note', 'Add note'],
    ['Edit details', 'Save changes'],
  ])('draws %s as the sheet with its main button first', (title, main) => {
    dialogs.length = 0;
    const html = renderToStaticMarkup(windows[title]());
    const [props] = dialogs;
    expect(props.title).toBe(title);
    expect(props.className).toMatch(/_panel_/);
    expect(classesOf(html, main)).toMatch(/_main_/);
    expect(classesOf(html, 'Cancel')).toMatch(/_second_/);
  });

  it('draws the note window as the sheet with its meta as a small line', () => {
    dialogs.length = 0;
    const html = renderToStaticMarkup(
      createElement(NoteView, {
        item: noteItem,
        canManage: true,
        onClose: () => {},
        onEdit: () => {},
        onDelete: () => {},
      }),
    );
    expect(dialogs[0].className).toMatch(/_panel_/);
    expect(html).toMatch(
      /<span class="_meta_[^"]*">Note · Riya Kapoor, 19 Nov · Development · Only PM and Admins<\/span>/,
    );
    expect(classesOf(html, 'Close')).toMatch(/_second_/);
    expect(html).toMatch(/class="[^"]*_left_[^"]*"[^>]*>.*Delete/);
    expect(sheet).toMatch(
      /\.meta \{\s*display: block;\s*font-size: var\(--text-small\);\s*line-height: 18px;\s*\}/,
    );
  });

  it('fills the screen at 640 px and below, main button first and Delete last', () => {
    expect(phoneRule(sheet, "[role='dialog'].panel")).toBe(
      'position: fixed; inset: 0; width: auto; height: auto; max-height: none; border: 0; border-radius: 0;',
    );
    expect(phoneRule(sheet, '.panel [data-modal-body]')).toBe('flex: 1 1 auto;');
    expect(phoneRule(sheet, 'button.main')).toBe('order: -1; flex: 1 1 100%;');
    expect(phoneRule(sheet, 'button.second')).toBe('flex: 1 1 0;');
    expect(phoneRule(sheet, 'button.left')).toBe('order: 2; flex: 1 1 0; margin-right: 0;');
  });
});

describe('the picture viewer on a phone', () => {
  const viewer = css('src/components/files/PictureViewer.module.css');
  const pictures = ['card-payment-error.png', 'checkout-photo.jpg'].map((name, i) => ({
    id: 20 + i,
    name,
    sizeBytes: 5.4 * 1024 * 1024,
    isPicture: true,
    viewUrl: `/api/project-files/${20 + i}/view`,
    downloadUrl: `/api/project-files/${20 + i}`,
  }));

  it('puts Previous and Next under the picture and keeps only the icons up top', () => {
    expect(phoneRule(viewer, '.viewerMiddle')).toBe('padding: 8px 0 72px;');
    expect(phoneRule(viewer, '.viewerMiddle img')).toBe('max-width: 100%; border-radius: 0;');
    expect(phoneRule(viewer, '.viewerNav')).toBe('top: auto; bottom: 16px; margin: 0;');
    expect(phoneRule(viewer, '.viewerPrev')).toBe('left: 16px;');
    expect(phoneRule(viewer, '.viewerNext')).toBe('right: 16px;');
    expect(phoneRule(viewer, '.viewerWord')).toBe('display: none;');
  });

  it('names Download and Close without their words, and sets the size without tabular figures', () => {
    vi.stubGlobal('document', { body: {} }); // the portal's target (drawn in place here)
    let html;
    try {
      html = renderToStaticMarkup(
        createElement(PictureViewer, {
          files: pictures,
          index: 0,
          onIndex: () => {},
          onClose: () => {},
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(html).toContain('aria-label="Download card-payment-error.png"');
    expect(html).toMatch(/<button[^>]*aria-label="Close"[^>]*>/);
    expect(html).toMatch(/<span class="_viewerWord_[^"]*">Close<\/span>/);
    expect(html).toMatch(/<span class="_viewerWord_[^"]*">Download<\/span>/);
    expect(html).toMatch(/<span class="_viewerSize_[^"]*">5.4 MB<\/span> · 1 of 2/);
    expect(html).not.toContain('class="num"');
    expect(viewer).toMatch(/\.viewerSize \{\s*font-family: var\(--font-heading-stack\);\s*\}/);
  });
});

describe("a thumbnail's X on a phone", () => {
  it('stays a 28 px box over the picture after the 44 px icon buttons', () => {
    const files = css('src/components/files/Files.module.css');
    expect(phoneRule(files, '.iconButton')).toBe('width: 44px; height: 44px;');
    expect(phoneRule(files, '.thumbX')).toBe(
      'width: 28px; height: 28px; min-width: 0; min-height: 0;',
    );
    const block = files.slice(files.indexOf('@media (max-width: 640px)'));
    expect(block.indexOf('.thumbX')).toBeGreaterThan(block.indexOf('.iconButton {'));
    expect(files).toMatch(
      /\.thumbX::before \{\s*content: '';\s*position: absolute;\s*inset: -8px;/,
    );
  });
});
