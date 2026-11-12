// "Files and notes" on the Phases tab (CONTRACT 22): the words of each row (documentsView.js), a
// file's text split into its pages and shown as plain text, and the part really rendered for the
// project's PM: with files and notes, empty, and the note row. Another PM's section never gets it.
// Client parts render their first state only: reading a file, the text box's fetch, Undo and the
// note row's saving run in the browser (tests/e2e/project-plan.spec.js).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(),
}));
const get = vi.fn(() => new Promise(() => {}));
vi.mock('@/lib/apiClient', () => ({
  api: { get: (...args) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { default: PhaseDocuments } = await import('@/app/(app)/projects/[id]/PhaseDocuments.jsx');
const { default: PhaseSection } = await import('@/app/(app)/projects/[id]/PhaseSection.jsx');
const { default: NoteForm } = await import('@/app/(app)/projects/[id]/NoteForm.jsx');
const { default: DocumentText, TextPages } =
  await import('@/app/(app)/projects/[id]/DocumentText.jsx');
const view = await import('@/app/(app)/projects/[id]/documentsView.js');
const { FILE_ACCEPT } = await import('@/app/(app)/projects/[id]/readDocumentFile.js');
const { phaseSections } = await import('@/app/(app)/projects/[id]/phasesView.js');

const TODAY = '2026-10-30';
const SECRET = 'Payment provider still to be decided';

const doc = (id, more = {}) => ({
  id,
  projectId: 5,
  phase: 'requirement_gathering',
  kind: 'file',
  title: `File ${id}`,
  pages: null,
  pagesTotal: null,
  charCount: 120,
  createdBy: 7,
  updatedBy: 7,
  createdAt: new Date('2026-10-28T05:00:00Z'),
  updatedAt: new Date('2026-10-28T05:00:00Z'),
  addedOn: '2026-10-28',
  updatedOn: '2026-10-28',
  ...more,
});

const DOCUMENTS = [
  doc(4, { kind: 'note', title: 'Kickoff call notes', addedOn: '2026-10-29' }),
  doc(3, { title: 'SOW-Acme-v3.pdf', pages: 14, pagesTotal: 14 }),
  doc(2, { title: 'Big-spec.pdf', pages: 100, pagesTotal: 140 }),
  doc(1, { title: 'Brief.docx', addedOn: '2025-12-30' }),
];

const noTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const count = (html, text) => html.split(text).length - 1;

function render(props = {}) {
  return renderToStaticMarkup(
    createElement(PhaseDocuments, {
      projectId: 5,
      phase: 'requirement_gathering',
      documents: DOCUMENTS,
      canManage: true,
      managerName: 'Riya Kapoor',
      today: TODAY,
      ...props,
    }),
  );
}

describe('the words of a row', () => {
  it('says how many pages a file has, or what it is, and when it was added', () => {
    const detail = (more) => view.documentDetail(doc(1, more), TODAY);
    expect(detail({ pages: 14, pagesTotal: 14 })).toBe('14 pages · 28 Oct');
    expect(detail({ pages: 1, pagesTotal: 1 })).toBe('1 page · 28 Oct');
    expect(detail({ pages: 100, pagesTotal: 140 })).toBe('First 100 of 140 pages · 28 Oct');
    expect(detail({ title: 'Brief.DOCX' })).toBe('Word file · 28 Oct');
    expect(detail({ title: 'notes.md' })).toBe('Text file · 28 Oct');
    expect(detail({ title: 'readme.txt' })).toBe('Text file · 28 Oct');
    expect(detail({ title: 'no-extension' })).toBe('File · 28 Oct');
    expect(detail({ kind: 'note', pages: 3 })).toBe('Note · 28 Oct');
    expect(detail({ addedOn: '2027-01-10' })).toBe('File · 10 Jan 2027');
    expect(detail({ addedOn: undefined })).toBe('File');
  });

  it('names the delete button, its toast and the error toast', () => {
    expect(view.deleteCopy({ kind: 'file', title: 'SOW.pdf' })).toEqual({
      button: 'Delete file: SOW.pdf',
      label: 'File deleted.',
      failTitle: "Couldn't delete the file",
    });
    expect(view.deleteCopy({ kind: 'note', title: 'Kickoff' })).toEqual({
      button: 'Delete note: Kickoff',
      label: 'Note deleted.',
      failTitle: "Couldn't delete the note",
    });
  });

  it('keys files and notes apart for Undo, and gives every button its own id', () => {
    expect(view.documentKey({ kind: 'file', id: 12 })).toBe('file:12');
    expect(view.documentKey({ kind: 'note', id: 12 })).toBe('note:12');
    expect(view.documentButtonId(12, 'delete')).toBe('phases-doc-12-delete');
    expect(view.documentTextId(12)).toBe('phases-doc-12-text');
    expect(view.addDocumentIds('design')).toEqual({
      file: 'phases-design-add-file',
      note: 'phases-design-add-note',
    });
  });

  it('says a file was added, with what was left out', () => {
    expect(view.addedToast({ title: 'SOW.pdf', notice: null })).toEqual({
      title: 'SOW.pdf added.',
    });
    expect(
      view.addedToast({ title: 'Big.pdf', notice: 'Read the first 100 of 140 pages.' }),
    ).toEqual({ title: 'Big.pdf added.', body: 'Read the first 100 of 140 pages.' });
  });
});

describe("a file's text", () => {
  it('splits a file into its pages, and keeps a note whole', () => {
    expect(view.textPages(' One \fTwo\n\f', 'file')).toEqual([
      { number: 1, text: 'One' },
      { number: 2, text: 'Two' },
      { number: 3, text: '' },
    ]);
    expect(view.textPages('A\fB', 'note')).toEqual([{ number: 1, text: 'A\fB' }]);
  });

  it('draws a line with the number where each next page starts', () => {
    const html = renderToStaticMarkup(
      createElement(TextPages, { body: 'Scope\fGo-live on 15 December\f', kind: 'file' }),
    );
    expect(count(html, 'role="separator"')).toBe(2);
    expect(html).toContain('aria-label="Page 2"');
    expect(html).toContain('aria-label="Page 3"');
    expect(html).not.toContain('Page 1');
    expect(noTags(html)).toContain(
      'Scope Page 2 Go-live on 15 December Page 3 No text on this page.',
    );
  });

  it('has no page line for a single page', () => {
    const html = renderToStaticMarkup(createElement(TextPages, { body: 'Notes', kind: 'note' }));
    expect(html).not.toContain('separator');
    expect(noTags(html).trim()).toBe('Notes');
  });

  it('shows the text as plain text, never as HTML', () => {
    const body = '<img src=x onerror="alert(1)"><script>alert(2)</script>\fA & B';
    const html = renderToStaticMarkup(createElement(TextPages, { body, kind: 'file' }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('fetches the text when the box opens, saying so meanwhile', () => {
    const html = renderToStaticMarkup(
      createElement(DocumentText, { id: 'phases-doc-3-text', document: DOCUMENTS[1] }),
    );
    expect(html).toContain('id="phases-doc-3-text"');
    expect(html).toContain('aria-busy="true"');
    expect(noTags(html)).toContain('Loading the text…');
  });
});

describe("the project manager's files and notes", () => {
  it('has Add file, with a real hidden file picker, and Add note', () => {
    const html = render();
    const text = noTags(html);
    expect(text).toContain('Files and notes');
    expect(text).toContain('Add file');
    expect(text).toContain('Add note');
    expect(html).toContain('id="phases-requirement_gathering-add-file"');
    expect(html).toContain('id="phases-requirement_gathering-add-note"');
    expect(count(html, 'type="file"')).toBe(1);
    expect(html).toContain(`accept="${FILE_ACCEPT}"`);
    expect(html).toMatch(/<input[^>]*type="file"[^>]*hidden=""/);
  });

  it('lists every file and note, newest first, as the server sent them', () => {
    const text = noTags(render());
    const order = ['Kickoff call notes', 'SOW-Acme-v3.pdf', 'Big-spec.pdf', 'Brief.docx'];
    const at = order.map((title) => text.indexOf(title));
    expect(at.every((value, index) => value > 0 && (index === 0 || value > at[index - 1]))).toBe(
      true,
    );
    expect(text).toContain('Kickoff call notes Note · 29 Oct');
    expect(text).toContain('SOW-Acme-v3.pdf 14 pages · 28 Oct');
    expect(text).toContain('Big-spec.pdf First 100 of 140 pages · 28 Oct');
    expect(text).toContain('Brief.docx Word file · 30 Dec 2025');
    expect(text).not.toContain('No files or notes yet.');
  });

  it('opens a name as a closed box, and edits notes only', () => {
    const html = render();
    expect(html).toContain('aria-label="Files and notes"');
    expect(count(html, 'aria-expanded="false"')).toBe(4);
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).not.toContain('aria-busy'); // no text is fetched before a click
    expect(html).toContain('aria-label="Edit note: Kickoff call notes"');
    expect(count(html, 'aria-label="Edit note:')).toBe(1);
    expect(html).toContain('aria-label="Delete note: Kickoff call notes"');
    expect(html).toContain('aria-label="Delete file: SOW-Acme-v3.pdf"');
    expect(count(html, 'aria-label="Delete ')).toBe(4);
    expect(html).toContain('id="phases-doc-3-delete"');
  });

  it('says there are none yet, with no empty list', () => {
    const html = render({ documents: [] });
    const text = noTags(html);
    expect(text).toContain('No files or notes yet.');
    expect(text).toContain('Add file');
    expect(text).toContain('Add note');
    expect(html).not.toContain('<ul');
  });
});

describe('the note row', () => {
  const renderForm = (note = null) =>
    renderToStaticMarkup(
      createElement(NoteForm, { projectId: 5, phase: 'design', note, onClose: () => {} }),
    );

  it('adds a note with a title and its text, as the prototype', () => {
    const html = renderForm();
    expect(html).toContain('aria-label="Note title"');
    expect(html).toContain('placeholder="Title"');
    expect(html).toContain('maxLength="200"');
    expect(html).toContain('aria-label="Note text"');
    expect(html).toContain('placeholder="Text"');
    expect(noTags(html)).toContain('Add note Cancel');
    expect(html).not.toContain('disabled');
  });

  it('waits for the note text before it can be edited', () => {
    const html = renderForm(DOCUMENTS[0]);
    expect(html).toContain('value="Kickoff call notes"');
    expect(html).toContain('placeholder="Loading the note…"');
    expect(count(html, 'disabled=""')).toBe(3); // title, text and Save
    expect(noTags(html)).toContain('Save Cancel');
  });
});

describe("another PM's section", () => {
  it('never gets the files and notes, only who they are for', () => {
    const plan = {
      currentPhase: 'requirement_gathering',
      deadline: null,
      phases: PROJECT_PHASES.map(({ key, label }) => ({ key, label })),
    };
    const section = phaseSections({ plan, tasks: [] })[0];
    const documentsFor = vi.fn(() => DOCUMENTS);
    const board = {
      project: { id: 5, name: 'Acme', pmName: 'Riya Kapoor', status: 'active' },
      plan,
      today: TODAY,
      canManage: false,
      owners: [],
      managerName: 'Riya Kapoor',
      form: null,
      documentsFor,
      isDoneShown: () => false,
      toggleDone: () => {},
      openForm: () => {},
      closeForm: () => {},
      editDates: () => {},
      deleteTask: () => {},
    };
    const html = renderToStaticMarkup(
      createElement(PhaseSection, { section, open: true, onToggle: () => {}, board }),
    );
    const text = noTags(html);
    expect(text).toContain('Files and notes are only for Riya Kapoor and Admins.');
    expect(documentsFor).not.toHaveBeenCalled();
    for (const word of ['Add file', 'Add note', 'Kickoff call notes', 'SOW-Acme-v3.pdf', SECRET]) {
      expect(text).not.toContain(word);
    }
    expect(html).not.toContain('type="file"');
    expect(get).not.toHaveBeenCalled();
  });
});
