// Today's to-do card, pure (CONTRACT 24): the to-do as the card shows it (lines waiting behind an
// Undo toast left out, projects picked but without a line yet added), the changes a write shows at
// once before its answer arrives, the header's count and subtitle, and the Slack button. The to-do
// is reports.getTodo's shape: { editable, submitted, done, total, post, slack, groups: [{ entryId,
// project | request, minutes, lines: [{ id, title, status, done, projectTaskId, now, carriedFrom,
// canStart }] }], suggestions }.
import { formatTimeAmPm } from '@/lib/time';
import { normalizeTitle } from '@/modules/reports/todoText';

/** 'p12' for a project, 'r4' for a project request (the suggestions' keys). */
export function groupKey(group) {
  return group.project ? `p${group.project.id}` : `r${group.request.id}`;
}

/** The project's (or request's) name. */
export const groupName = (group) => (group.project ?? group.request).name;

/** The body fields that name a group's project: { projectId } or { projectRequestId }. */
export function targetOf(group) {
  return group.project ? { projectId: group.project.id } : { projectRequestId: group.request.id };
}

/** The Undo queue's keys: one per line, one per project. */
export const lineUndoKey = (id) => `line:${id}`;
export const projectUndoKey = (entryId) => `project:${entryId}`;

/** A line that isn't saved yet (an add on its way): its id starts with "new". */
export const isPendingLine = (line) => String(line.id).startsWith('new');

function counted(todo, groups) {
  const lines = groups.flatMap((group) => group.lines);
  return { ...todo, groups, done: lines.filter((line) => line.done).length, total: lines.length };
}

/**
 * The to-do as the card shows it: projects and lines removed with Undo still waiting are left
 * out, and projects picked on this page that have no line yet are added at the end (each with
 * `entryId` null). `done` and `total` count what is left.
 * @param {object} todo getTodo
 * @param {(key: string) => boolean} isHidden the Undo queue's hidden keys
 * @param {Array<{ project?: object, request?: object }>} [picked] projects picked on this page
 */
export function visibleTodo(todo, isHidden, picked = []) {
  const groups = todo.groups
    .filter((group) => !group.entryId || !isHidden(projectUndoKey(group.entryId)))
    .map((group) => {
      const lines = group.lines.filter((line) => !isHidden(lineUndoKey(line.id)));
      return lines.length === group.lines.length ? group : { ...group, lines };
    });
  const keys = new Set(todo.groups.map(groupKey));
  const extra = picked
    .filter((group) => !keys.has(groupKey(group)))
    .map((group) => ({ ...group, entryId: null, minutes: 0, lines: [] }));
  return counted(todo, [...groups, ...extra]);
}

/**
 * The line an add shows at once, until the answer brings the saved one.
 * @param {{ id: string, title: string, status?: string, projectTaskId?: number | null,
 *   carriedFrom?: { workDate: string, dayLabel: string } | null }} input
 */
export function pendingLine({ id, title, status = 'in_progress', projectTaskId, carriedFrom }) {
  return {
    id,
    title: String(title).replace(/\s+/g, ' ').trim(),
    status,
    done: status === 'done',
    projectTaskId: projectTaskId ?? null,
    now: false,
    carriedFrom: carriedFrom ?? null,
    canStart: false,
  };
}

/**
 * The to-do with lines added to a project's group, made at the end when the project has none.
 * @param {object} todo
 * @param {{ project?: object, request?: object }} target the group's project or request
 * @param {object[]} lines pendingLine objects
 */
export function withLinesAdded(todo, target, lines) {
  const key = groupKey(target);
  const found = todo.groups.some((group) => groupKey(group) === key);
  const groups = found
    ? todo.groups.map((group) =>
        groupKey(group) === key ? { ...group, lines: [...group.lines, ...lines] } : group,
      )
    : [
        ...todo.groups,
        {
          entryId: null,
          ...(target.project ? { project: target.project } : { request: target.request }),
          minutes: 0,
          lines,
        },
      ];
  return counted(todo, groups);
}

/** The to-do with one line changed (`patch` merged into it). */
export function withLinePatched(todo, id, patch) {
  const groups = todo.groups.map((group) =>
    group.lines.some((line) => line.id === id)
      ? {
          ...group,
          lines: group.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
        }
      : group,
  );
  return counted(todo, groups);
}

/**
 * The to-do without the lines whose ids are given (an add that failed); a group made only for
 * them (not saved, now empty) goes too.
 */
export function withoutLines(todo, ids) {
  const gone = new Set(ids);
  const groups = todo.groups
    .map((group) =>
      group.lines.some((line) => gone.has(line.id))
        ? { ...group, lines: group.lines.filter((line) => !gone.has(line.id)) }
        : group,
    )
    .filter((group) => group.entryId || group.lines.length > 0);
  return counted(todo, groups);
}

