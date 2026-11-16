// Today's to-do changes (CONTRACT 24), each its own request through useTodoSync's write, shown at
// once. An add to a project whose row waits behind the Undo toast ("Task removed.", "Project
// removed.") sends that DELETE first and waits for it: otherwise the server would skip the new line
// as a duplicate of the hidden one, or put it into the entry about to be deleted, and the DELETE
// would then take the new work with it. Removing waits behind the toast (useUndoDelete); a project
// with hours in the report is refused at once.
import { announceTimersChanged } from '@/components/TimerChip.clock';
import { api } from '@/lib/apiClient';
import {
  groupKey,
  groupName,
  lineUndoKey,
  pendingLine,
  projectUndoKey,
  targetOf,
  tickedStatus,
  withLinePatched,
} from './todoModel';
import { heldRows, joinHeld, withNewLines, withoutHeld } from './todoSync';

export const HOURS_REFUSAL = 'This project has hours in your report. Remove it in the report.';

/**
 * @typedef {{ raw: object, write: Function, undo: { isHidden: Function, remove: Function,
 *   settle: Function }, toast: Function, setPicked: Function, setPosting: Function }} TodoContext
 *   raw: the to-do with the rows waiting on Undo still in it
 */

let counter = 0;
/** An id for a line on its way ("new1"), until the answer brings its real one. */
function newId() {
  counter += 1;
  return `new${counter}`;
}

/** Only the fields that are set, so the API never gets null for an optional id. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value != null));
}

/** The add's request: the held rows' DELETE first (waited for), when there are some. */
function afterHeld(ctx, held, send) {
  return () => (held.keys.length ? ctx.undo.settle(held.keys).then(send) : send());
}

/**
 * One line on a project (typed, from a suggestion, from a priority task).
 * @param {TodoContext} ctx
 */
export function addLine(ctx, target, input) {
  const { title, status, projectTaskId, carriedFromTaskId, carriedFrom, added } = input;
  const line = pendingLine({ id: newId(), title, status, projectTaskId, carriedFrom });
  const held = heldRows(
    ctx.raw,
    target,
    { titles: [line.title], projectTaskId },
    ctx.undo.isHidden,
  );
  const body = defined({
    ...targetOf(target),
    title: line.title,
    projectTaskId,
    carriedFromTaskId,
  });
  return ctx.write({
    request: afterHeld(ctx, held, () => api.post('/api/me/todo/lines', body)),
    show: (todo) => withNewLines(withoutHeld(todo, held), target, [line]),
    failTitle: "Couldn't add the task",
    done: (data) => {
      if (data.added === false) ctx.toast({ title: 'Already in your to-do.' });
      else if (added) ctx.toast({ title: added });
    },
  });
}

/**
 * Several lines at once (the paste, "Add all to today"): POST /api/me/todo/lines/bulk.
 * @param {TodoContext} ctx
 * @param {Array<{ target: object, lines: Array<{ title, status, carriedFrom? }> }>} groups
 * @param {(added: number) => string} addedText the toast once they are in
 */
export function addLines(ctx, groups, addedText) {
  const shown = groups.map((group) => ({
    target: group.target,
    lines: group.lines.map((line) => pendingLine({ id: newId(), ...line })),
  }));
  const held = joinHeld(
    shown.map((group) =>
      heldRows(
        ctx.raw,
        group.target,
        { titles: group.lines.map((line) => line.title) },
        ctx.undo.isHidden,
      ),
    ),
  );
  const body = {
    groups: groups.map((group) => ({
      ...targetOf(group.target),
      lines: group.lines.map(({ title, status }) => ({ title, status })),
    })),
  };
  return ctx.write({
    request: afterHeld(ctx, held, () => api.post('/api/me/todo/lines/bulk', body)),
    show: (todo) =>
      shown.reduce(
        (next, group) => withNewLines(next, group.target, group.lines),
        withoutHeld(todo, held),
      ),
    failTitle: "Couldn't add the tasks",
    done: (data) => ctx.toast({ title: addedText(Number(data.added) || 0) }),
  });
}

/** Ticks a line (Done) or unticks it (a Done line is In progress again). */
export function tick(ctx, line, done) {
  const patch = done
    ? { done, status: 'done', canStart: false }
    : { done, status: tickedStatus(line.status, done) };
  return ctx.write({
    request: () => api.patch(`/api/me/todo/lines/${line.id}`, { done }),
    show: (todo) => withLinePatched(todo, line.id, patch),
    failTitle: "Couldn't change the task",
  });
}

export function rename(ctx, line, title) {
  return ctx.write({
    request: () => api.patch(`/api/me/todo/lines/${line.id}`, { title }),
    show: (todo) => withLinePatched(todo, line.id, { title }),
    failTitle: "Couldn't rename the task",
  });
}

/** Play: the answer is the to-do with the line "Now" (null when it was refused). */
export function startTimer(ctx, line, group) {
  return ctx.write({
    request: () => api.post(`/api/me/todo/lines/${line.id}/timer`),
    failTitle: "Couldn't start the timer",
    done: () => {
      announceTimersChanged('todo');
      ctx.toast({ title: `Timer started on ${groupName(group)}.` });
    },
  });
}

/** Hides the line behind "Task removed." with Undo; the DELETE goes when the toast ends. */
export function removeLine(ctx, line, { keyboard = false, returnFocus } = {}) {
  ctx.undo.remove({
    key: lineUndoKey(line.id),
    url: `/api/me/todo/lines/${line.id}`,
    label: 'Task removed.',
    failTitle: "Couldn't remove the task",
    keyboard,
    returnFocus,
  });
}

/** "Project removed." with Undo; refused at once while the project has hours in the report. */
export function removeProject(ctx, group, { keyboard = false, returnFocus } = {}) {
  if (!group.entryId) {
    ctx.setPicked((list) => list.filter((head) => groupKey(head) !== groupKey(group)));
    return;
  }
  if (group.minutes > 0) {
    ctx.toast({ title: "Couldn't remove the project", body: HOURS_REFUSAL, tone: 'error' });
    return;
  }
  ctx.undo.remove({
    key: projectUndoKey(group.entryId),
    url: `/api/me/todo/projects/${group.entryId}`,
    label: 'Project removed.',
    failTitle: "Couldn't remove the project",
    keyboard,
    returnFocus,
  });
}

/** "Post to Slack" (or "Update post", "Try again"). */
export async function post(ctx) {
  ctx.setPosting(true);
  try {
    await ctx.write({
      request: () => api.post('/api/me/todo/slack'),
      failTitle: "Couldn't post to Slack",
    });
  } finally {
    ctx.setPosting(false);
  }
}
