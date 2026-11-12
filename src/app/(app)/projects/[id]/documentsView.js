// What "Files and notes" on the Phases tab says (CONTRACT 22), with the prototype's wording: the line
// under each name, the delete toasts, the added toast and a file's text split into its pages. Pure and
// safe in the browser: today comes in as an argument, dates are 'YYYY-MM-DD' in the company time zone.
import { plural } from '@/lib/text';
import { shortDate } from './planFormat';
import { fileTypeOf } from './readDocumentFile';

const PAGE_BREAK = '\f';

/** What a file is called when it has no pages to count. */
const UNPAGED_KINDS = { docx: 'Word file', text: 'Text file' };

/** The key a file or note has in Delete with Undo: 'file:12', 'note:3'. */
export const documentKey = (document) => `${document.kind}:${document.id}`;

/** The ids focus moves to: a row's name, Edit and Delete buttons. */
export const documentButtonId = (documentId, action) => `phases-doc-${documentId}-${action}`;

/** The id of a row's text box. */
export const documentTextId = (documentId) => `phases-doc-${documentId}-text`;

/** The ids of a phase's Add file and Add note buttons. */
export const addDocumentIds = (phase) => ({
  file: `phases-${phase}-add-file`,
  note: `phases-${phase}-add-note`,
});

/**
 * How many pages a file has, as far as Daybook read it.
 * @param {{ title: string, pages: number | null, pagesTotal: number | null }} file
 * @returns {string} '14 pages', 'First 100 of 140 pages', or 'Word file', 'Text file' or 'File'
 *   when it has no pages
 */
function pagesText({ title, pages, pagesTotal }) {
  if (pages && pagesTotal && pagesTotal > pages) return `First ${pages} of ${pagesTotal} pages`;
  if (pages) return `${pages} ${plural(pages, 'page')}`;
  return UNPAGED_KINDS[fileTypeOf({ name: title })] ?? 'File';
}

/**
 * The muted line under a file or note's name.
 * @param {{ kind: 'file' | 'note', title: string, pages: number | null,
 *   pagesTotal: number | null, addedOn?: string }} document addedOn: the company date it was added
 * @param {string} today
 * @returns {string} '14 pages · 28 Oct', 'Word file · 28 Oct', 'Note · 28 Oct'
 */
export function documentDetail(document, today) {
  const what = document.kind === 'note' ? 'Note' : pagesText(document);
  return document.addedOn ? `${what} · ${shortDate(document.addedOn, today)}` : what;
}

/**
 * The words around deleting a file or note.
 * @param {{ kind: 'file' | 'note', title: string }} document
 * @returns {{ button: string, label: string, failTitle: string }} button: the Delete button's name;
 *   label: the Undo toast; failTitle: the error toast when the delete fails
 */
export function deleteCopy({ kind, title }) {
  const what = kind === 'note' ? 'note' : 'file';
  return {
    button: `Delete ${what}: ${title}`,
    label: kind === 'note' ? 'Note deleted.' : 'File deleted.',
    failTitle: `Couldn't delete the ${what}`,
  };
}

/**
 * The toast once a file's text is saved: 'SOW-Acme-v3.pdf added.', with what was left out.
 * @param {{ title: string, notice: string | null }} read readDocumentFile's result
 * @returns {{ title: string, body?: string }}
 */
export function addedToast({ title, notice }) {
  return notice ? { title: `${title} added.`, body: notice } : { title: `${title} added.` };
}

/**
 * A text as the box shows it: a file's pages (they are separated by \f), a note as one page.
 * @param {string} body
 * @param {'file' | 'note'} kind
 * @returns {Array<{ number: number, text: string }>} each page's number and its text, trimmed
 */
export function textPages(body, kind) {
  const pages = kind === 'file' ? body.split(PAGE_BREAK) : [body];
  return pages.map((text, index) => ({ number: index + 1, text: text.trim() }));
}
