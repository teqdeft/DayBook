// The Table's grouped bulk sends (CONTRACT 28, Notifications, Bulk sends): one save of
// POST /api/projects/[id]/tasks/bulk tells each person once per kind, never once per task. With one
// task for a recipient, the single texts of messages.js; with several, "3 tasks on acme-store
// assigned to you" and the titles (at most 3, then "and 2 more"), linked to the board. Bulk moves
// send nothing. Split from messages.js for its size; always inside the caller's transaction.
import {
  changedText,
  earlierToTell,
  reassignedText,
  recipients,
  send,
  titleList,
} from './messages';

const CHANGED_TYPE = 'project_task.changed';
const REASSIGNED_TYPE = 'project_task.reassigned';

/** Adds an item to the list under `key` (a Map of arrays). */
function pushTo(groups, key, value) {
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(value);
}

/** A grouped `changed` for one recipient: the single text for one task, else the bulk one. */
function bulkChangedText({ items, project, actor }) {
  if (items.length === 1) return changedText({ ...items[0], project, actor });
  const titles = titleList(items.map(({ task }) => task.title));
  return items[0].task.assigneeId
    ? {
        title: `${items.length} tasks on ${project.name} assigned to you`,
        body: `${actor.name} assigned them to you: ${titles}.`,
      }
    : {
        title: `${items.length} tasks on ${project.name} are open to anyone`,
        body: `${actor.name} opened them to anyone on the project: ${titles}.`,
      };
}

/**
 * The Table's bulk person change, `project_task.changed`: one notification per person (the new
 * person of their tasks; every active member once for the tasks now for anyone), never one per
 * task. Done tasks and the actor are left out.
 * @param {{ changes: Array<{ before: object, task: object }>, project: object, team: object,
 *   actor: object }} args only the tasks whose person changed; task after the save
 * @returns {Promise<{ people: Array<{ id, name }>, members: boolean }>} who was told as the
 *   task's person, and whether members were told about tasks for anyone
 */
export async function sendBulkChanged({ changes, project, team, actor }, trx) {
  const groups = new Map();
  for (const change of changes) {
    if (change.task.status !== 'open') continue;
    const people = recipients({ task: change.task, ...team, actorId: actor.id });
    if (people.length === 0) continue;
    const key = change.task.assigneeId ? `person:${people[0].id}` : 'anyone';
    if (!groups.has(key)) groups.set(key, { people, items: [] });
    groups.get(key).items.push(change);
  }
  const told = { people: [], members: false };
  for (const [key, { people, items }] of groups) {
    const { title, body } = bulkChangedText({ items, project, actor });
    const link = items.length === 1 ? null : `/projects/${project.id}`;
    const type = CHANGED_TYPE;
    const reached = await send({ people, task: items[0].task, type, title, body, link }, trx);
    if (key === 'anyone') told.members = reached.length > 0;
    else told.people.push(...reached);
  }
  return told;
}

/**
 * The Table's bulk person change, `project_task.reassigned`: one notification per earlier person
 * for the tasks that went to the same person (or to anyone), as earlierToTell decides per task.
 * @param {{ changes: Array<{ before: object, task: object }>, project: object, team: object,
 *   actor: object }} args
 * @returns {Promise<Array<{ id: number, name: string }>>} the earlier people reached
 */
export async function sendBulkReassigned({ changes, project, team, actor }, trx) {
  const groups = new Map();
  for (const change of changes) {
    const earlier = earlierToTell({ ...change, team, actorId: actor.id });
    if (!earlier) continue;
    pushTo(groups, `${earlier.id}:${change.task.assigneeId ?? 'anyone'}`, { earlier, change });
  }
  const reached = [];
  for (const entries of groups.values()) {
    const tasks = entries.map((entry) => entry.change.task);
    const { title, body } = reassignedText({ tasks, project, actor });
    const people = [entries[0].earlier];
    const type = REASSIGNED_TYPE;
    const link = `/projects/${project.id}`;
    reached.push(...(await send({ people, task: tasks[0], type, title, body, link }, trx)));
  }
  return reached;
}
