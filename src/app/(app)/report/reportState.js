// Pure helpers for the report editor's state (browser side): turning the API's report into
// editable rows, back into the PUT body, and mapping the API's field errors onto rows. The hours
// boxes (exact minutes, shown as '2h 15m') are read and written by reportHours.js. A line carried
// from a past report's open task (CONTRACT 24) keeps `carriedFromTaskId`; reportCarry.js decides
// which lines get it.
import { entryMinutes, timeText, timeToSend } from './reportHours';
import { isPlannedRow } from './reportPlanned';

let counter = 0;

/** A stable key for a row that may not have a database id yet. */
export function newKey(prefix) {
  counter += 1;
  return `${prefix}${counter}`;
}

/** 'p12' or 'r3': one key per project or project request, to spot duplicates. */
export function projectKey(item) {
  if (item.projectId) return `p${item.projectId}`;
  if (item.projectRequestId) return `r${item.projectRequestId}`;
  return null;
}

/** The fields of a line's priority task link (CONTRACT section 13); all null when unlinked. */
export const NO_LINK = { projectTaskId: null, priority: null, projectTaskTitle: null };

function taskFromView(task) {
  return {
    key: newKey('t'),
    id: task.id,
    title: task.title ?? '',
    status: task.status,
    carried: Boolean(task.carriedFromTaskId),
    carriedFromTaskId: task.carriedFromTaskId ?? null,
    projectTaskId: task.projectTaskId ?? null,
    priority: task.projectTaskId ? (task.priority ?? null) : null,
    projectTaskTitle: task.projectTaskId ? (task.projectTaskTitle ?? null) : null,
    // The timer note the line was filled from (CONTRACT 21): never shown, sent back on save.
    timerNote: task.timerNote ?? null,
  };
}

/** An API entry's minutes (older copies only had hours). */
function viewMinutes(entry) {
  const minutes = Number(entry.minutes);
  if (entry.minutes !== null && entry.minutes !== undefined && Number.isFinite(minutes)) {
    return Math.round(minutes);
  }
  return Math.round((Number(entry.hours) || 0) * 60);
}

/** The API's report -> editor rows. */
export function entriesFromView(view) {
  return (view?.entries ?? []).map((entry) => {
    const minutes = viewMinutes(entry);
    return {
      key: newKey('e'),
      id: entry.id,
      projectId: entry.projectId ?? null,
      projectRequestId: entry.projectRequestId ?? null,
      projectName: entry.projectName,
      projectColor: entry.projectColor ?? null,
      isUrgent: Boolean(entry.isUrgent),
      waitingForApproval: Boolean(entry.waitingForApproval),
      hours: timeText(minutes),
      savedMinutes: minutes,
      tasks: entry.tasks.map(taskFromView),
    };
  });
}

/**
 * A new card for a picked project, with one empty task row ready to type in.
 * @param {object} pick the project picker's pick
 * @param {string} [taskStatus] that row's status (the person's "New tasks start as")
 */
export function newEntry(pick, taskStatus) {
  return {
    key: newKey('e'),
    id: null,
    projectId: pick.projectId ?? null,
    projectRequestId: pick.projectRequestId ?? null,
    projectName: pick.name,
    projectColor: pick.color ?? null,
    isUrgent: Boolean(pick.isUrgent),
    waitingForApproval: Boolean(pick.projectRequestId),
    hours: '',
    savedMinutes: 0,
    tasks: [newTask(taskStatus)],
  };
}

const TASK_STATUSES = new Set(['done', 'in_progress', 'blocked']);

/**
 * An empty task line. Lines added by hand start with the person's "New tasks start as"
 * (CONTRACT 21); lines from timers set their own status (and their timer note), and anything
 * else is In progress.
 * @param {string} [status]
 */
export function newTask(status) {
  return {
    key: newKey('t'),
    id: null,
    title: '',
    status: TASK_STATUSES.has(status) ? status : 'in_progress',
    carried: false,
    carriedFromTaskId: null,
    ...NO_LINK,
    timerNote: null,
  };
}

