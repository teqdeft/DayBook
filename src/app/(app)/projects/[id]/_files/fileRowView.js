// The words of one Files tab row and of the note window (CONTRACT 27, Files tab, Rows and Row menu):
// the muted line ("PDF · 2.4 MB · Riya Kapoor, 21 Nov", the place in All files, the task of a task's
// file), the lock and program lines, what a click on the name does, the row menu of each kind and
// the words of deleting. Pure and safe in the browser.
import { plural } from '@/lib/text';
import { formatDayMonthShort } from '@/lib/time';
import { formatSize, READABLE_EXTS } from '@/modules/projectFiles/kinds';
import { isPhase, phaseLabel } from '@/modules/projectPlan/phases';

/** The largest project file whose text is read for the AI summary (readDocumentFile's limit). */
export const READ_LIMIT_BYTES = 20 * 1024 * 1024;

export const PROGRAM_LINE = 'Program file. Open it only if you trust where it came from.';
export const MANAGERS_LINE = 'Only PM and Admins';

/** Where an item is, in All files: 'Whole project', a phase, or 'No phase yet' for a task's file. */
function whereOf(item) {
  if (item.phase !== null && isPhase(item.phase)) return phaseLabel(item.phase);
  return item.type === 'task' ? 'No phase yet' : 'Whole project';
}

/** 'Riya Kapoor, 21 Nov', or the date alone without a name. */
function byLine(item) {
  const date = item.addedOn ? formatDayMonthShort(item.addedOn) : '';
  return [item.by, date].filter(Boolean).join(', ');
}

/** '14 pages', 'First 100 of 140 pages', or null for a text without pages. */
export function pagesText({ pages, pagesTotal }) {
  if (pages && pagesTotal && pagesTotal > pages) return `First ${pages} of ${pagesTotal} pages`;
  return pages ? `${pages} ${plural(pages, 'page')}` : null;
}

/**
 * The muted line under a row's name. A task's file outside On tasks also names its task, which the
 * row shows as a button after the text (" · On task: Fix the login page").
 * @param {object} item a filesItems item
 * @param {string} place the place shown
 * @returns {{ text: string, task: { id: number, title: string } | null }}
 */
export function rowMeta(item, place) {
  const where = place === 'all' ? ` · ${whereOf(item)}` : '';
  if (item.type === 'note') return { text: `Note · ${byLine(item)}${where}`, task: null };
  if (item.type === 'text') {
    const date = item.addedOn ? formatDayMonthShort(item.addedOn) : null;
    const parts = ['Text only', pagesText(item.document), date].filter(Boolean);
    return { text: `${parts.join(' · ')}${where}`, task: null };
  }
  const head = `${item.file.typeLabel} · ${formatSize(item.size)} · ${byLine(item)}${where}`;
  return { text: head, task: item.type === 'task' && place !== 'tasks' ? item.task : null };
}

/**
 * The row's third line: the lock for "Only PM and Admins" (never on a task's file, whose people come
 * from its task) and the program warning.
 * @returns {{ managers: boolean, program: boolean }}
 */
export function rowNotes(item) {
  return {
    managers: item.type !== 'task' && item.visibility === 'managers',
    program: item.file?.kind === 'program',
  };
}

/** True for a project file whose text Daybook can read for the AI and hasn't kept yet. */
export function canReadForAi(item) {
  if (item.type !== 'file' || item.text || item.file.hasText) return false;
  return READABLE_EXTS.includes(item.file.ext) && item.size <= READ_LIMIT_BYTES;
}

/**
 * The row menu (managers): files "Download", "View text" or "Read text for AI", "Edit details",
 * "Delete"; task files "Download", "Open task", "Edit details", "Delete"; notes "Open", "Edit",
 * "Delete"; text-only documents "View text", "Edit details", "Delete".
 * @returns {Array<'download' | 'viewText' | 'readText' | 'openTask' | 'open' | 'edit' |
 *   'delete'>}
 */
export function rowActions(item) {
  if (item.type === 'note') return ['open', 'edit', 'delete'];
  if (item.type === 'text') return ['viewText', 'edit', 'delete'];
  if (item.type === 'task') return ['download', 'openTask', 'edit', 'delete'];
  const text = item.text ? 'viewText' : canReadForAi(item) ? 'readText' : null;
  return ['download', text, 'edit', 'delete'].filter(Boolean);
}

/** What a click on a row's name does: the picture viewer, a download or the note window. */
export function rowOpens(item) {
  if (item.type === 'note' || item.type === 'text') return 'note';
  return item.file.isPicture ? 'viewer' : 'download';
}

/** The words of deleting an item with Undo. */
export function deleteCopy(item) {
  const note = item.type === 'note';
  const what = note ? 'note' : 'file';
  const url =
    item.type === 'note' || item.type === 'text'
      ? `/api/project-documents/${item.id}`
      : `/api/project-files/${item.id}`;
  return {
    url,
    label: note ? 'Note deleted.' : 'File deleted.',
    failTitle: `Couldn't delete the ${what}`,
  };
}

/** "Everyone on the project" or "Only PM and Admins". */
export const visibilityLabel = (visibility) =>
  visibility === 'everyone' ? 'Everyone on the project' : MANAGERS_LINE;

/**
 * The line under the note window's title: "Note · Riya Kapoor, 28 Oct · Design · Everyone on the
 * project", "Text only · 14 pages · 28 Oct · Whole project · Only PM and Admins", or for a project
 * file's text "Text for the AI summary · 14 pages · Design · Only PM and Admins".
 * @param {object} item a filesItems item: a note, a text-only document, or a file with `text`
 */
export function noteWindowMeta(item) {
  const where = whereOf(item);
  if (item.type === 'note') {
    return `Note · ${byLine(item)} · ${where} · ${visibilityLabel(item.visibility)}`;
  }
  const date = item.addedOn ? formatDayMonthShort(item.addedOn) : null;
  const parts =
    item.type === 'text'
      ? ['Text only', pagesText(item.document), date, where, visibilityLabel(item.visibility)]
      : ['Text for the AI summary', pagesText(item.text ?? {}), where, MANAGERS_LINE];
  return parts.filter(Boolean).join(' · ');
}

/** The document a note window shows: the note or text itself, or a project file's text. */
export const windowDocument = (item) => (item.type === 'file' ? item.text : item.document);
