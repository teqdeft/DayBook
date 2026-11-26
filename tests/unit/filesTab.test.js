// The Files tab as rendered (CONTRACT 27, Files tab; replaces 1.11's phaseDocuments test): the
// managers' tab (Upload files, New note, the row menus with "Read text for AI"), a member's (Download
// only, no menus), a PM who is a member (the member tab), another PM who isn't (the lock card, with
// nothing about the files loaded) and before migration 019 (the update card); storage not set up
// (the line, Upload aria-disabled); the Upload files window (its choices, always sent, and "Upload
// 3 files"); the Uploads card's rows, "Cancel all" and the reading row; the note window's text; and
// place links that change the place without asking the leave guard. CONTRACT 28: " · On 2 tasks"
// and its menu for managers, linked rows under their tasks in On tasks, a member's shared file only
// in All files and On tasks, and Edit details' line. Client parts render their first state; clicks
// run in the browser (tests/e2e/project-files.spec.js).
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({ value: 'tab=files' }));
const dialogs = vi.hoisted(() => []);
const loads = vi.hoisted(() => ({
  listForProject: vi.fn(),
  storageStatus: vi.fn(),
  listDocumentsFor: vi.fn(),
  filesReady: vi.fn(),
}));
const uploader = vi.hoisted(() => ({ value: null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(query.value),
}));
vi.mock('@/lib/apiClient', () => ({
  api: { get: () => new Promise(() => {}), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/session', () => ({ getSessionUser: async () => ({ id: 7, name: 'Riya Kapoor' }) }));
vi.mock('@/modules/projectFiles', () => ({
  projectFiles: { listForProject: loads.listForProject, storageStatus: loads.storageStatus },
}));
vi.mock('@/modules/projectSummaries', () => ({
  projectSummaries: { listDocumentsFor: loads.listDocumentsFor, filesReady: loads.filesReady },
}));
vi.mock('@/modules/settings', () => ({
  settings: { getAll: async () => ({ timezone: 'Asia/Kolkata' }) },
}));
// The row menus and windows open in the browser; here they render their items and body in place.
vi.mock('@/components/Menu', () => ({
  default: ({ label, items }) =>
    createElement(
      'div',
      { 'data-menu': label },
      items.map((item) => createElement('span', { key: item.label }, item.label)),
    ),
}));
vi.mock('@/components/Dialog', () => ({
  default: (props) => {
    dialogs.push(props);
    if (!props.open) return null;
    return createElement('div', { role: 'dialog' }, [
      createElement('h2', { key: 'title' }, props.title),
      createElement('p', { key: 'description' }, props.description),
      createElement('div', { key: 'body' }, props.children),
      createElement('footer', { key: 'footer' }, props.footer),
    ]);
  },
}));
vi.mock('@/components/files/useUploads', async (importOriginal) => {
  const actual = await importOriginal();
  return { useUploads: (options) => uploader.value?.(options) ?? actual.useUploads(options) };
});

const { default: FilesTab } = await import('@/app/(app)/projects/[id]/FilesTab.jsx');
const { default: FilesView } = await import('@/app/(app)/projects/[id]/_files/FilesView.jsx');
const { default: PlaceList } = await import('@/app/(app)/projects/[id]/_files/PlaceList.jsx');
const { default: UploadDialog, uploadLabel } =
  await import('@/app/(app)/projects/[id]/_files/UploadDialog.jsx');
const { default: UploadsCard } = await import('@/app/(app)/projects/[id]/_files/UploadsCard.jsx');
const { default: NoteView, TextPages } =
  await import('@/app/(app)/projects/[id]/_files/NoteView.jsx');
const { addedToast, textPages } = await import('@/app/(app)/projects/[id]/documentsView.js');
const { useFilesUploads } = await import('@/app/(app)/projects/[id]/_files/useFilesUploads.js');
const { filesItems } = await import('@/app/(app)/projects/[id]/_files/filesTabView.js');
const { leaveAsks } = await import('@/components/files/leaveGuard.js');

const PROJECT = { id: 5, name: 'acme-store', pmName: 'Riya Kapoor' };
const PLAN = { currentPhase: 'development' };
const LIMITS = { maxFileBytes: 500 * 1024 * 1024, maxTaskFiles: 20, pickMax: 50 };
const PM = { id: 7, name: 'Riya Kapoor' };
const TASK = { id: 31, title: 'Fix the login page', phase: 'design', assigneeId: null };

function file(id, more = {}) {
  return {
    id,
    projectId: 5,
    scope: 'project',
    taskId: null,
    phase: 'design',
    visibility: 'everyone',
    name: `file-${id}.pdf`,
    ext: 'pdf',
    kind: 'pdf',
    typeLabel: 'PDF',
    sizeBytes: 348_160,
    isPicture: false,
    thumbUrl: null,
    width: null,
    height: null,
    createdBy: PM,
    createdAt: new Date('2026-11-21T05:00:00Z'),
    task: null,
    hasText: false,
    downloadUrl: `/api/project-files/${id}`,
    viewUrl: null,
    canManage: true,
    ...more,
  };
}

const FILES = [
  file(1, { name: 'brief.pdf' }),
  file(2, {
    name: 'homepage-mockup.png',
    ext: 'png',
    kind: 'picture',
    typeLabel: 'Picture',
    isPicture: true,
    thumbUrl: '/api/project-files/2/thumb',
    viewUrl: '/api/project-files/2/view',
  }),
  file(3, { name: 'deploy-staging.sh', ext: 'sh', kind: 'program', typeLabel: 'Program' }),
  file(4, { name: 'brand-check.pdf', scope: 'task', taskId: 31, phase: null, task: TASK }),
];

const DOCUMENTS = [
  {
    id: 11,
    projectId: 5,
    phase: null,
    kind: 'note',
    title: 'Who to call at Acme Retail',
    pages: null,
    pagesTotal: null,
    visibility: 'managers',
    fileId: null,
    createdBy: 7,
    createdByName: 'Riya Kapoor',
    createdAt: new Date('2026-10-01T05:00:00Z'),
    updatedAt: new Date('2026-10-01T05:00:00Z'),
  },
];

const head = (filesAccess, more = {}) => ({
  project: PROJECT,
  plan: PLAN,
  filesAccess,
  limits: filesAccess === 'manage' ? LIMITS : undefined,
  ...more,
});

async function renderTab(filesAccess, { place, ...more } = {}) {
  const element = await FilesTab({ head: head(filesAccess, more), place });
  return { element, html: renderToStaticMarkup(element) };
}

const text = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');

beforeEach(() => {
  query.value = 'tab=files';
  dialogs.length = 0;
  uploader.value = null;
  loads.filesReady.mockResolvedValue(true);
  loads.storageStatus.mockResolvedValue({ ready: true, problem: null });
  loads.listForProject.mockResolvedValue({ files: FILES, canSee: true, canManage: true });
  loads.listDocumentsFor.mockResolvedValue(DOCUMENTS);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('who gets which tab', () => {
  it('gives managers Upload files, New note and a menu on every row', async () => {
    const { element, html } = await renderTab('manage');
    expect(element.type).toBe(FilesView);
    expect(element.props).toMatchObject({ canManage: true, place: 'all', storageReady: true });
    expect(element.props.limits).toEqual(LIMITS);
    expect(element.props.files[0].addedOn).toBe('2026-11-21');
    const words = text(html);
    expect(words).toContain('Upload files');
    expect(words).toContain('New note');
    expect(html.match(/data-menu="More for /g)).toHaveLength(5);
    expect(words).toContain('Read text for AI');
    expect(words).toContain('PDF · 340 KB · Riya Kapoor, 21 Nov · Design');
    expect(words).toContain('On task: Fix the login page');
    expect(words).toContain('Only PM and Admins');
    expect(words).toContain('Program file. Open it only if you trust where it came from.');
    expect(html).toContain('aria-label="Download brief.pdf"');
    expect(html).toContain('href="/api/project-files/1"');
    expect(html).toContain('src="/api/project-files/2/thumb"');
    expect(words).toContain('All files 5');
    expect(loads.storageStatus).toHaveBeenCalledTimes(1);
  });

  it('gives a member Download only: no Upload, New note or menus', async () => {
    const { element, html } = await renderTab('member');
    expect(element.props).toMatchObject({ canManage: false, limits: undefined });
    const words = text(html);
    expect(words).not.toContain('Upload files');
    expect(words).not.toContain('New note');
    expect(html).not.toContain('data-menu=');
    expect(html).toContain('aria-label="Download brief.pdf"');
    expect(loads.storageStatus).not.toHaveBeenCalled();
    const { viewer, projectId } = loads.listForProject.mock.calls[0][0];
    expect(viewer).toMatchObject({ id: 7 });
    expect(projectId).toBe(5);
    expect(loads.listDocumentsFor).toHaveBeenCalledWith({ viewer, projectId: 5 });
  });

  it('gives a PM who is a member the member tab', async () => {
    const { element } = await renderTab('member', { access: 'team' });
    expect(element.props.canManage).toBe(false);
  });

  it('gives another PM who is not on the project the lock card, with nothing loaded', async () => {
    const { element, html } = await renderTab('none');
    expect(text(html)).toContain(
      'Files are only for Riya Kapoor, Admins and people on the project.',
    );
    expect(JSON.stringify(element.props)).not.toContain('brief.pdf');
    expect(loads.listForProject).not.toHaveBeenCalled();
    expect(loads.listDocumentsFor).not.toHaveBeenCalled();
    expect(html).not.toContain('brief.pdf');
  });

  it('shows only the update card before migration 019', async () => {
    loads.filesReady.mockResolvedValue(false);
    loads.listForProject.mockResolvedValue({ files: [], canSee: true, canManage: true });
    const { html } = await renderTab('manage');
    expect(text(html).trim()).toBe('Files need the latest database update. Ask an Admin.');
  });

  it('says when storage is not set up, and Upload files is aria-disabled', async () => {
    loads.storageStatus.mockResolvedValue({ ready: false, problem: 'not_set' });
    const { html } = await renderTab('manage');
    expect(text(html)).toContain("File storage isn't set up yet. Ask an Admin.");
    expect(html).toMatch(/<button[^>]*id="files-upload"[^>]*aria-disabled="true"/);
    expect(html).toContain('brief.pdf');
  });
});

describe('places', () => {
  it('keeps the place from the URL, falling back to All files', async () => {
    expect((await renderTab('manage', { place: 'design' })).element.props.place).toBe('design');
    expect((await renderTab('manage', { place: 'nowhere' })).element.props.place).toBe('all');
    query.value = 'tab=files&place=tasks';
    const { html } = await renderTab('manage', { place: 'tasks' });
    expect(text(html)).toContain('On tasks');
    expect(html).toMatch(/aria-current="page"[^>]*>.*On tasks/);
  });

  it('marks the current phase, and lists "On tasks in Design" under a phase', async () => {
    query.value = 'tab=files&place=design';
    const { html } = await renderTab('manage', { place: 'design' });
    const words = text(html);
    expect(words).toContain('On tasks in Design (1)');
    expect(words).toContain('Development Current');
  });

  it('changes the place on a plain click only, and a place link never asks the leave guard', () => {
    const chosen = [];
    const list = PlaceList({
      place: 'all',
      counts: {},
      currentPhase: null,
      onPlace: (place) => chosen.push(place),
    });
    const links = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!isValidElement(node)) return;
      if (typeof node.type === 'function' && node.type.name === 'PlaceLink') {
        walk(node.type(node.props));
        return;
      }
      if (node.type === 'a') links.push(node);
      walk(node.props.children);
    };
    walk(list);
    expect(links.map((link) => link.props.href)).toContain('?tab=files&place=design');
    const design = links.find((link) => link.props.href === '?tab=files&place=design');
    const event = (more = {}) => ({ button: 0, preventDefault: vi.fn(), ...more });
    const plain = event();
    design.props.onClick(plain);
    expect(plain.preventDefault).toHaveBeenCalled();
    const newTab = event({ ctrlKey: true });
    design.props.onClick(newTab);
    expect(newTab.preventDefault).not.toHaveBeenCalled();
    expect(chosen).toEqual(['design']);
    const here = 'http://localhost/projects/5?tab=files&place=all';
    const click = { button: 0 };
    expect(
      leaveAsks({ href: 'http://localhost/projects/5?tab=files&place=design' }, click, here),
    ).toBe(false);
    expect(leaveAsks({ href: 'http://localhost/projects/5?tab=board' }, click, here)).toBe(true);
  });
});

describe('the Upload files window', () => {
  const dialogFor = (items) => ({
    uploads: {
      items,
      add: vi.fn(() => ({ ids: [] })),
      remove: vi.fn(),
      retry: vi.fn(),
      notices: [],
      announcement: '',
    },
    ready: items.filter((item) => item.state === 'ready').length,
  });
  const chip = (id, more = {}) => ({
    id,
    name: `${id}.docx`,
    size: 86 * 1024,
    ext: 'docx',
    state: 'ready',
    percent: 0,
    ...more,
  });

  function renderDialog(items, onUpload = vi.fn()) {
    const html = renderToStaticMarkup(
      createElement(UploadDialog, {
        dialog: dialogFor(items),
        place: 'design',
        currentPhase: 'development',
        pmName: 'Riya Kapoor',
        limits: LIMITS,
        onClose: () => {},
        onUpload,
      }),
    );
    return { html, submit: dialogs.at(-1).onSubmit, onUpload };
  }

  it('asks where and who can see it first, Everyone preset, then the files', () => {
    const { html } = renderDialog([chip('a'), chip('b'), chip('c')]);
    const words = text(html);
    expect(words.indexOf('Add to')).toBeLessThan(words.indexOf('Who can see it'));
    expect(words.indexOf('Who can see it')).toBeLessThan(words.indexOf('Choose files'));
    expect(html).toMatch(/<option value="design" selected="">Design<\/option>/);
    expect(words).toContain('Development (current phase)');
    expect(html).toMatch(
      /<input[^>]*(checked=""[^>]*value="everyone"|value="everyone"[^>]*checked="")/,
    );
    expect(html).not.toMatch(/<input[^>]*checked=""[^>]*value="managers"/);
    expect(words).toContain('People on the project can open and download it.');
    expect(words).toContain('Only Riya Kapoor and Admins can open it.');
    expect(words).toContain('Any type of file, each up to 500 MB.');
    expect(words).toContain('Upload 3 files');
  });

  it('always sends the choice, and reads "Upload files" aria-disabled with nothing ready', () => {
    const ready = renderDialog([
      chip('a'),
      chip('b', { state: 'error', message: 'b.docx is empty.' }),
    ]);
    const event = { preventDefault: vi.fn() };
    ready.submit(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(ready.onUpload).toHaveBeenCalledWith({ phase: 'design', visibility: 'everyone' });
    const none = renderDialog([]);
    expect(none.html).toMatch(/aria-disabled="true"[^>]*>(<[^>]+>)*Upload files/);
    none.submit({ preventDefault: () => {} });
    expect(none.onUpload).not.toHaveBeenCalled();
    expect(uploadLabel(1)).toBe('Upload 1 file');
  });

  it('starts the ready files with the window place and who can see it', () => {
    const start = vi.fn(() => 2);
    const remove = vi.fn();
    const items = [
      chip('a'),
      chip('b'),
      chip('c', { state: 'error' }),
      chip('old', { state: 'uploading' }),
    ];
    uploader.value = () => ({
      items,
      add: vi.fn(() => ({ ids: [] })),
      start,
      remove,
      retry: vi.fn(),
      cancelAll: vi.fn(),
      notices: [],
      announcement: '',
    });
    let hook;
    function Probe() {
      hook = useFilesUploads({ projectId: 5, limits: LIMITS, onFinished: () => {} });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(hook.dialog).toBeNull();
    expect(hook.card.active.map((item) => item.id)).toEqual(['old']);
    expect(hook.card.failed.map((item) => item.id)).toEqual(['c']);
    expect(hook.running).toBe(1);
    hook.upload({ phase: null, visibility: 'managers' });
    expect(start).toHaveBeenCalledWith({ phase: null, visibility: 'managers' });
  });
});

describe('the Uploads card', () => {
  const item = (id, state, more = {}) => ({
    id,
    name: `${id}.zip`,
    size: 8 * 1024 * 1024,
    ext: 'zip',
    state,
    percent: 45,
    ...more,
  });

  it('lists each file with its state, Cancel all, the reading row and the failed rows', () => {
    const html = renderToStaticMarkup(
      createElement(UploadsCard, {
        active: [
          item('walkthrough', 'uploading'),
          item('photos', 'retrying'),
          item('checklist', 'waiting'),
          item('prices', 'paused', {
            message: "Couldn't upload prices.zip. Check your connection, then press Retry.",
          }),
        ],
        reading: [
          {
            id: 'read-9',
            name: 'brief.pdf',
            size: 1024,
            ext: 'pdf',
            state: 'reading',
            message: 'Reading brief.pdf for the AI summary… page 12 of 14',
          },
        ],
        failed: [
          item('old-site', 'error', {
            message:
              "Couldn't read old-site.zip. It may have been moved or changed. Choose it again.",
          }),
        ],
        onRemove: () => {},
        onRetry: () => {},
        onCancelAll: () => {},
      }),
    );
    const words = text(html);
    expect(words).toContain('Uploading 4 files');
    expect(words).toContain('Cancel all');
    expect(words).toContain('Uploading… 45%');
    expect(words).toContain('Connection lost. Trying again…');
    expect(words).toContain('Waiting…');
    expect(words).toContain('Retry prices.zip');
    expect(words).toContain('Reading brief.pdf for the AI summary… page 12 of 14');
    expect(words).toContain("1 file couldn't be uploaded");
    expect(html).toContain('aria-label="Cancel uploading walkthrough.zip"');
    expect(html).toContain('aria-label="Uploading walkthrough.zip"');
  });

  it('says it is reading when nothing uploads, and goes when nothing is left', () => {
    const reading = renderToStaticMarkup(
      createElement(UploadsCard, {
        active: [],
        reading: [
          { id: 'read-1', name: 'a.pdf', size: 1, ext: 'pdf', state: 'reading', message: 'x' },
        ],
        failed: [],
      }),
    );
    expect(text(reading)).toContain('Reading 1 file for the AI summary');
    expect(text(reading)).not.toContain('Cancel all');
    const empty = renderToStaticMarkup(
      createElement(UploadsCard, { active: [], reading: [], failed: [] }),
    );
    expect(empty).toBe('');
  });
});

describe('the note window', () => {
  it("splits a file's text into its pages, a note never, and shows it as plain text", () => {
    expect(textPages(' Page one Page two', 'file')).toEqual([
      { number: 1, text: 'Page one' },
      { number: 2, text: 'Page two' },
      { number: 3, text: '' },
    ]);
    expect(textPages('ab', 'note')).toEqual([{ number: 1, text: 'ab' }]);
    const html = renderToStaticMarkup(
      createElement(TextPages, { body: '<b>One</b>Three', kind: 'file' }),
    );
    expect(html).toContain('&lt;b&gt;One&lt;/b&gt;');
    expect(html).toContain('aria-label="Page 2"');
    expect(text(html)).toContain('No text on this page.');
    expect(addedToast({ title: 'big.pdf', notice: 'Read the first 100 of 140 pages.' })).toEqual({
      title: 'big.pdf added.',
      body: 'Read the first 100 of 140 pages.',
    });
  });

  it('names a text-only document and says its file was not kept', () => {
    const [item] = filesItems({
      documents: [
        {
          ...DOCUMENTS[0],
          id: 12,
          kind: 'file',
          title: 'Acme-store-SOW-v2.pdf',
          pages: 4,
          pagesTotal: 4,
          addedOn: '2026-09-29',
          phase: 'requirement_gathering',
        },
      ],
    });
    const html = renderToStaticMarkup(
      createElement(NoteView, {
        item,
        canManage: true,
        onClose: () => {},
        onEdit: () => {},
        onDelete: () => {},
      }),
    );
    const words = text(html);
    expect(words).toContain('Acme-store-SOW-v2.pdf');
    expect(words).toContain(
      'Text only · 4 pages · 29 Sep · Requirement gathering · Only PM and Admins',
    );
    expect(words).toContain("The original file wasn't kept. Only its text was saved.");
    expect(words).toContain('Delete');
    expect(words).not.toContain('Edit');
  });

  it("shows a project file's text for managers without Edit or Delete", () => {
    const [item] = filesItems({
      files: [file(1, { name: 'brief.pdf', hasText: true })],
      documents: [{ ...DOCUMENTS[0], id: 13, kind: 'file', fileId: 1, pages: 14, phase: 'design' }],
    });
    const html = renderToStaticMarkup(
      createElement(NoteView, {
        item,
        canManage: true,
        onClose: () => {},
        onEdit: () => {},
        onDelete: () => {},
      }),
    );
    const words = text(html);
    expect(words).toContain('Text for the AI summary · 14 pages · Design · Only PM and Admins');
    expect(words).not.toContain('Delete');
    expect(words).toContain('Loading the text…');
  });
});

// ---------- CONTRACT 28: files from the project on tasks ----------

const { default: FileEditDialog } =
  await import('@/app/(app)/projects/[id]/_files/FileEditDialog.jsx');

const CHECKOUT = { id: 32, title: 'Checkout fix before client demo', phase: 'development' };
const linkRow = (fileId, onTask) => ({
  fileId,
  taskId: onTask.id,
  taskTitle: onTask.title,
  taskPhase: onTask.phase,
  taskAssigneeId: null,
});

describe('links on the Files tab (CONTRACT 28)', () => {
  const linkedTasks = [
    {
      id: 31,
      title: TASK.title,
      assigneeId: 21,
      assigneeName: 'Vishal Saini',
      assigneeManages: false,
    },
    { id: 32, title: CHECKOUT.title, assigneeId: null, assigneeName: null, assigneeManages: false },
  ];
  const managers = () => ({
    files: [{ ...FILES[0], linkCount: 2, linkedTasks, sharedByLink: false }, ...FILES.slice(1)],
    links: [linkRow(1, TASK), linkRow(1, CHECKOUT)],
    canSee: true,
    canManage: true,
  });

  it('gives managers " · On 2 tasks", a menu of those tasks, and passes the links on', async () => {
    loads.listForProject.mockResolvedValue(managers());
    const { element, html } = await renderTab('manage');
    expect(element.props.links).toEqual(managers().links);
    expect(html).toContain('data-menu="Tasks with this file"');
    const menu = html.slice(html.indexOf('data-menu="Tasks with this file"'));
    expect(text(menu)).toMatch(/^[^<]*Fix the login page Checkout fix before client demo/);
    expect(text(html)).toContain('All files 5'); // each file once
  });

  it('lists linked rows under their tasks in On tasks, with the Link icon and their menu', async () => {
    loads.listForProject.mockResolvedValue(managers());
    query.value = 'tab=files&place=tasks';
    const { html } = await renderTab('manage', { place: 'tasks' });
    const words = text(html);
    expect(words).toContain('PDF · 340 KB · From Design');
    expect(html).toContain('lucide-link');
    expect(html).toContain('data-menu="More for brief.pdf on Fix the login page"');
    expect(html).toContain('data-menu="More for brief.pdf on Checkout fix before client demo"');
    expect(words).toContain('Remove from this task');
    expect(words).toContain('On tasks 2'); // brand-check.pdf and brief.pdf, each once
    const login = words.indexOf('Fix the login page Design');
    expect(words.indexOf('brand-check.pdf', login)).toBeLessThan(words.indexOf('brief.pdf', login));
  });

  it("shows a member's shared file in All files and On tasks only, without the lock", async () => {
    const contract = file(9, {
      name: 'contract.pdf',
      phase: null,
      visibility: 'managers',
      linkCount: 1,
      linkedTasks: [{ id: 31, title: TASK.title }],
      sharedByLink: true,
      canManage: false,
    });
    loads.listForProject.mockResolvedValue({
      files: [FILES[0], contract],
      links: [linkRow(9, TASK)],
      canSee: true,
      canManage: false,
    });
    loads.listDocumentsFor.mockResolvedValue([]); // a member gets no managers' note
    const all = text((await renderTab('member')).html);
    expect(all).toContain('· Shared with you on Fix the login page');
    expect(all).not.toContain('Only PM and Admins');
    expect(all).not.toMatch(/On \d tasks?/);
    query.value = 'tab=files&place=project';
    const place = text((await renderTab('member', { place: 'project' })).html);
    expect(place).not.toContain('contract.pdf');
    query.value = 'tab=files&place=tasks';
    const onTasks = text((await renderTab('member', { place: 'tasks' })).html);
    expect(onTasks).toContain('contract.pdf');
    expect(onTasks).toContain('PDF · 340 KB · From Files');
  });

  it("writes Edit details' line while Only PM and Admins is chosen, none for Everyone", () => {
    const item = (visibility) =>
      filesItems({
        files: [{ ...FILES[0], visibility, linkCount: 2, linkedTasks: linkedTasks.slice(0, 1) }],
      })[0];
    const render = (visibility) =>
      text(
        renderToStaticMarkup(
          createElement(FileEditDialog, {
            item: item(visibility),
            currentPhase: 'development',
            pmName: 'Riya Kapoor',
            onClose: () => {},
          }),
        ),
      );
    expect(render('managers')).toContain('Vishal Saini can still open it from Fix the login page.');
    expect(render('everyone')).not.toContain('can still open it');
  });
});
