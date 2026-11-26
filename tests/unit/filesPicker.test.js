// The "From project files" picker (CONTRACT 28, "From project files" picker and the share confirm):
// its places and counts, the place it opens on, the search, each row's lines ("PDF · 2.4 MB ·
// Whole project", the lock line, "Already on this task", "On 1 task"), the footer's words, when the
// share confirm shows (a person who isn't a manager, anyone) and when it doesn't (the viewer, the
// PM, an Admin), the empty, no-match, loading, error and before-020 states, and the window drawn
// on the server with its data mocked (Dialog shows its title, children and footer).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => ({ now: null }));

vi.mock('@/components/Dialog', () => ({
  default: ({ title, description, children, footer, open }) =>
    open
      ? createElement(
          'div',
          { 'data-dialog': title },
          createElement('p', null, description),
          children,
          createElement('footer', null, footer),
        )
      : null,
}));
vi.mock('@/components/files/usePickerFiles', async (importOriginal) => ({
  ...(await importOriginal()),
  usePickerFiles: () => data.now,
}));

const view = await import('@/components/files/filesPickerView.js');
const { pickerPath, pickerState } = await vi.importActual('@/components/files/usePickerFiles.js');
const { default: FilesPicker } = await import('@/components/files/FilesPicker.jsx');

const MB = 1024 * 1024;
const pickerFile = (id, name, extra = {}) => ({
  id,
  name,
  ext: name.split('.').pop(),
  typeLabel: 'PDF',
  sizeBytes: 2.4 * MB,
  phase: null,
  visibility: 'everyone',
  isPicture: false,
  thumbUrl: null,
  onThisTask: false,
  linkCount: 0,
  ...extra,
});
const GUIDE = pickerFile(1, 'acme-brand-guide.pdf', { linkCount: 1 });
const CONTRACT = pickerFile(2, 'acme-store-contract-signed.pdf', {
  sizeBytes: 860 * 1024,
  visibility: 'managers',
  linkCount: 1,
});
const DESIGN = pickerFile(3, 'homepage-design-v3.png', {
  typeLabel: 'Picture',
  sizeBytes: 1.8 * MB,
  phase: 'design',
  isPicture: true,
  thumbUrl: '/api/project-files/3/thumb',
});
const FLOW = pickerFile(4, 'checkout-flow.docx', {
  typeLabel: 'Word',
  sizeBytes: 340 * 1024,
  phase: 'design',
  onThisTask: true,
  linkCount: 2,
});
const FILES = [GUIDE, CONTRACT, DESIGN, FLOW];
const PROJECT = { id: 5, pmId: 7 };

const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
const ready = (files = FILES, extra = {}) => ({
  state: 'ready',
  files,
  places: [],
  taskPhase: null,
  reload: () => {},
  ...extra,
});
const render = (props = {}) =>
  renderToStaticMarkup(
    createElement(FilesPicker, {
      projectId: 5,
      taskId: 8,
      assignee: { id: 12, name: 'Vishal Saini', role: 'employee', status: 'active' },
      project: PROJECT,
      open: true,
      onAttach: () => {},
      onClose: () => {},
      ...props,
    }),
  );

beforeEach(() => {
  data.now = ready();
});

describe('places', () => {
  it('lists All files, Whole project and the six phases with their counts', () => {
    const places = view.placesOf(null, FILES);
    expect(places.map((place) => `${place.label} ${place.count}`)).toEqual([
      'All files 4',
      'Whole project 2',
      'Requirement gathering 0',
      'Design 2',
      'Development 0',
      'Testing 0',
      'Launch 0',
      'Support 0',
    ]);
    const sent = [{ key: 'all', label: 'All files', count: 6 }];
    expect(view.placesOf(sent, FILES)[0].count).toBe(6);
    expect(view.showOption(places[0])).toBe('All files (4)');
  });

  it("opens on the task's phase when it has files, else on All files", () => {
    const places = view.placesOf(null, FILES);
    expect(view.presetPlace(places, 'design')).toBe('design');
    expect(view.presetPlace(places, 'testing')).toBe('all');
    expect(view.presetPlace(places, null)).toBe('all');
  });

  it("shows a place's files whose name holds the search, any case", () => {
    expect(view.shownFiles(FILES, { place: 'project' }).map((f) => f.id)).toEqual([1, 2]);
    expect(view.shownFiles(FILES, { place: 'design', query: ' CHECKOUT ' })).toEqual([FLOW]);
    expect(view.shownFiles(FILES, { place: 'all', query: 'acme' })).toEqual([GUIDE, CONTRACT]);
  });
});

describe('rows and words', () => {
  it('says the type, size and place, the lock line, and the tasks it is on', () => {
    expect(view.pickerRow(GUIDE)).toEqual({
      meta: 'PDF · 2.4 MB · Whole project',
      locked: false,
      note: 'On 1 task',
      disabled: false,
    });
    expect(view.pickerRow(CONTRACT)).toMatchObject({
      meta: 'PDF · 860 KB · Whole project',
      locked: true,
    });
    expect(view.pickerRow(DESIGN)).toMatchObject({ meta: 'Picture · 1.8 MB · Design', note: null });
    expect(view.pickerRow({ ...GUIDE, linkCount: 2 }).note).toBe('On 2 tasks');
  });

  it('ticks and disables a file already on this task, saved or picked in the form', () => {
    expect(view.pickerRow(FLOW)).toMatchObject({ note: 'Already on this task', disabled: true });
    expect(view.pickerRow(GUIDE, [1])).toMatchObject({
      note: 'Already on this task',
      disabled: true,
    });
  });

  it('counts the picked files in the footer', () => {
    expect(view.pickedText(0)).toBe('');
    expect(view.pickedText(2)).toBe('2 picked');
    expect(view.attachLabel(0)).toBe('Attach files');
    expect(view.attachLabel(1)).toBe('Attach 1 file');
    expect(view.attachLabel(2)).toBe('Attach 2 files');
  });

  it('says why the list is empty', () => {
    expect(view.emptyState({ total: 0, place: 'all' })).toEqual({
      kind: 'empty',
      text: 'No files in this project yet. Upload them in Files first.',
    });
    expect(view.emptyState({ total: 4, query: ' zip ', place: 'all' }).text).toBe(
      'No files match “zip”.',
    );
    expect(view.emptyState({ total: 4, place: 'design' }).text).toBe('Nothing in Design yet.');
  });
});

