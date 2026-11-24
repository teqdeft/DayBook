// Reads of project and task files (CONTRACT 27, Modules "Reads"): the viewer's ctx on one project,
// the Files tab list, a task's files, the counts for paperclips and My projects, the file behind
// E's text POST and the file behind a download. Every read filters with `canSeeFile` (access.js)
// on a ctx built for one viewer and one project; nothing is cached per person. Before migration
// 019 the lists and counts read as empty; a download answers UPDATE_NEEDED.
import { logger } from '@/lib/logger';
import { projects } from '@/modules/projects';
import { projectSummaries } from '@/modules/projectSummaries';
import { canManageFiles, canSeeFile } from './access';
import { fileNotFound } from './errors';
import { toProjectFile } from './fileView';
import { guard019Read, guard019Write } from './migration019';
import * as repo from './repo';
import { ensureReady, storedPath, thumbPath } from './storage';

/** A positive whole id, or null. */
const toId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const noCtx = (projectId, userId) => ({
  projectId,
  userId,
  active: false,
  manages: false,
  member: false,
});

/**
 * The ctx of one viewer on one project (Who sees and does what): `active` the viewer is an active
 * person, `manages` canManageProject (the project's PM or an Admin), `member` an active
 * `project_members` row and an active user (read from this module's own repo).
 * @param {{ viewer: object, project: { id: number, pmId: number } }} args
 * @returns {Promise<import('./access').FilesCtx>}
 */
export async function viewerContext({ viewer, project }) {
  const projectId = Number(project?.id);
  const userId = Number(viewer?.id);
  // As can(): a viewer is active unless their status says otherwise.
  const active = Boolean(viewer) && (!viewer.status || viewer.status === 'active');
  if (!active || !toId(projectId) || !toId(userId)) return noCtx(projectId, userId);
  const member = await repo.isActiveMember({ projectId, userId });
  return { projectId, userId, active, manages: projects.canManage(viewer, project), member };
}

/** The fields `canSeeFile` reads, from a repo row (the task from the database, never a copy). */
export function accessShape(row) {
  return {
    projectId: row.projectId,
    scope: row.scope,
    status: row.status,
    visibility: row.visibility,
    task: row.taskRowId ? { assigneeId: row.taskAssigneeId ?? null } : null,
  };
}

/**
 * The ids of the project's files whose text a document holds (managers only; E's documents).
 * A failure only loses the "View text" item, never the list.
 */
export async function textFileIds(viewer, projectId) {
  try {
    const documents = await projectSummaries.listDocumentsFor({ viewer, projectId });
    return new Set(documents.filter((doc) => doc.fileId != null).map((doc) => Number(doc.fileId)));
  } catch (error) {
    logger.warn({ err: error, projectId }, 'files: could not read which files have text');
    return new Set();
  }
}

const NOTHING = Object.freeze({ files: Object.freeze([]), canSee: false, canManage: false });

/**
 * The project and task files of a project the viewer may see (the Files tab), newest first.
 * @param {{ viewer: object, projectId: number }} args
 * @returns {Promise<{ files: import('./service').ProjectFile[], canSee: boolean,
 *   canManage: boolean }>} canSee: ctx.manages || ctx.member (false, with [], only when neither)
 */
export async function listForProject({ viewer, projectId }) {
  const id = toId(projectId);
  const project = id ? await projects.findById(id) : null;
  if (!project) return { ...NOTHING, files: [] };
  const ctx = await viewerContext({ viewer, project });
  if (!ctx.active || (!ctx.manages && !ctx.member)) return { ...NOTHING, files: [] };
  const canManage = canManageFiles(ctx);
  const rows = await guard019Read(
    'files',
    () => repo.listActiveForProject(project.id),
    () => [],
  );
  const visible = rows.filter((row) => canSeeFile(ctx, accessShape(row)));
  const withText =
    canManage && visible.some((row) => row.scope === 'project')
      ? await textFileIds(viewer, project.id)
      : new Set();
  const files = visible.map((row) =>
    toProjectFile(row, { canManage, hasText: withText.has(Number(row.id)) }),
  );
  return { files, canSee: true, canManage };
}

/**
 * The files of one task the viewer may see, in the order they were added.
 * @param {{ viewer: object, task: { id: number, projectId: number } }} args
 * @returns {Promise<import('./service').ProjectFile[]>}
 */
