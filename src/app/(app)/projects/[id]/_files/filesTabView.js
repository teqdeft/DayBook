// What the Files tab shows (CONTRACT 27, Files tab): the places and their counts, which items a place
// lists (a phase with "On tasks in Design", On tasks grouped by task), search, the three sorts and
// every empty state (the lines of each row are in fileRowView.js). Pure and safe in the browser. The
// server already left out what this viewer may not see, so a count never hints at a hidden file; a
// file's text for the AI is never a row or a count of its own.
import {
  PHASE_KEYS,
  PROJECT_PHASES,
  isPhase,
  phaseIndex,
  phaseLabel,
} from '@/modules/projectPlan/phases';

// The lines of each row and the note window live in fileRowView.js; they are re-exported here so
// the tab has one view module.
export {
  canReadForAi,
  deleteCopy,
  MANAGERS_LINE,
  noteWindowMeta,
  pagesText,
  PROGRAM_LINE,
  READ_LIMIT_BYTES,
  rowActions,
  rowMeta,
  rowNotes,
  rowOpens,
  visibilityLabel,
  windowDocument,
} from './fileRowView';

/** Every place, in the side list's order. */
export const PLACES = Object.freeze(['all', 'project', ...PHASE_KEYS, 'tasks']);

/** The sorts, the first is the default. */
export const SORTS = Object.freeze([
  { value: 'new', label: 'Newest first' },
  { value: 'name', label: 'Name A to Z' },
  { value: 'big', label: 'Biggest first' },
]);

/** Where the chosen sort is remembered, per person and browser. */
export const SORT_KEY = 'daybook.files.sort';

/** A place from the URL, or 'all' for anything else. */
export function placeOf(value) {
  return PLACES.includes(value) ? value : 'all';
}

/** A sort from storage, or 'new' for anything else. */
export function sortOf(value) {
  return SORTS.some((sort) => sort.value === value) ? value : 'new';
}

/** 'All files', 'Whole project', 'On tasks' or the phase's name. */
export function placeName(place) {
  if (place === 'all') return 'All files';
  if (place === 'project') return 'Whole project';
  if (place === 'tasks') return 'On tasks';
  return phaseLabel(place);
}

/** The side list's link: '?tab=files&place=design'. */
export const placeHref = (place) => `?tab=files&place=${place}`;

const timeOf = (value) => (value ? new Date(value).getTime() : 0);

/**
 * The tab's items: each file, note and text-only document once. A project file gets the document
 * holding its text (`text`), when the viewer may see it.
 * @param {{ files?: object[], documents?: object[] }} data files: ProjectFile[] with `addedOn`
 *   (the company date); documents: listDocumentsFor's rows with `addedOn` and `createdByName`
 * @returns {Array<{ key: string, type: 'file' | 'task' | 'note' | 'text', id: number,
 *   name: string, phase: string | null, size: number, at: number, addedOn: string, by: string,
 *   visibility: 'everyone' | 'managers' | null, file?: object, task?: object | null,
 *   text?: object | null, document?: object }>} phase: a task file's is its task's; size -1 for
 *   notes and texts
 */
export function filesItems({ files = [], documents = [] } = {}) {
  const texts = new Map();
  for (const document of documents) {
    if (document.fileId !== null && document.fileId !== undefined) {
      texts.set(Number(document.fileId), document);
    }
  }
  const items = [];
  for (const file of files) {
    const onTask = file.scope === 'task';
    if (onTask && !file.task) continue;
    items.push({
      key: `file:${file.id}`,
      type: onTask ? 'task' : 'file',
      id: file.id,
      name: file.name,
      phase: (onTask ? file.task.phase : file.phase) ?? null,
      size: Number(file.sizeBytes) || 0,
      at: timeOf(file.createdAt),
      addedOn: file.addedOn ?? null,
      by: file.createdBy?.name ?? '',
      visibility: onTask ? null : (file.visibility ?? 'managers'),
      file,
      task: onTask ? file.task : null,
      text: onTask ? null : (texts.get(Number(file.id)) ?? null),
    });
  }
  for (const document of documents) {
    if (document.fileId !== null && document.fileId !== undefined) continue;
    items.push({
      key: `doc:${document.id}`,
      type: document.kind === 'note' ? 'note' : 'text',
      id: document.id,
      name: document.title,
      phase: document.phase ?? null,
      size: -1,
      at: timeOf(document.createdAt),
      addedOn: document.addedOn ?? null,
      by: document.createdByName ?? '',
      visibility: document.visibility ?? 'managers',
      document,
    });
  }
  return items;
}

/** The count of each place for these items (see placeCounts). */
export function countItems(items) {
  const counts = Object.fromEntries(PLACES.map((place) => [place, 0]));
  for (const item of items) {
    counts.all += 1;
    if (item.type === 'task') counts.tasks += 1;
    else if (item.phase === null) counts.project += 1;
    if (item.phase !== null && isPhase(item.phase)) counts[item.phase] += 1;
  }
  return counts;
}

/**
 * How many items each place has, for this viewer (the side list and the phone's Show list). A phase
 * counts its own items and the files on its tasks; Whole project only its own; On tasks every task
 * file; a file on a task with no phase only counts in All files and On tasks.
 * @param {{ files?: object[], documents?: object[] }} data as filesItems
 * @returns {Record<string, number>} by place
 */
