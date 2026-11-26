// What the "From project files" picker shows (CONTRACT 28, "From project files" picker and the share
// confirm), as plain values: the places with their counts (the left pane, or the "Show" select on a
// narrow window), the place it opens on, the rows of the chosen place that match the search, each
// row's lines, the footer's words, the empty states and the share confirm's sentence. Pure and
// safe in the browser; FilesPicker.jsx draws it.
import { plural } from '@/lib/text';
import { formatSize } from '@/modules/projectFiles/kinds';
import { PROJECT_PHASES, isPhase, phaseLabel } from '@/modules/projectPlan/phases';
import { filesToShare, personOf, shareText } from './shareConfirmView';

export const PICKER_TITLE = 'Attach from project files';
export const PICKER_DESC = 'Files stay in Files. The task gets a link to them.';
export const EMPTY_PROJECT = 'No files in this project yet. Upload them in Files first.';
export const LOAD_FAILED = "Couldn't load the project's files.";
export const UPDATE_NEEDED = 'This needs the latest database update. Ask an Admin.';
export const ALREADY_HERE = 'Already on this task';
export const LOCK_LINE = 'Only PM and Admins';
export const WHOLE_PROJECT = 'Whole project';

const PLACE_KEYS = ['all', 'project', ...PROJECT_PHASES.map((phase) => phase.key)];

/** A place's name: "All files", "Whole project" or the phase. */
export function placeLabel(key) {
  if (key === 'all') return 'All files';
  if (key === 'project') return WHOLE_PROJECT;
  return phaseLabel(key);
}

/** Where a file sits in Files, in words: "Whole project" or its phase. */
export const filePlace = (file) => (isPhase(file?.phase) ? phaseLabel(file.phase) : WHOLE_PROJECT);

/** True when a file is in a place ('all' holds every file). */
export function inPlace(file, key) {
  if (key === 'all') return true;
  if (key === 'project') return !isPhase(file.phase);
  return file.phase === key;
}

/**
 * The eight places in order with their counts: the server's `places` when it sent them, else
 * counted from the files.
 * @param {Array<{ key: string, label?: string, count?: number }> | null} places
 * @param {object[]} files
 * @returns {Array<{ key: string, label: string, count: number }>}
 */
export function placesOf(places, files = []) {
  return PLACE_KEYS.map((key) => {
    const sent = places?.find((place) => place.key === key);
    const count = sent ? Number(sent.count) : files.filter((file) => inPlace(file, key)).length;
    return { key, label: sent?.label ?? placeLabel(key), count };
  });
}

/**
 * The place the picker opens on: the task's phase when that phase has files, else All files.
 * @param {Array<{ key: string, count: number }>} places placesOf
 * @param {string | null} phase the task's (or the form's) phase
 */
export function presetPlace(places, phase) {
  const found = isPhase(phase) ? places.find((place) => place.key === phase) : null;
  return found && found.count > 0 ? phase : 'all';
}

/** A name or a search as the search compares them: NFC, lower case, trimmed. */
export const searchKey = (value) =>
  String(value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .trim();

/**
 * The files of a place whose name holds the search, in the server's order (newest first).
 * @param {object[]} files PickerFiles
 * @param {{ place: string, query?: string }} args
 */
export function shownFiles(files, { place, query = '' }) {
  const wanted = searchKey(query);
  return (files ?? []).filter(
    (file) => inPlace(file, place) && (!wanted || searchKey(file.name).includes(wanted)),
  );
}

/** True when the file is on this task already (saved, or a chip of the form). */
export const isOnTask = (file, existing = []) =>
  Boolean(file.onThisTask) || existing.map(Number).includes(Number(file.id));

/**
 * One row's lines: "PDF · 2.4 MB · Whole project", the lock line for every "Only PM and Admins"
 * file, and "Already on this task" (ticked and disabled) or "On 1 task".
 * @param {object} file a PickerFile
 * @param {number[]} [existing] the ids already on the task or picked in the form
 * @returns {{ meta: string, locked: boolean, note: string | null, disabled: boolean }}
 */
export function pickerRow(file, existing = []) {
  const here = isOnTask(file, existing);
  const others = Number(file.linkCount ?? 0);
  const type = file.typeLabel ?? '';
  return {
    meta: `${type} · ${formatSize(file.sizeBytes)} · ${filePlace(file)}`,
    locked: file.visibility === 'managers',
    note: here ? ALREADY_HERE : others > 0 ? `On ${others} ${plural(others, 'task')}` : null,
    disabled: here,
  };
}

/** "2 picked", nothing at 0. */
export const pickedText = (count) => (count > 0 ? `${count} picked` : '');

/** "Attach 2 files", "Attach 1 file", "Attach files" at 0. */
export function attachLabel(count) {
  if (count === 0) return 'Attach files';
  return `Attach ${count} ${plural(count, 'file')}`;
}

/** "All files (6)": a place in the "Show" select. */
export const showOption = (place) => `${place.label} (${place.count})`;

/**
 * What the list says when it shows no rows: the project has no files, the search matched none
 * ("No files match “zip”."), or the place has none ("Nothing in Design yet.").
 * @param {{ total: number, query?: string, place: string }} args
 * @returns {{ kind: 'empty' | 'search' | 'place', text: string }}
 */
export function emptyState({ total, query = '', place }) {
  if (total === 0) return { kind: 'empty', text: EMPTY_PROJECT };
  if (searchKey(query)) return { kind: 'search', text: `No files match “${query.trim()}”.` };
  const where = place === 'all' ? 'the project' : placeLabel(place);
  return { kind: 'place', text: `Nothing in ${where} yet.` };
}

/**
 * The picker's share confirm sentence for the picked "Only PM and Admins" files.
 * @param {Array<{ name: string }>} files
 * @param {string | null} name the task's person, null for anyone on the project
 */
export const pickerShareText = (files, name) =>
  shareText({ files, personName: name, anyone: !name });

/**
 * The picked files Attach would let the task's person open though they are "Only PM and Admins":
 * the share confirm shows when there are any (none when the person is the viewer, the PM or an
 * Admin; null, anyone on the project, always asks).
 * @param {object[]} files the picker's files
 * @param {number[]} pickedIds
 * @param {{ id: number, role?: string, status?: string } | null} assignee
 * @param {{ id: number, pmId: number | null }} project
 */
export function pickedToShare(files, pickedIds, assignee, project) {
  const picked = (files ?? []).filter((file) => pickedIds.includes(file.id));
  return filesToShare(picked, personOf(assignee), project);
}
