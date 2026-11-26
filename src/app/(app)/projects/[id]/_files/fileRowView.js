// The words of one Files tab row and of the note window (CONTRACT 27, Files tab, Rows and Row menu,
// and CONTRACT 28, Files tab): the muted line ("PDF · 2.4 MB · Riya Kapoor, 21 Nov", the place in All
// files, the task of a task's file, " · On 2 tasks" for managers, "Shared with you on Fix the login
// page" for a member, "Word · 340 KB · From Design" on a linked row), the lock and program lines,
// what a click on the name does, the row menu of each kind, the words of deleting and unlinking, and
// Edit details' line about the tasks a file is on. Pure and safe in the browser.
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

/** "On 1 task", "On 2 tasks": the managers' button after a project file's line. */
export const onTasksLabel = (count) => `On ${count} ${plural(count, 'task')}`;

/** "Shared with you on Fix the login page" ("… and 1 more" when on two of theirs), or null. */
export function sharedText(item) {
  const tasks = item.file?.linkedTasks ?? [];
  if (!item.shared || tasks.length === 0) return null;
  const more = tasks.length > 1 ? ` and ${tasks.length - 1} more` : '';
  return `Shared with you on ${tasks[0].title}${more}`;
}

/** The place a linked row names: "From Design", "From Whole project", or "From Files" for a file
 * the viewer reaches only through the link (its place isn't theirs to see). */
const fromOf = (item) =>
  item.shared
    ? 'From Files'
    : `From ${isPhase(item.phase) ? phaseLabel(item.phase) : 'Whole project'}`;

const NO_EXTRA = Object.freeze({ task: null, onTasks: null, shared: null, linked: false });

/**
 * The muted line under a row's name. A task's file outside On tasks also names its task, which the
 * row shows as a button after the text (" · On task: Fix the login page"); a project file on tasks
 * gives managers its tasks for the " · On 2 tasks" menu (`onTasks`) and a member the "Shared with
 * you" words (`shared`); a linked row (`linked`) says where the file is from.
 * @param {object} item a filesItems item
 * @param {string} place the place shown
 * @param {{ canManage?: boolean }} [options]
 * @returns {{ text: string, task: { id: number, title: string } | null,
 *   onTasks: Array<{ id: number, title: string }> | null, shared: string | null,
 *   linked: boolean }}
 */
export function rowMeta(item, place, { canManage = false } = {}) {
  const where = place === 'all' ? ` · ${whereOf(item)}` : '';
  if (item.type === 'note') return { ...NO_EXTRA, text: `Note · ${byLine(item)}${where}` };
  if (item.type === 'text') {
    const date = item.addedOn ? formatDayMonthShort(item.addedOn) : null;
    const parts = ['Text only', pagesText(item.document), date].filter(Boolean);
    return { ...NO_EXTRA, text: `${parts.join(' · ')}${where}` };
  }
  const kind = `${item.file.typeLabel} · ${formatSize(item.size)}`;
  if (item.type === 'link') return { ...NO_EXTRA, text: `${kind} · ${fromOf(item)}`, linked: true };
  const text = `${kind} · ${byLine(item)}${where}`;
  if (item.type === 'task') {
    return { ...NO_EXTRA, text, task: place !== 'tasks' ? item.task : null };
  }
  const tasks = item.file.linkedTasks ?? [];
  const onTasks = canManage && tasks.length > 0 ? tasks : null;
  return { ...NO_EXTRA, text, onTasks, shared: sharedText(item) };
}

/**
 * The row's third line: the lock for "Only PM and Admins" (never on a task's file, whose people come
 * from its task, never on a linked row, and never for a member who reaches the file through a
 * link) and the program warning.
 * @returns {{ managers: boolean, program: boolean }}
 */
export function rowNotes(item) {
  const ownPlace = item.type !== 'task' && item.type !== 'link' && !item.shared;
  return {
    managers: ownPlace && item.visibility === 'managers',
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
 * "Delete"; task files "Download", "Open task", "Edit details", "Delete"; a linked row "Download",
 * "Open task", "Remove from this task"; notes "Open", "Edit", "Delete"; text-only documents "View
 * text", "Edit details", "Delete".
 * @returns {Array<'download' | 'viewText' | 'readText' | 'openTask' | 'open' | 'edit' |
 *   'delete' | 'unlink'>}
 */
export function rowActions(item) {
  if (item.type === 'link') return ['download', 'openTask', 'unlink'];
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

/** The words of deleting an item with Undo; a project file on tasks says how many ("It was on 2
 * tasks."), from the tasks the viewer may see it on (managers: all of them). */
export function deleteCopy(item) {
  const note = item.type === 'note';
  const what = note ? 'note' : 'file';
  const url =
    item.type === 'note' || item.type === 'text'
      ? `/api/project-documents/${item.id}`
      : `/api/project-files/${item.id}`;
  const onTasks = item.type === 'file' ? Number(item.file?.linkCount ?? 0) : 0;
  return {
    url,
    label: note ? 'Note deleted.' : 'File deleted.',
    body: onTasks > 0 ? `It was on ${onTasks} ${plural(onTasks, 'task')}.` : null,
    failTitle: `Couldn't delete the ${what}`,
  };
}

/** The words of taking a linked file off its task with Undo (the file stays in Files). */
export function unlinkCopy(item) {
  return {
    url: `/api/project-tasks/${item.task.id}/links/${item.id}`,
    label: 'Removed from this task. It stays in Files.',
    failTitle: "Couldn't remove the file from the task",
  };
}

/**
 * Edit details' line under "Who can see it" while "Only PM and Admins" is chosen, for a file on
 * tasks of people who aren't managers (from `linkedTasks`' person fields; managers only): who can
 * still open it from those tasks. Null when every such task is a manager's.
 * @param {{ linkedTasks?: Array<{ title: string, assigneeId: number | null,
 *   assigneeName: string | null, assigneeManages: boolean }> } | null} file
 * @returns {string | null}
 */
export function keepLine(file) {
  const tasks = (file?.linkedTasks ?? []).filter((task) => !task.assigneeManages);
  if (tasks.length === 0) return null;
  const anyone = tasks.filter((task) => task.assigneeId === null || task.assigneeId === undefined);
  const keep = 'to keep it for PM and Admins only.';
  if (anyone.length === 1) {
    return `Everyone on the project can still open it from ${anyone[0].title}, a task for anyone. Remove it from that task ${keep}`;
  }
  if (anyone.length > 1) {
    return `Everyone on the project can still open it from ${anyone.length} tasks for anyone. Remove it from those tasks ${keep}`;
  }
  if (tasks.length === 1) {
    return `${tasks[0].assigneeName} can still open it from ${tasks[0].title}.`;
  }
  return `People on the ${tasks.length} tasks it is on can still open it from those tasks.`;
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