/** A carried line not saved yet: the server checks its link (same project) when it inserts it. */
const carriedUnsaved = (task) => Boolean(task.carriedFromTaskId && !task.id);

/**
 * A line no longer carried (CONTRACT 24). A saved line that was sent again as a new row to become
 * carried (reportCarry.js) gets its own id back.
 */
export function uncarried(task) {
  const line = { ...task, id: task.id ?? task.replacedId ?? null };
  delete line.replacedId;
  return { ...line, carried: false, carriedFromTaskId: null, typed: false };
}

/**
 * Whether a line holds something that belongs to its card's project: a link, a timer note, or a
 * carry not saved yet.
 */
function tiedToProject(task) {
  return Boolean(task.projectTaskId || task.timerNote || carriedUnsaved(task));
}

function unlinked(task) {
  const line = { ...task, ...NO_LINK, timerNote: null };
  return carriedUnsaved(task) ? uncarried(line) : line;
}

/**
 * The tasks with every priority link and timer note removed (the card moved to another project:
 * both belonged to the old one, CONTRACT 13 and 21), and unsaved carries too (a carried line
 * must stay on its source's project, CONTRACT 24).
 */
export function unlinkTasks(tasks) {
  return tasks.some(tiedToProject)
    ? tasks.map((task) => (tiedToProject(task) ? unlinked(task) : task))
    : tasks;
}

export const MAX_SUGGESTIONS = 6;

/**
 * The priority tasks to suggest while a line is typed: those whose title holds every word typed
 * (all of them for an empty line), leaving out tasks other lines of the card already link to.
 * Keeps the order given (P1 first).
 * @param {Array<{ id: number, title: string, priority: string, forYou: boolean }>} suggestions
 * @param {string} title what the line says now
 * @param {Set<number>} [taken] priority task ids linked on other lines
 */
