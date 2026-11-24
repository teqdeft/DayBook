// One task for the task window (CONTRACT 27, Task details): GET /api/project-tasks/[id]. PMs and
// Admin (team.view) read any task; a member of the project only their own and Anyone tasks; anyone
// else gets the same 404, so an id says nothing. Files come from projectFiles, filtered by its own
// rule (canSeeFile), never by the task rights.
import { AppError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { projectFiles } from '@/modules/projectFiles';
import { projects } from '@/modules/projects';
import * as repo from './repo';
import { toId, toTask, withLatestReports } from './shared';

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

/** The contract's TaskDetails from a task (with latestReport), its project and its files. */
function toDetails(task, project, { files, canSeeFiles }, canManage) {
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
          status: assignee.status,
          isMember: assignee.isMember,
        }
      : null,
    createdBy: task.createdBy ? { id: task.createdBy, name: task.createdByName } : null,
    createdAt: task.createdAt,
    doneAt: task.doneAt,
    latestReport: task.latestReport ?? null,
    files,
    fileCount: files.length,
    canManage,
    canSeeFiles,
  };
}

/**
 * One task for the task window (GET /api/project-tasks/[id]).
 * @param {{ viewer: object, id: number | string }} args
 * @returns {Promise<{ id, projectId, project: { id, name, color, status, isUrgent }, title,
 *   details, priority, status, phase, dueDate, assignee: { id, name, initials, avatarUrl, status,
 *   isMember } | null, createdBy: { id, name } | null, createdAt, doneAt,
 *   latestReport: { status, userId, userName, workDate } | null, files: object[],
 *   fileCount: number, canManage: boolean, canSeeFiles: boolean }>} TaskDetails (CONTRACT 27):
 *   latestReport is null for a viewer without team.view when the line is someone else's; files are
 *   projectFiles' ProjectFile rows the viewer may see ([] with canSeeFiles false for another PM who
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
  const ownOnlyFor = can(viewer, 'team.view') ? null : viewer.id;
  const [withReport] = await withLatestReports([task], { ownOnlyFor });
  const files = await filesFor(viewer, project, task);
  const canManage = can(viewer, 'project.manage') && projects.canManage(viewer, project);
  return toDetails(withReport, project, files, canManage);
}
