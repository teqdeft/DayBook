// What the note window and the AI reader say about a document's text (CONTRACT 22 and 27): the added
// toast and a text split into its pages. Pure and safe in the browser. The Files tab's rows and
// counts are in _files/filesTabView.js.

const PAGE_BREAK = '\f';

/**
 * The toast once a file's text is saved: 'SOW-Acme-v3.pdf added.', with what was left out.
 * @param {{ title: string, notice: string | null }} read readDocumentFile's result
 * @returns {{ title: string, body?: string }}
 */
export function addedToast({ title, notice }) {
  return notice ? { title: `${title} added.`, body: notice } : { title: `${title} added.` };
}

/**
 * A text as the note window shows it: a file's pages (they are separated by \f), a note as one
 * page.
 * @param {string} body
 * @param {'file' | 'note'} kind
 * @returns {Array<{ number: number, text: string }>} each page's number and its text, trimmed
 */
export function textPages(body, kind) {
  const pages = kind === 'file' ? body.split(PAGE_BREAK) : [body];
  return pages.map((text, index) => ({ number: index + 1, text: text.trim() }));
}
