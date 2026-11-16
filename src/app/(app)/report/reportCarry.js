// Unfinished tasks from past reports in the report editor (CONTRACT 24, browser side, pure):
// which suggestions still show, the line "Add to today" makes, a typed title equal to a
// suggestion's, and the project names the reminder line and the Still open dialog show. The page
// sends `data.carrySuggestions` = { [projectKey]: [{ taskId, title, status, workDate, dayLabel }] }
// ('p12' a project, 'r4' a project request), empty while carry forward is off.
import { normalizeTitle } from '@/modules/reports/todoText';
import { newTask, projectKey, uncarried } from './reportState';

const NO_IDS = new Set();

/** Every task id a line of the report is carried from. */
export function claimedTaskIds(entries) {
  const ids = new Set();
  for (const entry of entries) {
    for (const task of entry.tasks) {
      if (task.carriedFromTaskId) ids.add(Number(task.carriedFromTaskId));
    }
  }
  return ids;
}

/** projectKey -> the normalised titles of the report's lines on that project. */
function titlesByProject(entries) {
  const titles = new Map();
  for (const entry of entries) {
    const key = projectKey(entry);
    if (!key) continue;
    const set = titles.get(key) ?? new Set();
    for (const task of entry.tasks) {
      const title = normalizeTitle(task.title);
      if (title) set.add(title);
    }
    titles.set(key, set);
  }
  return titles;
}

/**
 * The suggestions still to show, per project: a suggestion disappears once a line is carried
 * from it, a line on its project has the same normalised title, or it was closed on this page.
 * Projects left with none are left out.
 * @param {Record<string, object[]>} all the page's suggestions (and any put back by Undo)
 * @param {object[]} entries the editor rows
 * @param {Set<number>} [closed] task ids marked Done already or Not needed here
 * @returns {Record<string, object[]>}
 */
export function openSuggestions(all, entries, closed = NO_IDS) {
  const claimed = claimedTaskIds(entries);
  const titles = titlesByProject(entries);
  const open = {};
  for (const [key, items] of Object.entries(all ?? {})) {
    const taken = titles.get(key);
    const left = (items ?? []).filter((item) => {
      const id = Number(item.taskId);
      return !closed.has(id) && !claimed.has(id) && !taken?.has(normalizeTitle(item.title));
    });
    if (left.length) open[key] = left;
  }
  return open;
}

/** { [projectKey]: how many } for the picker's "2 still open". */
export function openCounts(suggestions) {
  return Object.fromEntries(Object.entries(suggestions).map(([key, items]) => [key, items.length]));
}

/**
 * A new line from a suggestion ("Add to today"): its title and status (In progress or Blocked,
 * whatever "New tasks start as" says), carried from it, so the save copies the source's first
 * day, priority task and timer note (CONTRACT 24).
 */
export function carriedTask(item) {
  return {
    ...newTask(item.status),
    title: item.title,
    carried: true,
    carriedFromTaskId: Number(item.taskId),
  };
}

/** A row with nothing in it yet (the empty line of a new card): carried lines take its place. */
const isBlank = (task) => !String(task.title ?? '').trim() && !task.projectTaskId;

/** A card's lines with new ones (carriedTask) added at the end, in place of its blank rows. */
export function withCarriedTasks(tasks, added) {
  return [...tasks.filter((task) => !isBlank(task)), ...added];
}

/** taskKey -> { title, key } of the rows before a change. */
function linesBefore(entries) {
  const before = new Map();
  for (const entry of entries) {
    const key = projectKey(entry);
    for (const task of entry.tasks) before.set(task.key, { title: task.title, key });
  }
  return before;
}

/**
 * One line that was typed or moved: carried when its title equals a free suggestion of its
 * project; a line carried that way and not saved yet goes back once the title stops matching.
 * A saved line can only become carried as a new row (the server sets the link on insert only):
 * with `reinsert` (drafts) it is sent without its id, which deletes the old row in the same save,
 * and `replacedId` gets the id back if the title changes again before the save.
 */