export function matchSuggestions(suggestions, title, taken = new Set()) {
  const words = String(title ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return (suggestions ?? [])
    .filter((item) => !taken.has(item.id))
    .filter((item) => {
      const text = item.title.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * Editor rows -> the PUT / submit body, plus the row keys in the same order (to map ids and
 * field errors from the answer back onto rows).
 * @param {object[]} entries
 * @param {{ keepLastValid?: boolean }} [options] see timeToSend
 */
export function serialize(entries, { keepLastValid = false } = {}) {
  const keys = [];
  const body = entries.map((entry) => {
    keys.push({ entryKey: entry.key, taskKeys: entry.tasks.map((task) => task.key) });
    return {
      id: entry.id ?? undefined,
      projectId: entry.projectId ?? undefined,
      projectRequestId: entry.projectRequestId ?? undefined,
      ...timeToSend(entry, { keepLastValid }),
      tasks: entry.tasks.map((task) => ({
        id: task.id ?? undefined,
        title: task.title,
        status: task.status,
        projectTaskId: task.projectTaskId ?? undefined,
        // Left out (undefined) for lines that weren't filled from a timer note.
        timerNote: task.timerNote ?? undefined,
        // Only a new line can become carried (the save checks it on insert, CONTRACT 24).
        carriedFromTaskId: task.id ? undefined : (task.carriedFromTaskId ?? undefined),
      })),
    };
  });
  return { body, keys };
}

/**
 * A line as the save inserted it: a carry the server didn't accept (CONTRACT 24: not the
 * person's open task, closed meanwhile, carried by another line) is dropped, so the card doesn't
 * say "Carried over" for it.
 */
function asSaved(task, saved) {
  const line = { ...task, id: saved.id };
  delete line.replacedId;
  const refused =
    line.carriedFromTaskId && 'carriedFromTaskId' in saved && !saved.carriedFromTaskId;
  return refused ? uncarried(line) : line;
}

/**
 * Copies database ids from a saved report onto the rows that were sent, by position. Rows added
 * or changed since then keep their local state; only missing ids are filled in. A line that is
 * waiting to be sent again as a carried row (`replacedId`, reportCarry.js) doesn't take back the
 * id it gave up.
 */
export function applySavedIds(entries, keys, view) {
  const ids = new Map();
  const savedTasks = new Map();
  keys.forEach((sent, i) => {
    const saved = view.entries[i];
    if (!saved) return;
    ids.set(sent.entryKey, saved.id);
    sent.taskKeys.forEach((taskKey, j) => {
      if (saved.tasks[j]) savedTasks.set(taskKey, saved.tasks[j]);
    });
  });
  let changed = false;
  const next = entries.map((entry) => {
    const entryId = ids.get(entry.key);
    const tasks = entry.tasks.map((task) => {
      const saved = savedTasks.get(task.key);
      const taskId = saved?.id;
      if (!taskId || task.id === taskId || task.replacedId === taskId) return task;
      changed = true;
      return asSaved(task, saved);
    });
    const idChanged = entryId && entry.id !== entryId;
    if (idChanged) changed = true;
    return idChanged || tasks.some((task, j) => task !== entry.tasks[j])
      ? { ...entry, id: entryId ?? entry.id, tasks }
      : entry;
  });
  return changed ? next : entries;
}

export const NO_ERRORS = { general: [], entries: {}, tasks: {} };

/** An entry field's error -> the place on the card that shows it (anything else: the project). */
const ENTRY_SLOTS = new Map([
  ['hours', 'hours'],
  ['minutes', 'hours'],
  ['tasks', 'tasks'],
]);

/**
 * The API's `fields` map ('entries.0.hours', 'entries.1.tasks.0.title', 'total', ...) -> errors
 * keyed by row, using the keys that were sent.
 */
export function mapFieldErrors(fields, keys, fallbackMessage) {
  const errors = { general: [], entries: {}, tasks: {} };
  for (const [path, message] of Object.entries(fields ?? {})) {
    const match = /^entries\.(\d+)(?:\.(\w+))?(?:\.(\d+)(?:\.(\w+))?)?$/.exec(path);
    const sent = match ? keys[Number(match[1])] : null;
    if (!sent) {
      errors.general.push(message);
      continue;
    }
    const [, , field, taskIndex] = match;
    if (field === 'tasks' && taskIndex !== undefined) {
      const taskKey = sent.taskKeys[Number(taskIndex)];
      if (taskKey) errors.tasks[taskKey] = message;
      else errors.general.push(message);
    } else {
      // The time goes as `minutes` (or `hours` when it couldn't be read): both are the hours box.
      const slot = ENTRY_SLOTS.get(field) ?? 'project';
      errors.entries[sent.entryKey] = { ...errors.entries[sent.entryKey], [slot]: message };
    }
  }
  if (
    errors.general.length === 0 &&
    Object.keys(errors.entries).length === 0 &&
    Object.keys(errors.tasks).length === 0 &&
    fallbackMessage
  ) {
    errors.general.push(fallbackMessage);
  }
  return errors;
}

/** Removes the errors of one row field once the person changes it. */
export function clearError(errors, { entryKey, field, taskKey }) {
  if (taskKey && errors.tasks[taskKey]) {
    const tasks = { ...errors.tasks };
    delete tasks[taskKey];
    return { ...errors, tasks };
  }
  if (entryKey && field && errors.entries[entryKey]?.[field]) {
    const entry = { ...errors.entries[entryKey] };
    delete entry[field];
    return { ...errors, entries: { ...errors.entries, [entryKey]: entry } };
  }
  return errors;
}

/**
 * Entries shaped for formatReport() (the Slack preview). Planned projects (0 minutes, no Done
 * line) are left out, as the server leaves them out of the post (CONTRACT 24).
 */
export function previewEntries(entries) {
  return entries
    .filter((entry) => !isPlannedRow(entry))
    .map((entry) => ({
      projectName: entry.projectName,
      minutes: entryMinutes(entry),
      tasks: entry.tasks,
    }));
}
