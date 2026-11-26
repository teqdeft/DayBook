// Bell notifications for priority tasks (CONTRACT 13, 27, 28). They also show on the desktop: the
// push worker sends every new notification. Always written inside the caller's transaction.
// Nothing here goes to Slack, and file names only reach people who may see the task's files: its
// person, or every active member for a task for anyone (CONTRACT 27, Notifications). CONTRACT 28
// adds `project_task.reassigned` for the earlier person; the Table's grouped bulk sends are in
// bulkMessages.js.
import { notifications } from '@/modules/notifications';
import { PRIORITY_LABELS } from './shared';

// The notifications table's title and body sizes; longer text would be cut mid-word.
const TITLE_MAX = 200;
const BODY_MAX = 500;
// File names in the "2 files attached: …" line and in the files_added body; task titles in a
// grouped bulk body.
const LINE_NAMES = 3;
const ADDED_NAMES = 5;
const BULK_TITLES = 3;

/** The text, or its start cut at a word with "…" when it is longer than `max`. */
export function fit(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** "1 file" / "2 files". */
function fileCount(count) {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

/** At most `max` names, then "and 2 more": "a.pdf, b.png, c.docx and 2 more". */
function nameList(files, max) {
  const names = files.map((file) => file.name);
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/**
 * The files line of a task notification: "2 files attached: brief.pdf, logo.png." ("5 files
 * attached: a.pdf, b.png, c.docx and 2 more."), or '' without files.
 * @param {Array<{ name: string }>} files
 * @returns {string}
 */
export function filesLine(files) {
  if (!files?.length) return '';
  return `${fileCount(files.length)} attached: ${nameList(files, LINE_NAMES)}.`;
}

/** The sentences joined with spaces, empty ones left out. */
function sentences(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * Titles in a grouped body: "A", "A and B", "A, B and C", then "A, B, C and 2 more".
 * @param {string[]} titles
 * @returns {string}
 */
export function titleList(titles) {
  if (titles.length <= 1) return titles.join('');
  if (titles.length <= BULK_TITLES) {
    return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
  }
  const more = titles.length - BULK_TITLES;
  return `${titles.slice(0, BULK_TITLES).join(', ')} and ${more} more`;
}

/**
 * Who hears about a task: its assignee (the project's PM, or an Admin among `others`, can be one
 * without being a member), or every active member when it is for anyone. The person who made the
 * change never notifies themselves; a person taken off the project or deactivated is never
 * reached.
 * @param {{ task: { assigneeId: number | null }, members: object[], manager?: object | null,
 *   others?: object[], actorId: number }} args teamOf's rows
 * @returns {object[]} the person rows to tell
 */
export function recipients({ task, members, manager = null, others = [], actorId }) {
  const reachable = (person) => person.status === 'active' && person.id !== actorId;
  if (!task.assigneeId) return members.filter(reachable);
  const people = [...members, ...(manager ? [manager] : []), ...others];
  const person = people.find((row) => row.id === task.assigneeId);
  return person && reachable(person) ? [person] : [];
}

/**
 * Sends one notification to each person, linked to the task on the project page (every recipient
 * can open it: a member, the PM or an Admin) unless `link` says otherwise. Title and body are cut
 * to the table's sizes here, after the files line or the titles are placed, so a long note never
 * cuts the file names.
 * @returns {Promise<Array<{ id: number, name: string }>>} the people reached
 */
export async function send({ people, task, type, title, body, link }, trx) {
  if (people.length === 0) return [];
  await notifications.notify(
    {
      userIds: people.map((person) => person.id),
      type,
      title: fit(title, TITLE_MAX),
      body: body ? fit(body, BODY_MAX) : null,
      link: link ?? `/projects/${task.projectId}?task=${task.id}`,
    },
    trx,
  );
  return people.map((person) => ({ id: person.id, name: person.name }));
}

/**
 * Who a task save told, for its answer and toasts (CONTRACT 27, `told` and `toldName`): 'person'
 * with their name, 'members' when one or more members got it, null when nobody did.
 * @param {Array<{ name: string }>} reached what a send function returned
 * @param {{ assigneeId: number | null }} task
 * @returns {{ told: 'person' | 'members' | null, toldName: string | null }}
 */
export function toldOf(reached, task) {
  if (!reached?.length) return { told: null, toldName: null };
  if (task.assigneeId) return { told: 'person', toldName: reached[0].name };
  return { told: 'members', toldName: null };
}

/**
 * The earlier person's name when `project_task.reassigned` reached them, else null (CONTRACT 28,
 * `toldEarlierName`).
 * @param {Array<{ name: string }>} reached what sendReassigned returned
 * @returns {string | null}
 */
export function toldEarlierOf(reached) {
  return reached?.[0]?.name ?? null;
}

/**
 * `project_task.added`: "New P1 task on internal-tool: Fix login timeout", the body with the files
 * line right after the first sentence, before the note.
 * @returns {Promise<Array<{ id: number, name: string }>>} the people reached
 */
export function sendAdded({ task, project, members, manager, others, actor, files = [] }, trx) {
  const lead = task.assigneeId
    ? `${actor.name} assigned it to you.`
    : `${actor.name} added it for anyone on the project.`;
  return send(
    {
      people: recipients({ task, members, manager, others, actorId: actor.id }),
      task,
      type: 'project_task.added',
      title: `New ${PRIORITY_LABELS[task.priority]} task on ${project.name}: ${task.title}`,
      body: sentences(lead, filesLine(files), task.details),
    },
    trx,
  );
}

/** The title and body of a `project_task.changed` notification. */
export function changedText({ before, task, project, actor }) {
  const label = PRIORITY_LABELS[task.priority];
  const priorityChanged = before.priority !== task.priority;
  if (before.assigneeId !== task.assigneeId) {
    const made = priorityChanged ? ` and made it ${label}` : '';
    return task.assigneeId
      ? {
          title: `${label} task on ${project.name} assigned to you: ${task.title}`,
          body: `${actor.name} assigned it to you${made}.`,
        }
      : {
          title: `${label} task on ${project.name} is open to anyone: ${task.title}`,
          body: `${actor.name} opened it to anyone on the project${made}.`,
        };
  }
  return {
    title: `${task.title} on ${project.name} is now ${label}`,
    body: `${actor.name} changed it from ${PRIORITY_LABELS[before.priority]} to ${label}.`,
  };
}

/**
 * `project_task.changed`, when the priority or the assignee of an open task changes; plus the
 * files line when the same save added files.
 * @returns {Promise<Array<{ id: number, name: string }>>} the people reached
 */
export function sendChanged(
  { before, task, project, members, manager, others, actor, files = [] },
  trx,
) {
  const { title, body } = changedText({ before, task, project, actor });
  return send(
    {
      people: recipients({ task, members, manager, others, actorId: actor.id }),
      task,
      type: 'project_task.changed',
      title,
      body: sentences(body, filesLine(files)),
    },
    trx,
  );
}

/**
 * `project_task.files_added`, when files are added to an open task without a `changed` in the same
 * save: "Riya Kapoor added 2 files to Fix the login page" · "acme-store: brief.pdf, logo.png".
 * Nothing for a done task or without files.
 * @returns {Promise<Array<{ id: number, name: string }>>} the people reached
 */
export function sendFilesAdded({ task, project, members, manager, others, actor, files }, trx) {
  if (!files?.length || task.status !== 'open') return Promise.resolve([]);
  return send(
    {
      people: recipients({ task, members, manager, others, actorId: actor.id }),
      task,
      type: 'project_task.files_added',
      title: `${actor.name} added ${fileCount(files.length)} to ${task.title}`,
      body: `${project.name}: ${nameList(files, ADDED_NAMES)}`,
    },
    trx,
  );
}

// ---------- CONTRACT 28: the earlier person ----------

/** Who a task is for now, as the reassigned texts say it: `{ name }`, or null for anyone. */
function targetOf(task) {
  return task.assigneeId ? { id: task.assigneeId, name: task.assignee?.name ?? '' } : null;
}

/** "Riya Kapoor took it." / "… gave it to Vishal Saini." / "… opened it to anyone on the project." */
function handedText(actor, target, { many = false, titles = '' } = {}) {
  const them = many ? 'them' : 'it';
  const tail = many ? `: ${titles}.` : '.';
  if (!target) return `${actor.name} opened ${them} to anyone on the project${tail}`;
  if (target.id === actor.id) return `${actor.name} took ${them}${tail}`;
  return `${actor.name} gave ${them} to ${target.name}${tail}`;
}

/** The title and body of a `project_task.reassigned` notification for one task or several. */
export function reassignedText({ tasks, project, actor }) {
  const target = targetOf(tasks[0]);
  const now = target ? `now for ${target.name}` : 'now open to anyone';
  if (tasks.length === 1) {
    return {
      title: `${tasks[0].title} on ${project.name} is ${now}`,
      body: handedText(actor, target),
    };
  }
  const titles = titleList(tasks.map((task) => task.title));
  return {
    title: `${tasks.length} of your tasks on ${project.name} are ${now}`,
    body: handedText(actor, target, { many: true, titles }),
  };
}

/**
 * The earlier person of a change, when `project_task.reassigned` should reach them: the task is
 * open, its person changed from a person, and that person is active and reachable (a member, the
 * PM, or an Admin among `others`), isn't the actor, and wasn't told already by the same save's
 * `changed` (an active member, when the task went to anyone).
 * @returns {object | null} their person row
 */
export function earlierToTell({ before, task, team, actorId }) {
  if (task.status !== 'open' || !before.assigneeId) return null;
  if (before.assigneeId === task.assigneeId) return null;
  const [earlier] = recipients({ task: { assigneeId: before.assigneeId }, ...team, actorId });
  if (!earlier) return null;
  if (!task.assigneeId && team.members.some((member) => member.id === earlier.id)) return null;
  return earlier;
}

/**
 * `project_task.reassigned` to the earlier person of one task: "Fix the login page on acme-store is
 * now for Riya Kapoor" · "Riya Kapoor took it.", linked to the board (a member can no longer open
 * the task).
 * @param {{ before: object, task: object, project: object, team: object, actor: object }} args
 *   task: after the save, with `assignee.name`
 * @returns {Promise<Array<{ id: number, name: string }>>} the person reached, or []
 */
export function sendReassigned({ before, task, project, team, actor }, trx) {
  const earlier = earlierToTell({ before, task, team, actorId: actor.id });
  if (!earlier) return Promise.resolve([]);
  const { title, body } = reassignedText({ tasks: [task], project, actor });
  const link = `/projects/${task.projectId}`;
  return send({ people: [earlier], task, type: 'project_task.reassigned', title, body, link }, trx);
}
