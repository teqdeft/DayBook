// What the New task and Edit task window works with (CONTRACT 27, Board tab), without React: the
// lists it offers, its first values, the request a save sends (everything for a new task, only what
// changed for an edit, plus the files), and every sentence it says. Pure and safe in the browser.
import { plural } from '@/lib/text';
import { PROJECT_PHASES, isPhase, phaseLabel } from '@/modules/projectPlan/phases';
import { NO_PHASE_LABEL, awayLabel } from '../phasesView';

export const TITLE_ERROR = 'Write a title of at least 2 characters.';
export const NOTE_MAX = 1000;
const NOTE_COUNT_FROM = 800;

/** The upload states that are still on their way (useUploads' items). */
export const RUNNING_STATES = ['waiting', 'uploading', 'retrying'];

export const PRIORITY_OPTIONS = [
  { value: 'p1', label: 'P1 critical' },
  { value: 'p2', label: 'P2' },
  { value: 'p3', label: 'P3' },
];

/** The six phases; "No phase yet" only when editing a task that has none. */
export function phaseOptions(task) {
  const options = PROJECT_PHASES.map(({ key, label }) => ({ value: key, label }));
  if (task && !isPhase(task.phase)) options.push({ value: '', label: NO_PHASE_LABEL });
  return options;
}

/**
 * Who the task can be for: "Anyone on the project" first, then the people (the viewer as "Riya
 * Kapoor (you)"), plus the task's owner when they can't be picked any more, with why.
 * @param {Array<{ id: number, name: string }>} options listAssigneeOptions
 * @param {{ assignee?: { id: number, name: string, away?: string | null } | null } | null} task
 * @param {number | null} [viewerId]
 */
export function ownerOptions(options, task, viewerId = null) {
  const list = [
    { value: '', label: 'Anyone on the project' },
    ...options.map((person) => ({
      value: String(person.id),
      label: Number(person.id) === Number(viewerId) ? `${person.name} (you)` : person.name,
    })),
  ];
  const current = task?.assignee;
  if (current && !options.some((person) => Number(person.id) === Number(current.id))) {
    const why = current.away ? ` (${current.away.toLowerCase()})` : '';
    list.push({ value: String(current.id), label: `${current.name}${why}` });
  }
  return list;
}

/**
 * A task to edit, from a board card or from the task window's details, in one shape.
 * @returns {{ id, title, details, priority, phase, dueDate,
 *   assignee: { id, name, away } | null }}
 */
export function editable(task) {
  const assignee = task.assignee
    ? {
        id: task.assignee.id,
        name: task.assignee.name,
        away: task.assignee.away !== undefined ? task.assignee.away : awayLabel(task.assignee),
      }
    : null;
  return {
    id: task.id,
    title: task.title ?? '',
    details: task.details ?? null,
    priority: task.priority ?? 'p2',
    phase: isPhase(task.phase) ? task.phase : null,
    dueDate: task.dueDate ?? null,
    assignee,
  };
}

/**
 * The window's first values.
 * @param {{ task?: object | null, preset?: { phase?: string, title?: string },
 *   currentPhase: string | null }} args task: editable(); preset: a column's phase and a typed
 *   title (quick add's "More options")
 */
export function initialValues({ task = null, preset = {}, currentPhase }) {
  if (task) {
    return {
      title: task.title,
      details: task.details ?? '',
      owner: task.assignee ? String(task.assignee.id) : '',
      dueDate: task.dueDate ?? '',
      phase: task.phase ?? '',
      priority: task.priority,
    };
  }
  const phase = [preset.phase, currentPhase].find(isPhase) ?? PROJECT_PHASES[0].key;
  return { title: preset.title ?? '', details: '', owner: '', dueDate: '', phase, priority: 'p2' };
}

/** The values as the API takes them. */
function apiValues(values) {
  return {
    title: values.title.trim(),
    details: values.details.trim() || null,
    assigneeId: values.owner ? Number(values.owner) : null,
    phase: values.phase || null,
    dueDate: values.dueDate || null,
    priority: values.priority,
  };
}

/** A new task's body: everything, with the held upload keys. */
export function createBody(values, uploadKeys = []) {
  return { ...apiValues(values), uploadKeys: [...uploadKeys] };
}

/**
 * An edit's body: only what changed, plus the files added and the attached ones marked removed.
 * @returns {object} empty when nothing changed
 */
export function editBody(values, task, { addUploadKeys = [], removeFileIds = [] } = {}) {
  const before = {
    title: task.title,
    details: task.details ?? null,
    assigneeId: task.assignee?.id ?? null,
    phase: task.phase ?? null,
    dueDate: task.dueDate ?? null,
    priority: task.priority,
  };
  const body = Object.fromEntries(
    Object.entries(apiValues(values)).filter(([key, value]) => value !== before[key]),
  );
  if (addUploadKeys.length > 0) body.addUploadKeys = [...addUploadKeys];
  if (removeFileIds.length > 0) body.removeFileIds = [...removeFileIds];
  return body;
}

/** The title's error, or null when it has at least 2 characters. */
export function titleError(title) {
  return String(title ?? '').trim().length < 2 ? TITLE_ERROR : null;
}

