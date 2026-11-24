// Bell notifications for priority tasks (CONTRACT 13, 27). They also show on the desktop: the push
// worker sends every new notification. Always written inside the caller's transaction. Nothing
// here goes to Slack, and file names only reach people who may see the task's files: its person,
// or every active member for a task for anyone (CONTRACT 27, Notifications).
import { notifications } from '@/modules/notifications';
import { PRIORITY_LABELS } from './shared';

// The notifications table's title and body sizes; longer text would be cut mid-word.
const TITLE_MAX = 200;
const BODY_MAX = 500;
// File names in the "2 files attached: …" line and in the files_added body.
const LINE_NAMES = 3;
const ADDED_NAMES = 5;

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
 * Who hears about a task: its assignee (the project's PM can be one without being a member), or
 * every active member when it is for anyone. The person who made the change never notifies
 * themselves; a person taken off the project or deactivated is never reached.
 */
function recipients({ task, members, manager, actorId }) {
  const reachable = (person) => person.status === 'active' && person.id !== actorId;
  if (!task.assigneeId) return members.filter(reachable);
  const people = manager ? [...members, manager] : members;
  return people.filter((person) => person.id === task.assigneeId && reachable(person));
}

/**
 * Sends one notification to each person, linked to the task on the project page (every recipient
 * can open it: a member or the PM). Title and body are cut to the table's sizes here, after the
 * files line is placed, so a long note never cuts the file names.
 * @returns {Promise<Array<{ id: number, name: string }>>} the people reached
 */
async function send({ people, task, type, title, body }, trx) {
  if (people.length === 0) return [];
  await notifications.notify(
    {
      userIds: people.map((person) => person.id),
      type,
      title: fit(title, TITLE_MAX),
      body: body ? fit(body, BODY_MAX) : null,
      link: `/projects/${task.projectId}?task=${task.id}`,
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
 * `project_task.added`: "New P1 task on internal-tool: Fix login timeout", the body with the files
 * line right after the first sentence, before the note.
 * @returns {Promise<Array<{ id: number, name: string }>>} the people reached
 */
export function sendAdded({ task, project, members, manager, actor, files = [] }, trx) {
  const lead = task.assigneeId
    ? `${actor.name} assigned it to you.`
    : `${actor.name} added it for anyone on the project.`;
  return send(
    {
      people: recipients({ task, members, manager, actorId: actor.id }),
      task,
      type: 'project_task.added',
      title: `New ${PRIORITY_LABELS[task.priority]} task on ${project.name}: ${task.title}`,
      body: sentences(lead, filesLine(files), task.details),
    },
    trx,
  );
}

/** The title and body of a `project_task.changed` notification. */
function changedText({ before, task, project, actor }) {
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
export function sendChanged({ before, task, project, members, manager, actor, files = [] }, trx) {
  const { title, body } = changedText({ before, task, project, actor });
  return send(
    {
      people: recipients({ task, members, manager, actorId: actor.id }),
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
export function sendFilesAdded({ task, project, members, manager, actor, files }, trx) {
  if (!files?.length || task.status !== 'open') return Promise.resolve([]);
  return send(
    {
      people: recipients({ task, members, manager, actorId: actor.id }),
      task,
      type: 'project_task.files_added',
      title: `${actor.name} added ${fileCount(files.length)} to ${task.title}`,
      body: `${project.name}: ${nameList(files, ADDED_NAMES)}`,
    },
    trx,
  );
}