export async function listForTask({ viewer, task }) {
  const taskId = toId(task?.id);
  const projectId = toId(task?.projectId);
  const project = taskId && projectId ? await projects.findById(projectId) : null;
  if (!project) return [];
  const ctx = await viewerContext({ viewer, project });
  if (!ctx.active || (!ctx.manages && !ctx.member)) return [];
  const rows = await guard019Read(
    'files',
    () => repo.listActiveForTask({ projectId: project.id, taskId }),
    () => [],
  );
  const canManage = canManageFiles(ctx);
  return rows
    .filter((row) => canSeeFile(ctx, accessShape(row)))
    .map((row) => toProjectFile(row, { canManage }));
}

/**
 * File counts per task, only the files `canSeeFile` allows. Tasks may span projects (Today), so
 * one ctx is built per project that has files, never one for several.
 * @param {{ viewer: object, tasks: Array<{ id: number }> }} args
 * @returns {Promise<Record<number, number>>} { [taskId]: n } for tasks with files; {} when none
 */
export async function countsForTasks({ viewer, tasks }) {
  const ids = [...new Set((tasks ?? []).map((task) => toId(task?.id)).filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = await guard019Read(
    'files',
    () => repo.countActiveByTask(ids),
    () => [],
  );
  const contexts = new Map();
  const counts = {};
  for (const row of rows) {
    const projectId = Number(row.projectId);
    if (!contexts.has(projectId)) {
      const project = await projects.findById(projectId);
      contexts.set(projectId, project ? await viewerContext({ viewer, project }) : null);
    }
    const ctx = contexts.get(projectId);
    const file = {
      projectId,
      scope: 'task',
      status: 'active',
      task: { assigneeId: row.assigneeId ?? null },
    };
    if (!ctx || !canSeeFile(ctx, file)) continue;
    counts[row.taskId] = (counts[row.taskId] ?? 0) + row.count;
  }
  return counts;
}

/**
 * Files on a person's own and Anyone tasks per project (My projects), on projects where they are
 * an active member.
 * @param {{ userId: number, projectIds: number[] }} args
 * @returns {Promise<Record<number, number>>} { [projectId]: n } for projects with files
 */
export async function countTaskFilesForMember({ userId, projectIds }) {
  const id = toId(userId);
  const ids = [...new Set((projectIds ?? []).map(toId).filter(Boolean))];
  if (!id || ids.length === 0) return {};
  const rows = await guard019Read(
    'files',
    () => repo.countOnMemberTasks({ userId: id, projectIds: ids }),
    () => [],
  );
  return Object.fromEntries(rows.map((row) => [row.projectId, row.count]));
}

/**
 * An active file of the project for E's text POST, or null (`.forShare()` when `trx` is given).
 * @param {{ projectId: number, fileId: number }} args
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<{ id: number, scope: 'project' | 'task', phase: string | null,
 *   visibility: 'everyone' | 'managers', name: string } | null>}
 * @throws UPDATE_NEEDED (503) before migration 019
 */
export async function fileForDocument({ projectId, fileId }, trx) {
  const project = toId(projectId);
  const file = toId(fileId);
  if (!project || !file) return null;
  const row = await guard019Write('files', () =>
    repo.findActiveForDocument({ projectId: project, fileId: file }, trx),
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    scope: row.scope,
    phase: row.phase ?? null,
    visibility: row.visibility,
    name: row.name,
  };
}

/**
 * A file the viewer may see, with its disk paths, for the download, view and thumb routes.
 * `canSeeFile` runs before anything else about the file is answered.
 * @param {{ viewer: object, id: number | string }} args
 * @returns {Promise<{ file: import('./service').ProjectFile, path: string,
 *   thumbPath: string | null }>} thumbPath: only when the file has a thumbnail
 * @throws NOT_FOUND ("We couldn't find that file.") for every "no", FILES_UNAVAILABLE (503),
 *   UPDATE_NEEDED (503)
 */
export async function getForDownload({ viewer, id }) {
  const fileId = toId(id);
  if (!fileId) throw fileNotFound();
  const row = await guard019Write('files', () => repo.findFile(fileId));
  const project = row ? await projects.findById(row.projectId) : null;
  if (!project) throw fileNotFound();
  const ctx = await viewerContext({ viewer, project });
  if (!canSeeFile(ctx, accessShape(row))) throw fileNotFound();
  const root = await ensureReady();
  const file = toProjectFile(row, { canManage: canManageFiles(ctx) });
  return {
    file,
    path: storedPath(root, row.storageKey),
    thumbPath: file.isPicture && row.hasThumb ? thumbPath(root, row.storageKey) : null,
  };
}
