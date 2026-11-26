// One task for the task window (CONTRACT 27, Task details; CONTRACT 28 adds the number, updates,
// minutes and links): GET /api/project-tasks/[id]. PMs and Admin (team.view) read any task; a
// member of the project only their own and Anyone tasks; anyone else gets the same 404, so an id
// says nothing. Files (own and linked) come from projectFiles, filtered by its own rule
// (canSeeLinkedOnTask), never by the task rights. Updates and minutes follow the per-viewer rule:
// without team.view, only the viewer's own lines and timer minutes.
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { projectFiles } from '@/modules/projectFiles';
import { projects } from '@/modules/projects';
import { timers } from '@/modules/timers';
import * as repo from './repo';
import { toId, toTask } from './shared';
import { updatesFor } from './updates';

function notAvailable() {
  return new AppError('NOT_FOUND', { message: "We couldn't find that task." });
}

/** True when the viewer may open the task: team.view, or an active member on their own or Anyone task. */
async function mayOpen(viewer, task) {
  if (!viewer || (viewer.status && viewer.status !== 'active')) return false;
  if (can(viewer, 'team.view')) return true;
  if (task.assigneeId !== null && Number(task.assigneeId) !== Number(viewer.id)) return false;
  return projects.isMember({ projectId: task.projectId, userId: viewer.id });
}

/** The files part: the files the viewer may see, or none when files aren't theirs at all. */
async function filesFor(viewer, project, task) {
  const ctx = await projectFiles.viewerContext({ viewer, project });
  const canSeeFiles = Boolean(ctx.active && (ctx.manages || ctx.member));
  if (!canSeeFiles) return { files: [], canSeeFiles };
  const files = await projectFiles.listForTask({
    viewer,
    task: { id: task.id, projectId: task.projectId, assigneeId: task.assigneeId },
  });
  return { files, canSeeFiles };
}

/** Updates, minutes and private links for the viewer (CONTRACT 28). */
async function extrasFor(viewer, task, canManage) {
  const teamView = can(viewer, 'team.view');
  const [{ updates, updateCount }, minutes, privateLinks] = await Promise.all([
    updatesFor({ viewer, taskId: task.id }),
    timers.minutesByTask({ taskIds: [task.id], userId: teamView ? null : viewer.id }),
    canManage ? projectFiles.privateLinkCounts([task.id]) : {},
  ]);
  return {
    updates,
    updateCount,
    minutes: Number(minutes?.[task.id] ?? 0),
    privateLinkCount: Number(privateLinks?.[task.id] ?? 0),
  };
}

/** The contract's TaskDetails from a task, its project, its files and the viewer's extras. */
function toDetails(task, project, { files, canSeeFiles }, canManage, extras) {
  const { assignee } = task;
  return {
    id: task.id,
    projectId: task.projectId,
    project: {
      id: project.id,
      name: project.name,
      color: project.color,
      status: project.status,
      isUrgent: Boolean(project.isUrgent),
      pmId: project.pmId ?? null,
    },
    title: task.title,
    details: task.details,
    priority: task.priority,
    status: task.status,
    phase: task.phase ?? null,
    dueDate: task.dueDate ?? null,
    assignee: assignee
      ? {
          id: assignee.id,
          name: assignee.name,
          initials: assignee.initials,
          avatarUrl: assignee.avatarUrl,
          role: assignee.role,
          status: assignee.status,
          isMember: assignee.isMember,
        }
      : null,
    createdBy: task.createdBy ? { id: task.createdBy, name: task.createdByName } : null,
    createdAt: task.createdAt,
    doneAt: task.doneAt,
    latestReport: extras.updates[0] ?? null,
    updates: extras.updates,
    updateCount: extras.updateCount,
    minutes: extras.minutes,
    privateLinkCount: extras.privateLinkCount,
    files,
    fileCount: files.length,
    canManage,
    canSeeFiles,
  };
}

/**
 * One task for the task window (GET /api/project-tasks/[id]).
 * @param {{ viewer: object, id: number | string }} args
 * @returns {Promise<{ id, projectId, project: { id, name, color, status, isUrgent, pmId }, title,
 *   details, priority, status, phase, dueDate, assignee: { id, name, initials, avatarUrl, role,
 *   status, isMember } | null, createdBy: { id, name } | null, createdAt, doneAt,
 *   latestReport: Update | null, updates: Update[], updateCount: number, minutes: number,
 *   privateLinkCount: number, files: object[], fileCount: number, canManage: boolean,
 *   canSeeFiles: boolean }>} TaskDetails (CONTRACT 27, 28): `updates` the newest 10 report lines
 *   the viewer may see (`Update = { userId, userName, initials, avatarUrl, workDate, status,
 *   title }`), `latestReport` the first of them; `updateCount` all of them; `minutes` from
 *   finished timers (everyone's with team.view, else the viewer's own; 0 = none);
 *   `privateLinkCount` links to "Only PM and Admins" files (managers, else 0); files: own then
 *   linked ProjectFile rows the viewer may see ([] with canSeeFiles false for another PM who
 *   isn't on the project)
 * @throws NOT_FOUND "We couldn't find that task." (unknown, or not the viewer's to open)
 */
export async function getForViewer({ viewer, id }) {
  const taskId = toId(id);
  const row = taskId ? await repo.findWithPlan(taskId) : null;
  const task = toTask(row);
  if (!task || !(await mayOpen(viewer, task))) throw notAvailable();
  const project = await projects.findById(task.projectId);
  if (!project) throw notAvailable();
  const canManage = can(viewer, 'project.manage') && projects.canManage(viewer, project);
  const [files, extras] = await Promise.all([
    filesFor(viewer, project, task),
    extrasFor(viewer, task, canManage),
  ]);
  return toDetails(task, project, files, canManage, extras);
}
