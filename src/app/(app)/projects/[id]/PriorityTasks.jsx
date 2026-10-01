// "Priority tasks" on the project page (CONTRACT 13): loads the project's tasks, open and done,
// with the latest reported status of each, and hands them to the card. The project's PM and
// Admin manage them; other PMs see the card read-only. Streams in behind its own skeleton.
import { formatDayShort, formatRelativeDay, workDate } from '@/lib/time';
import { projects } from '@/modules/projects';
import { projectTasks } from '@/modules/projectTasks';
import { settings } from '@/modules/settings';
import PriorityTasksCard from './PriorityTasksCard';

/** 'today', 'yesterday', or the row date ('Thu, 24 Sep'). */
function when(date, today) {
  const day = formatRelativeDay(date, today);
  return day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : formatDayShort(date);
}

const firstName = (name) => String(name ?? '').split(' ')[0] || name;

/** Why the assignee can't work on the task any more, or null when they can. */
function awayLabel(assignee) {
  if (assignee.status !== 'active') return 'Deactivated';
  return assignee.isMember ? null : 'Not on the project';
}

/** A task as the card shows it: plain values and ready-made labels. */
function toRow(task, { today, tz }) {
  const latest = task.latestReport;
  return {
    id: task.id,
    title: task.title,
    details: task.details,
    priority: task.priority,
    status: task.status,
    assignee: task.assignee
      ? {
          id: task.assignee.id,
          name: task.assignee.name,
          initials: task.assignee.initials,
          role: task.assignee.role,
          status: task.assignee.status,
          avatarUrl: task.assignee.avatarUrl,
          away: awayLabel(task.assignee),
        }
      : null,
    latest: latest
      ? {
          status: latest.status,
          label: `${firstName(latest.userName)}, ${when(latest.workDate, today)}`,
        }
      : null,
    doneLabel:
      task.status === 'done' && task.doneAt
        ? `Marked done by ${task.doneByName ?? 'someone'}, ${when(workDate(tz, task.doneAt), today)}`
        : null,
  };
}

/**
 * @param {{ viewer: object, project: { id, name, pmId, pmName, status }, today: string }} props
 *   today: the company's date (YYYY-MM-DD)
 */
export default async function PriorityTasks({ viewer, project, today }) {
  const canManage = projects.canManage(viewer, project);
  const [tasks, members, { timezone }] = await Promise.all([
    projectTasks.listForProject({ viewer, projectId: project.id }),
    canManage ? projectTasks.listAssigneeOptions({ viewer, projectId: project.id }) : [],
    settings.getAll(),
  ]);
  return (
    <PriorityTasksCard
      project={{
        id: project.id,
        name: project.name,
        pmName: project.pmName,
        status: project.status,
      }}
      tasks={tasks.map((task) => toRow(task, { today, tz: timezone }))}
      members={members}
      canManage={canManage}
    />
  );
}