/**
 * A line's status after a tick (Done) or an untick: an unticked Done line is In progress again,
 * any other line keeps its status (the server's rule, reports/todoView.tickedStatus).
 */
export function tickedStatus(status, done) {
  if (done) return 'done';
  return status === 'done' ? 'in_progress' : status;
}

/** Whether the to-do takes no more changes here: the report is in, or it locked. */
export const isLocked = (todo) => Boolean(todo.submitted) || !todo.editable;

/** "2 of 5 done". */
export const doneText = (todo) => `${todo.done} of ${todo.total} done`;

/** The header's subtitle. */
export function subtitleOf(todo) {
  if (todo.submitted) return `${doneText(todo)}. Your report is in.`;
  if (!todo.editable) return `${doneText(todo)}.`;
  return "What you'll work on today. It becomes your report.";
}

/**
 * The header's Slack part, or null when it doesn't show (posting is off, the report takes no
 * changes, or the list is empty).
 * @param {{ todo: object, busy: boolean, tz: string }} input busy: a post request is on its way
 * @returns {{ posted: string | null, failed: boolean,
 *   primary: { label: string, busy: boolean } | null,
 *   secondary: { label: string, busy: boolean } | null } | null}
 *   posted: "Posted at 9:41 AM"; primary: "Post to Slack" / "Posting…"; secondary: "Update post",
 *   "Updating…" or "Try again"
 */
export function slackView({ todo, busy, tz }) {
  if (!todo.slack?.canPost || isLocked(todo) || todo.total === 0) return null;
  const post = todo.post ?? { state: 'none' };
  const postedAt = post.postedAt ?? (post.state === 'sent' ? post.at : null);
  const posted = postedAt ? `Posted at ${formatTimeAmPm(postedAt, tz)}` : null;
  const sending = busy || post.state === 'sending';
  if (sending) {
    return posted
      ? { posted, failed: false, primary: null, secondary: { label: 'Updating…', busy: true } }
      : {
          posted: null,
          failed: false,
          primary: { label: 'Posting…', busy: true },
          secondary: null,
        };
  }
  if (post.state === 'failed') {
    return { posted: null, failed: true, primary: null, secondary: { label: 'Try again', busy } };
  }
  if (post.state === 'sent' && posted) {
    const update = post.changed ? { label: 'Update post', busy: false } : null;
    return { posted, failed: false, primary: null, secondary: update };
  }
  return {
    posted: null,
    failed: false,
    primary: { label: 'Post to Slack', busy: false },
    secondary: null,
  };
}

/**
 * The groups as report rows for the suggestions (report/useCarrySuggestions): a suggestion
 * disappears once a line on its project has the same normalised title.
 */
export function carryEntries(groups) {
  return groups.map((group) => ({
    projectId: group.project?.id ?? null,
    projectRequestId: group.request?.id ?? null,
    tasks: group.lines.map((line) => ({ title: line.title, carriedFromTaskId: null })),
  }));
}

/** The suggestion a typed title equals (normalised), or null. */
export function suggestionFor(items, title) {
  const wanted = normalizeTitle(title);
  if (!wanted) return null;
  return (items ?? []).find((item) => normalizeTitle(item.title) === wanted) ?? null;
}

/** Whether the group already has a line with this title (normalised). */
export function hasTitle(group, title) {
  const wanted = normalizeTitle(title);
  return group.lines.some((line) => normalizeTitle(line.title) === wanted);
}

/** The priority task ids the to-do's lines link to ("In to-do" on the Priority tasks card). */
export function linkedTaskIds(todo) {
  const ids = new Set();
  for (const group of todo?.groups ?? []) {
    for (const line of group.lines) if (line.projectTaskId) ids.add(Number(line.projectTaskId));
  }
  return ids;
}

/**
 * Every project the person can pick (the report's picker, its pending project requests too), for
 * the paste dialog's matching and its Select: [{ key, name, project | request }].
 */
export function pickables(picker) {
  const seen = new Set();
  const list = [];
  for (const item of [
    ...(picker?.urgent ?? []),
    ...(picker?.mine ?? []),
    ...(picker?.others ?? []),
  ]) {
    const key = `p${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      key,
      name: item.name,
      project: { id: item.id, name: item.name, color: item.color ?? null },
    });
  }
  for (const item of picker?.requests ?? []) {
    const key = `r${item.requestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ key, name: item.name, request: { id: item.requestId, name: item.name } });
  }
  return list;
}

/** The project picker's pick as a group head: { project } or { request }. */
export function headOfPick(pick) {
  if (pick.projectRequestId) {
    return { request: { id: pick.projectRequestId, name: pick.name } };
  }
  return { project: { id: pick.projectId, name: pick.name, color: pick.color ?? null } };
}

/** "Added to today." or "Added 3 tasks to today." (a suggestion added, the prototype's toasts). */
export function addedToTodayText(count) {
  return count === 1 ? 'Added to today.' : `Added ${count} tasks to today.`;
}