export function placeCounts(data) {
  return countItems(filesItems(data));
}

const byName = (a, b) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key);

const SORTERS = Object.freeze({
  new: (a, b) => b.at - a.at || byName(a, b),
  name: byName,
  big: (a, b) => b.size - a.size || byName(a, b),
});

/** The items in a sort's order: newest first, by name, or biggest first (notes and texts last). */
export function sortItems(items, sort) {
  return [...items].sort(SORTERS[sortOf(sort)]);
}

/** A test for the search box: the name or note title holds the words, in any case. */
export function matcher(query) {
  const words = String(query ?? '')
    .trim()
    .toLowerCase();
  return words ? (item) => item.name.toLowerCase().includes(words) : () => true;
}

/** The tasks of these items in the On tasks order: by phase (no phase last), then by title. */
function tasksOf(items) {
  const tasks = new Map();
  for (const item of items) if (!tasks.has(item.task.id)) tasks.set(item.task.id, item.task);
  const rank = (task) => (isPhase(task.phase) ? phaseIndex(task.phase) : PHASE_KEYS.length);
  return [...tasks.values()].sort(
    (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }),
  );
}

/**
 * The empty state of a place.
 * @returns {{ text: string, action: 'upload' | 'clear' | null }}
 */
export function emptyState({ place, query, total, canManage }) {
  const words = String(query ?? '').trim();
  if (words) return { text: `No files match "${words}".`, action: 'clear' };
  if (total === 0) {
    return canManage
      ? {
          text: 'No files yet. Upload briefs, designs and contracts so the team has them in one place.',
          action: 'upload',
        }
      : { text: 'No files shared with you yet.', action: null };
  }
  if (place === 'tasks') {
    const text = canManage
      ? 'No task has files yet. Add files to a task from its window.'
      : 'None of your tasks has files.';
    return { text, action: null };
  }
  return { text: `Nothing in ${placeName(place)} yet.`, action: canManage ? 'upload' : null };
}

/**
 * What one place shows: its groups of rows (a phase's own items, then "On tasks in Design"; On
 * tasks one group per task), the pictures in that order (for the viewer) and the empty state.
 * @param {{ items: object[], place: string, query?: string, sort?: string,
 *   canManage?: boolean }} args
 * @returns {{ groups: Array<{ key: string, heading: null | { text: string, count: number } |
 *   { task: object, phase: string }, items: object[] }>, shown: object[], pictures: object[],
 *   empty: null | { text: string, action: 'upload' | 'clear' | null } }} pictures: the files
 */
export function placeView({ items, place, query = '', sort = 'new', canManage = false }) {
  const hit = matcher(query);
  const groups = [];
  if (place === 'all') {
    groups.push({ key: 'all', heading: null, items: sortItems(items.filter(hit), sort) });
  } else if (place === 'tasks') {
    const onTasks = items.filter((item) => item.type === 'task' && hit(item));
    for (const task of tasksOf(onTasks)) {
      const phase = isPhase(task.phase) ? phaseLabel(task.phase) : 'No phase yet';
      const own = onTasks.filter((item) => item.task.id === task.id);
      groups.push({
        key: `task:${task.id}`,
        heading: { task, phase },
        items: sortItems(own, sort),
      });
    }
  } else {
    const inPlace = (item) => (place === 'project' ? item.phase === null : item.phase === place);
    const own = items.filter((item) => item.type !== 'task' && inPlace(item) && hit(item));
    groups.push({ key: 'own', heading: null, items: sortItems(own, sort) });
    if (place !== 'project') {
      const onTasks = items.filter((item) => item.type === 'task' && inPlace(item) && hit(item));
      const heading = { text: `On tasks in ${placeName(place)}`, count: onTasks.length };
      groups.push({ key: 'tasks', heading, items: sortItems(onTasks, sort) });
    }
  }
  const filled = groups.filter((group) => group.items.length > 0);
  const shown = filled.flatMap((group) => group.items);
  const pictures = shown.filter((item) => item.file?.isPicture).map((item) => item.file);
  const empty = shown.length ? null : emptyState({ place, query, total: items.length, canManage });
  return { groups: filled, shown, pictures, empty };
}

/** The Upload and note windows' place for a place: its phase, else null (Whole project). */
export const phaseForPlace = (place) => (isPhase(place) ? place : null);

/** The "Add to" and "Place" options: Whole project, then the phases ("Development (current phase)"). */
export function placeOptions(currentPhase) {
  return [
    { value: 'project', label: 'Whole project' },
    ...PROJECT_PHASES.map(({ key, label }) => ({
      value: key,
      label: key === currentPhase ? `${label} (current phase)` : label,
    })),
  ];
}

/** An option's value as a phase: 'project' is null. */
export const optionPhase = (value) => (isPhase(value) ? value : null);

/** An item's phase as an option's value. */
export const phaseOption = (phase) => (isPhase(phase) ? phase : 'project');

/** The overlay while files are dragged over the list. */
export function dropLabel(place) {
  return `Drop to add to ${isPhase(place) ? placeName(place) : 'Whole project'}`;
}