function relink(task, items, { claimed, closed, reinsert }) {
  let line = task;
  const title = normalizeTitle(line.title);
  if (line.typed && line.id === null) {
    const source = items.find((item) => Number(item.taskId) === Number(line.carriedFromTaskId));
    if (source && normalizeTitle(source.title) === title) return line;
    claimed.delete(Number(line.carriedFromTaskId));
    line = uncarried(line);
  }
  if (line.carriedFromTaskId || !title || (line.id && !reinsert)) return line;
  const match = items.find((item) => {
    const id = Number(item.taskId);
    return !closed.has(id) && !claimed.has(id) && normalizeTitle(item.title) === title;
  });
  if (!match) return line;
  claimed.add(Number(match.taskId));
  const replaced = line.id ? { replacedId: line.id } : null;
  return {
    ...line,
    ...replaced,
    id: null,
    carried: true,
    carriedFromTaskId: Number(match.taskId),
    typed: true,
  };
}

/**
 * A typed (or pasted, or filled) title equal to a suggestion's on the same project makes that
 * line carried (CONTRACT 24). Only lines that are new, retitled or moved to another project in
 * this change are looked at, so opening a report never relinks what is already there. A
 * suggestion is claimed by one line at most, and a closed one never.
 * @param {object[]} previous the rows before the change
 * @param {object[]} next the rows after it
 * @param {Record<string, object[]>} all every suggestion of the page
 * @param {{ closed?: Set<number>, reinsert?: boolean }} [options] reinsert: the report is a draft
 * @returns {object[]} `next`, or a copy with the links set
 */
export function linkTypedTitles(previous, next, all, { closed = NO_IDS, reinsert = false } = {}) {
  if (next === previous || !all) return next;
  const before = linesBefore(previous);
  const state = { claimed: claimedTaskIds(next), closed, reinsert };
  let changed = false;
  const linked = next.map((entry) => {
    const key = projectKey(entry);
    const items = (key && all[key]) || [];
    let touched = false;
    const tasks = entry.tasks.map((task) => {
      const was = before.get(task.key);
      if (was && was.title === task.title && was.key === key) return task;
      if (!items.length && !task.typed) return task;
      const line = relink(task, items, state);
      if (line !== task) touched = true;
      return line;
    });
    if (!touched) return entry;
    changed = true;
    return { ...entry, tasks };
  });
  return changed ? linked : next;
}

/**
 * projectKey -> what the picker knows of it: { project: { id, name, color, isUrgent } } or
 * { request: { id, name } }. Suggestions on a project the picker doesn't list are not shown.
 */
export function pickerIndex(picker) {
  const index = new Map();
  for (const item of [
    ...(picker?.urgent ?? []),
    ...(picker?.mine ?? []),
    ...(picker?.others ?? []),
  ]) {
    const { id, name, color, isUrgent } = item;
    index.set(`p${id}`, {
      project: { id, name, color: color ?? null, isUrgent: Boolean(isUrgent) },
    });
  }
  for (const item of picker?.requests ?? []) {
    index.set(`r${item.requestId}`, { request: { id: item.requestId, name: item.name } });
  }
  return index;
}

/**
 * The Still open dialog's groups, in the suggestions' order (projects with the newest task
 * first): [{ key, project | request, items }].
 */
export function suggestionGroups(suggestions, index) {
  return Object.entries(suggestions)
    .filter(([key]) => index.has(key))
    .map(([key, items]) => ({ key, ...index.get(key), items }));
}

/** "Acme booking app (2)" for each project with suggestions that isn't in the report. */
export function reminderItems(groups, entries) {
  const inReport = new Set(entries.map(projectKey).filter(Boolean));
  return groups
    .filter((group) => !inReport.has(group.key))
    .map((group) => ({
      key: group.key,
      label: `${(group.project ?? group.request).name} (${group.items.length})`,
    }));
}

/** The picker's pick for a group, to open a card for it. */
export function pickOf(group) {
  if (group.request) {
    return { projectRequestId: group.request.id, name: group.request.name, color: null };
  }
  const { id, name, color, isUrgent } = group.project;
  return { projectId: id, name, color, isUrgent };
}

/**
 * The page's suggestions with those put back by Undo after the page was read again (so they are
 * no longer in `all`), newest first like the rest.
 */
export function withRestored(all, restored) {
  const keys = Object.keys(restored ?? {});
  if (keys.length === 0) return all ?? {};
  const merged = { ...all };
  for (const key of keys) {
    const list = [...(merged[key] ?? [])];
    for (const item of restored[key]) {
      if (!list.some((other) => Number(other.taskId) === Number(item.taskId))) list.push(item);
    }
    merged[key] = list.sort((a, b) => String(b.workDate).localeCompare(String(a.workDate)));
  }
  return merged;
}
