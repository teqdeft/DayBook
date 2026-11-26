// What the New task and Edit task window works with (CONTRACT 27, Board tab; CONTRACT 28, New task
// and Edit task), without React: the lists it offers, its first values, the request a save sends
// (everything for a new task, only what changed for an edit, plus the uploads, the project files
// it links and unlinks, and the share confirm), and every sentence it says. The "Assign to" chips
// and the share rules are in taskFormAssign.js, the toasts in taskFormToasts.js; both are
// re-exported here. Pure and safe in the browser.
import { plural } from '@/lib/text';
import { PROJECT_PHASES, isPhase } from '@/modules/projectPlan/phases';
import { NO_PHASE_LABEL } from '../phasesView';

export {
  ANYONE_LABEL,
  FIND_FROM,
  assignChoices,
  chosenName,
  chosenPerson,
  editable,
  filesShared,
  findChoices,
  shareAsked,
} from './taskFormAssign';
import { addedToast, savedToast } from './taskFormToasts';

export { addedToast, savedToast };
export { toldBody, toldWho } from './taskFormToasts';

export const TITLE_ERROR = 'Write a title of at least 2 characters.';
export const NOTE_MAX = 1000;
const NOTE_COUNT_FROM = 800;
export const ANYONE_HELP = 'Everyone on the project sees it on their Today page.';
export const TOO_MANY_FILES = 'A task can have up to 20 files. Remove one to add more.';

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

/** The confirm's two fields, when the person confirmed sharing: `shareWith` names them. */
const shareFields = (share) => (share ? { shareConfirmed: true, shareWith: share.shareWith } : {});

/**
 * A new task's body: everything, with the held upload keys, the project files it links and, after
 * the share confirm, `shareConfirmed` and `shareWith` ('' for anyone on the project).
 * @param {object} values
 * @param {string[]} [uploadKeys]
 * @param {{ linkFileIds?: number[], share?: { shareWith: number | '' } | null }} [more]
 */
export function createBody(values, uploadKeys = [], { linkFileIds = [], share = null } = {}) {
  return {
    ...apiValues(values),
    uploadKeys: [...uploadKeys],
    linkFileIds: [...linkFileIds],
    ...shareFields(share),
  };
}

/**
 * An edit's body: only what changed (`assigneeId` only when the checked chip differs from the
 * task's person), plus the uploads added, the files marked removed, the project files linked and
 * unlinked, and the confirm's fields.
 * @returns {object} empty when nothing changed
 */
export function editBody(values, task, changes = {}) {
  const { addUploadKeys = [], removeFileIds = [], addLinkFileIds = [] } = changes;
  const { removeLinkFileIds = [], share = null } = changes;
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
  if (addLinkFileIds.length > 0) body.addLinkFileIds = [...addLinkFileIds];
  if (removeLinkFileIds.length > 0) body.removeLinkFileIds = [...removeLinkFileIds];
  if (Object.keys(body).length === 0) return body; // "Nothing to change." ignores the confirm
  return { ...body, ...shareFields(share) };
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

/**
 * What a save sends: a new task with its held upload keys and linked files; an edit with only
 * what changed, the files added and the attached ones marked removed (none of either when its
 * files didn't load).
 * @param {{ task: object | null, projectId: number, values: object, readyKeys: string[],
 *   removedIds: number[], attachedError: boolean,
 *   links?: { add?: number[], remove?: number[] }, share?: { shareWith: number | '' } | null }}
 *   input links: the project files to link (`add`) and, on Edit, to unlink (`remove`)
 * @returns {['post' | 'patch', string, object]} the method, the path and the body
 */
export function saveRequest(input) {
  const { task, projectId, values, readyKeys, removedIds, attachedError } = input;
  const { links = {}, share = null } = input;
  const keys = attachedError ? [] : readyKeys;
  const add = links.add ?? [];
  if (!task) {
    const body = createBody(values, keys, { linkFileIds: add, share });
    return ['post', `/api/projects/${projectId}/tasks`, body];
  }
  const body = editBody(values, task, {
    addUploadKeys: keys,
    removeFileIds: attachedError ? [] : removedIds,
    addLinkFileIds: add,
    removeLinkFileIds: attachedError ? [] : (links.remove ?? []),
    share,
  });
  return ['patch', `/api/project-tasks/${task.id}`, body];
}

/**
 * What the editor is told after a save: the task, its phase, whether it was an edit, and its toast
 * (who was told, from the answer's `told`, `toldName` and `toldEarlierName`).
 * @param {{ data: object | null, task: object | null, body: object }} input
 * @returns {{ id: number, phase: string | null, edited: boolean,
 *   toast: { title: string, body?: string } }}
 */
export function savedResult({ data, task, body }) {
  const uploads = body.uploadKeys?.length ?? body.addUploadKeys?.length ?? 0;
  const linked = body.linkFileIds?.length ?? body.addLinkFileIds?.length ?? 0;
  const removed = (body.removeFileIds?.length ?? 0) + (body.removeLinkFileIds?.length ?? 0);
  const told = {
    told: data?.told ?? null,
    toldName: data?.toldName ?? null,
    toldEarlierName: data?.toldEarlierName ?? null,
  };
  const toast = task
    ? savedToast({ ...told, added: uploads + linked, removed, personChanged: 'assigneeId' in body })
    : addedToast({ ...told, phase: body.phase, files: uploads + linked });
  return {
    id: data?.id ?? task?.id,
    phase: data?.phase ?? body.phase ?? task?.phase ?? null,
    edited: Boolean(task),
    toast,
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
const LINK_FIELDS = ['linkFileIds', 'addLinkFileIds'];
const FILE_FIELDS = ['uploadKeys', 'addUploadKeys', 'removeFileIds', 'removeLinkFileIds'];

/**
 * A failed save as the window shows it: under a field, under Files (a picked project file gone
 * from Files: `gone`), the share confirm again (`share`), or as a toast.
 * @returns {{ field: string | null, files: string | null, message: string, gone?: boolean,
 *   share?: boolean }}
 */
export function saveError(failure) {
  const fields = failure?.fields ?? {};
  const field = FIELDS.find((key) => fields[key]);
  if (field) return { field, files: null, message: fields[field] };
  if (fields.shareConfirmed || fields.shareWith) {
    const message = fields.shareConfirmed ?? fields.shareWith;
    return { field: null, files: null, message, share: true };
  }
  const linkField = LINK_FIELDS.find((key) => fields[key]);
  if (linkField)
    return { field: null, files: fields[linkField], message: fields[linkField], gone: true };
  const fileField = FILE_FIELDS.find((key) => fields[key]);
  if (fileField) return { field: null, files: fields[fileField], message: fields[fileField] };
  return { field: null, files: null, message: failure?.message ?? '' };
}
