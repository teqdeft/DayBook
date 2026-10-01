// Bell notifications for priority tasks (CONTRACT 13). They also show on the desktop: the push
// worker sends every new notification. Always written inside the caller's transaction.
import { can } from '@/lib/permissions';
import { notifications } from '@/modules/notifications';
import { PRIORITY_LABELS } from './shared';

// The notifications table's title and body sizes; longer text would be cut mid-word.
const TITLE_MAX = 200;
const BODY_MAX = 500;

/** The text, or its start cut at a word with "…" when it is longer than `max`. */
export function fit(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Who hears about a task: its assignee, or every active member when it is for anyone. The person
 * who made the change never notifies themselves.
 */
function recipients({ task, members, actorId }) {
  const active = members.filter((member) => member.status === 'active' && member.id !== actorId);
  if (task.assigneeId) return active.filter((member) => member.id === task.assigneeId);
  return active;
}

/**
 * Sends one notification per link: people who can open the project page (PMs, Admin) go to its
 * Priority tasks card, everyone else to Today, where their priority tasks are listed.
 */
async function send({ people, projectId, type, title, body }, trx) {
  if (people.length === 0) return 0;
  const managers = people.filter((person) => can(person, 'team.view'));
  const others = people.filter((person) => !can(person, 'team.view'));
  let sent = 0;
  for (const [group, link] of [
    [managers, `/projects/${projectId}#priority`],
    [others, '/today'],
  ]) {
    if (group.length === 0) continue;
    sent += await notifications.notify(
      {
        userIds: group.map((person) => person.id),
        type,
        title: fit(title, TITLE_MAX),
        body: body ? fit(body, BODY_MAX) : null,
        link,
      },
      trx,
    );
  }
  return sent;
}

/** `project_task.added`: "New P1 task on internal-tool: Fix login timeout". */
export function sendAdded({ task, project, members, actor }, trx) {
  const lead = task.assigneeId
    ? `${actor.name} assigned it to you.`
    : `${actor.name} added it for anyone on the project.`;
  return send(
    {
      people: recipients({ task, members, actorId: actor.id }),
      projectId: project.id,
      type: 'project_task.added',
      title: `New ${PRIORITY_LABELS[task.priority]} task on ${project.name}: ${task.title}`,
      body: task.details ? `${lead} ${task.details}` : lead,
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

/** `project_task.changed`, when the priority or the assignee of an open task changes. */
export function sendChanged({ before, task, project, members, actor }, trx) {
  const { title, body } = changedText({ before, task, project, actor });
  return send(
    {
      people: recipients({ task, members, actorId: actor.id }),
      projectId: project.id,
      type: 'project_task.changed',
      title,
      body,
    },
    trx,
  );
}