/** "812 of 1,000" once the note is past 800 characters, else null. */
export function noteCount(details) {
  const length = String(details ?? '').length;
  return length > NOTE_COUNT_FROM ? `${length.toLocaleString('en-IN')} of 1,000` : null;
}

/** Who a save told: the person's name, "Everyone on the project", or null (nobody). */
export function toldWho(told, toldName) {
  if (told === 'person') return toldName || null;
  if (told === 'members') return 'Everyone on the project';
  return null;
}

/**
 * The toast after adding a task.
 * @param {{ phase: string | null, told?: string | null, toldName?: string | null,
 *   files?: number }} args
 */
export function addedToast({ phase, told, toldName, files = 0 }) {
  const title = `Task added to ${isPhase(phase) ? phaseLabel(phase) : NO_PHASE_LABEL}.`;
  const who = toldWho(told, toldName);
  if (!who) return { title };
  const names = files > 0 ? ` with the ${files === 1 ? 'file name' : `${files} file names`}` : '';
  return { title, body: `${who} gets a notification${names}.` };
}

/**
 * The toast after an edit: "Changes saved." and what happened to the files.
 * @param {{ told?: string | null, toldName?: string | null, added?: number, removed?: number }} args
 */
export function savedToast({ told, toldName, added = 0, removed = 0 }) {
  const who = toldWho(told, toldName);
  const isTold = who ? ` ${who} is told.` : '';
  let body = null;
  if (added && removed)
    body = `${added} ${plural(added, 'file')} added and ${removed} removed.${isTold}`;
  else if (added) body = `${added} ${plural(added, 'file')} added.${isTold}`;
  else if (removed) body = `${removed} ${plural(removed, 'file')} removed.`;
  return body ? { title: 'Changes saved.', body } : { title: 'Changes saved.' };
}

/**
 * What a save sends: a new task with its held upload keys; an edit with only what changed, the
 * files added and the attached ones marked removed (none of either when its files didn't load).
 * @param {{ task: object | null, projectId: number, values: object, readyKeys: string[],
 *   removedIds: number[], attachedError: boolean }} input
 * @returns {['post' | 'patch', string, object]} the method, the path and the body
 */
export function saveRequest({ task, projectId, values, readyKeys, removedIds, attachedError }) {
  const keys = attachedError ? [] : readyKeys;
  if (!task) return ['post', `/api/projects/${projectId}/tasks`, createBody(values, keys)];
  const removeFileIds = attachedError ? [] : removedIds;
  const body = editBody(values, task, { addUploadKeys: keys, removeFileIds });
  return ['patch', `/api/project-tasks/${task.id}`, body];
}

/**
 * What the editor is told after a save: the task, whether it was an edit, and its toast (who was
 * told, from the answer's `told` and `toldName`).
 * @param {{ data: object | null, task: object | null, body: object }} input
 * @returns {{ id: number, edited: boolean, toast: { title: string, body?: string } }}
 */
export function savedResult({ data, task, body }) {
  const added = body.uploadKeys?.length ?? body.addUploadKeys?.length ?? 0;
  const told = { told: data?.told ?? null, toldName: data?.toldName ?? null };
  return {
    id: data?.id ?? task?.id,
    edited: Boolean(task),
    toast: task
      ? savedToast({ ...told, added, removed: body.removeFileIds?.length ?? 0 })
      : addedToast({ ...told, phase: body.phase, files: added }),
  };
}

/** The upload items that block a save or a close, counted. */
export function uploadCounts(items = []) {
  return {
    running: items.filter((item) => RUNNING_STATES.includes(item.state)).length,
    unsaved: items.filter((item) => item.state !== 'error').length,
    paused: items.find((item) => item.state === 'paused') ?? null,
  };
}

/** "Uploading 2 files…" */
export const uploadingLabel = (count) => `Uploading ${count} ${plural(count, 'file')}…`;

/** "2 files aren't saved yet. Close anyway?", or "... are still uploading" while any runs. */
export function closeQuestion({ unsaved, running }) {
  const one = unsaved === 1;
  const what =
    running > 0
      ? one
        ? 'is still uploading'
        : 'are still uploading'
      : one
        ? "isn't saved yet"
        : "aren't saved yet";
  return `${unsaved} ${plural(unsaved, 'file')} ${what}. Close anyway?`;
}

/** The line under the Files field when a paused file blocks the save. */
export const pausedLine = (name) => `${name} didn't finish uploading. Press Retry or remove it.`;

const FIELDS = ['title', 'details', 'assigneeId', 'dueDate', 'phase', 'priority'];
const FILE_FIELDS = ['uploadKeys', 'addUploadKeys', 'removeFileIds'];

/**
 * A failed save as the window shows it: under a field, under Files, or as a toast.
 * @returns {{ field: string | null, files: string | null, message: string }}
 */
export function saveError(failure) {
  const fields = failure?.fields ?? {};
  const field = FIELDS.find((key) => fields[key]);
  if (field) return { field, files: null, message: fields[field] };
  const fileField = FILE_FIELDS.find((key) => fields[key]);
  if (fileField) return { field: null, files: fields[fileField], message: fields[fileField] };
  return { field: null, files: null, message: failure?.message ?? '' };
}
