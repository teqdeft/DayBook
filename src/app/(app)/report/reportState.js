// Pure helpers for the report editor's state (browser side): turning the API's report into
// editable rows, back into the PUT body, and mapping the API's field errors onto rows.

let counter = 0;

/** A stable key for a row that may not have a database id yet. */
export function newKey(prefix) {
  counter += 1;
  return `${prefix}${counter}`;
}

export const HOURS_MAX = 24;

/**
 * Hours as typed ('1.5', '1,5', '') -> { value } or { error }. '' counts as 0 while drafting.
 * @returns {{ value: number } | { error: string }}
 */
export function parseHours(text) {
  const raw = String(text ?? '')
    .trim()
    .replace(',', '.');
  if (raw === '') return { value: 0 };
  if (!/^\d*\.?\d*$/.test(raw) || raw === '.') {
    return { error: 'Enter hours as a number, like 1.5.' };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: 'Enter hours as a number, like 1.5.' };
  if (value > HOURS_MAX) return { error: `Hours must be ${HOURS_MAX} or less.` };
  if (Math.abs(value * 4 - Math.round(value * 4)) > 1e-9) {
    return { error: 'Use steps of 0.25 hours, like 1.5 or 1.75.' };
  }
  return { value };
}

/** 2 -> '2', 1.5 -> '1.5', 0 -> '' (the field shows a 0 placeholder). */
export function hoursText(hours) {
  const value = Number(hours) || 0;
  return value === 0 ? '' : String(Number(value.toFixed(2)));
}

/**
 * The hours an entry counts as in the totals and the Slack preview: what is typed when valid,
 * else the last valid value.
 */
export function entryHours(entry) {
  const parsed = parseHours(entry.hours);
  return 'value' in parsed ? parsed.value : entry.savedHours;
}

/**
 * The hours a save sends: the number when the field is valid, else the text exactly as shown, so
 * the server refuses it under that field instead of quietly saving an older value. Only the
 * keepalive save on leaving the page (`keepLastValid`) falls back to the last valid value, so
 * the rest of a draft still saves when the person leaves with a field still wrong.
 * @returns {number | string}
 */
export function hoursToSend(entry, { keepLastValid = false } = {}) {
  const parsed = parseHours(entry.hours);
  if ('value' in parsed) return parsed.value;
  return keepLastValid ? entry.savedHours : String(entry.hours ?? '').trim();
}

/** The first hours field a save can't accept, or null: { entryKey, message }. */
export function firstHoursError(entries) {
  for (const entry of entries) {
    const parsed = parseHours(entry.hours);
    if ('error' in parsed) return { entryKey: entry.key, message: parsed.error };
  }
  return null;
}

export function totalMinutes(entries) {
  return entries.reduce((sum, entry) => sum + Math.round(entryHours(entry) * 60), 0);
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
    projectTaskId: task.projectTaskId ?? null,
    priority: task.projectTaskId ? (task.priority ?? null) : null,
    projectTaskTitle: task.projectTaskId ? (task.projectTaskTitle ?? null) : null,
  };
}

/** The API's report -> editor rows. */
export function entriesFromView(view) {
  return (view?.entries ?? []).map((entry) => ({
    key: newKey('e'),
    id: entry.id,
    projectId: entry.projectId ?? null,
    projectRequestId: entry.projectRequestId ?? null,
    projectName: entry.projectName,
    projectColor: entry.projectColor ?? null,
    isUrgent: Boolean(entry.isUrgent),
    waitingForApproval: Boolean(entry.waitingForApproval),
    hours: hoursText(entry.hours),
    savedHours: Number(entry.hours) || 0,
    tasks: entry.tasks.map(taskFromView),
  }));
}

/** A new card for a picked project, with one empty task row ready to type in. */
export function newEntry(pick) {
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
    savedHours: 0,
    tasks: [newTask()],
  };
}

export function newTask() {
  return {
    key: newKey('t'),
    id: null,
    title: '',
    status: 'in_progress',
    carried: false,
    ...NO_LINK,
  };
}

/** The tasks with every priority link removed (the card moved to another project). */
export function unlinkTasks(tasks) {
  return tasks.some((task) => task.projectTaskId)
    ? tasks.map((task) => (task.projectTaskId ? { ...task, ...NO_LINK } : task))
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
 * @param {{ keepLastValid?: boolean }} [options] see hoursToSend
 */
export function serialize(entries, { keepLastValid = false } = {}) {
  const keys = [];
  const body = entries.map((entry) => {
    keys.push({ entryKey: entry.key, taskKeys: entry.tasks.map((task) => task.key) });
    return {
      id: entry.id ?? undefined,
      projectId: entry.projectId ?? undefined,
      projectRequestId: entry.projectRequestId ?? undefined,
      hours: hoursToSend(entry, { keepLastValid }),
      tasks: entry.tasks.map((task) => ({
        id: task.id ?? undefined,
        title: task.title,
        status: task.status,
        projectTaskId: task.projectTaskId ?? undefined,
      })),
    };
  });
  return { body, keys };
}

/**
 * Copies database ids from a saved report onto the rows that were sent, by position. Rows added
 * or changed since then keep their local state; only missing ids are filled in.
 */
export function applySavedIds(entries, keys, view) {
  const ids = new Map();
  keys.forEach((sent, i) => {
    const saved = view.entries[i];
    if (!saved) return;
    ids.set(sent.entryKey, saved.id);
    sent.taskKeys.forEach((taskKey, j) => {
      if (saved.tasks[j]) ids.set(taskKey, saved.tasks[j].id);
    });
  });
  let changed = false;
  const next = entries.map((entry) => {
    const entryId = ids.get(entry.key);
    const tasks = entry.tasks.map((task) => {
      const taskId = ids.get(task.key);
      if (!taskId || task.id === taskId) return task;
      changed = true;
      return { ...task, id: taskId };
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
      const slot = field === 'hours' || field === 'tasks' ? field : 'project';
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

/** Entries shaped for formatReport() (the Slack preview). */
export function previewEntries(entries) {
  return entries.map((entry) => ({
    projectName: entry.projectName,
    minutes: Math.round(entryHours(entry) * 60),
    tasks: entry.tasks,
  }));
}