describe('the share confirm', () => {
  it('shows for a person who is not a manager and for anyone on the project', () => {
    const vishal = { id: 12, role: 'employee', status: 'active' };
    expect(view.pickedToShare(FILES, [1, 2], vishal, PROJECT)).toEqual([CONTRACT]);
    expect(view.pickedToShare(FILES, [2], null, PROJECT)).toEqual([CONTRACT]);
    expect(view.pickedToShare(FILES, [1, 3], vishal, PROJECT)).toEqual([]);
  });

  it('never shows for the viewer, the PM or an Admin', () => {
    const pm = { id: 7, role: 'pm', status: 'active' };
    const ceo = { id: 3, role: 'admin', status: 'active' };
    expect(view.pickedToShare(FILES, [2], pm, PROJECT)).toEqual([]);
    expect(view.pickedToShare(FILES, [2], ceo, PROJECT)).toEqual([]);
  });

  it('says the form and picker sentence', () => {
    expect(view.pickerShareText([CONTRACT], 'Vishal Saini')).toBe(
      'acme-store-contract-signed.pdf is only for PM and Admins. Vishal Saini will be able to open it from this task.',
    );
    expect(view.pickerShareText([CONTRACT, CONTRACT], null)).toBe(
      '2 files are only for PM and Admins. Everyone on the project will be able to open them from this task.',
    );
  });
});

describe('the data', () => {
  it('asks the picker route, with the task once it is saved', () => {
    expect(pickerPath(5, 8)).toBe('/api/projects/5/files?taskId=8');
    expect(pickerPath(5, null)).toBe('/api/projects/5/files');
  });

  it('reads before 020 and before 019 as the update state, any other failure as an error', () => {
    expect(pickerState({ data: { linksReady: false, files: [] } }).state).toBe('update');
    expect(pickerState(null, { code: 'UPDATE_NEEDED', message: 'x' }).state).toBe('update');
    expect(pickerState(null, { code: 'NETWORK', message: 'offline' }).state).toBe('error');
    const answer = { data: { files: FILES, places: [], taskPhase: 'design', linksReady: true } };
    expect(pickerState(answer)).toMatchObject({ state: 'ready', taskPhase: 'design' });
  });
});

describe('the window', () => {
  it('has its title, line, places and the rows of the place it opens on', () => {
    data.now = ready(FILES, { taskPhase: 'design' });
    const html = render();
    const shown = text(html);
    expect(html).toContain('data-dialog="Attach from project files"');
    expect(shown.startsWith('Files stay in Files. The task gets a link to them.')).toBe(true);
    expect(html).toContain('<nav class="');
    expect(html).toContain('aria-label="Places"');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*><span[^>]*>Design<\/span>/);
    expect(html).toContain('role="group" aria-label="Project files"');
    expect(shown).toContain('Picture · 1.8 MB · Design');
    expect(shown).toContain('Word · 340 KB · Design Already on this task');
    expect(shown).not.toContain('acme-brand-guide.pdf');
    expect(html).toContain('src="/api/project-files/3/thumb"');
    expect(html).toMatch(/<select[^>]*>.*<option value="all">All files \(4\)<\/option>/);
  });

  it('marks every Only PM and Admins file with its lock line', () => {
    const shown = text(render());
    expect(shown).toContain('PDF · 860 KB · Whole project Only PM and Admins On 1 task');
  });

  it('starts with nothing picked: Cancel and "Attach files", which does nothing yet', () => {
    const html = render();
    const footer = html.slice(html.indexOf('<footer>'));
    expect(text(footer)).toBe('Cancel Attach files');
    expect(footer).toMatch(/<button[^>]*aria-disabled="true"[^>]*>.*Attach files/);
  });

  it('shows three skeleton rows while it loads, and Try again after a failure', () => {
    data.now = { ...ready([]), state: 'loading' };
    expect(render().match(/height:64px/g)).toHaveLength(3);
    data.now = { ...ready([]), state: 'error' };
    const failed = text(render());
    expect(failed).toContain("Couldn't load the project's files. Try again");
  });

  it('says when the project has no files, with Open Files', () => {
    data.now = ready([]);
    const shown = text(render({ onOpenFiles: () => {} }));
    expect(shown).toContain('No files in this project yet. Upload them in Files first. Open Files');
  });

  it('says the database update is missing, with no list and no Attach', () => {
    data.now = { ...ready([]), state: 'update' };
    const html = render();
    expect(text(html)).toContain('This needs the latest database update. Ask an Admin.');
    expect(html).not.toContain('aria-label="Project files"');
    expect(text(html.slice(html.indexOf('<footer>')))).toBe('Cancel');
  });

  it('draws nothing while closed', () => {
    expect(render({ open: false })).toBe('');
  });
});
