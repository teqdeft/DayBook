// Reads of project and task files (CONTRACT 27, Modules "Reads", and CONTRACT 28, Every read with
// links): the viewer's ctx on one project, a task's files (own, then linked), the counts for
// paperclips and My projects, the file behind E's text POST and the file behind a download. Every
// read filters with `canSeeFile` (access.js) on a ctx built for one viewer and one project, with the
// file's links read by this module's own repo (never a caller's copy); a task-scoped list or count
// uses `canSeeLinkedOnTask`. Nothing is cached per person. Before migration 019 the lists and counts
// read as empty and a download answers UPDATE_NEEDED; before 020 links read as none (1.12's
// answers). The Files tab, the chips, the picker and the private-link counts are in linkReads.js.
import { logger } from '@/lib/logger';
import { projects } from '@/modules/projects';
import { projectSummaries } from '@/modules/projectSummaries';
import { accessShape, canManageFiles, canSeeFile } from './access';
import { fileNotFound } from './errors';
import { toProjectFile } from './fileView';
import { guard019Read, guard019Write } from './migration019';
import { guard020Read } from './migration020';
import { bump, countLinked, filesWithLinks, linksNeeded, seenLinked } from './linkReads';
import * as linkRepo from './linkRepo';
import * as repo from './repo';
import { ensureReady, storedPath, thumbPath } from './storage';
import { contextsFor, toId, uniqueIds, viewerContext } from './viewer';

// The fields `canSeeFile` reads (access.js, pure) and the viewer's ctx (viewer.js): re-exported for
// manage.js and the service.
export { accessShape, viewerContext };

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

const nothing = () => ({ files: [], links: [], canSee: false, canManage: false });

/**
 * The project and task files of a project the viewer may see (the Files tab), newest first, each
 * project file with its link fields (`linkCount`, `linkedTasks`, `sharedByLink`), and the links the
 * viewer may see for "On tasks" (linkReads.filesWithLinks).
 * @param {{ viewer: object, projectId: number }} args
 * @returns {Promise<{ files: import('./service').ProjectFile[], links: Array<{ fileId: number,
 *   taskId: number, taskTitle: string, taskPhase: string | null,
 *   taskAssigneeId: number | null }>, canSee: boolean, canManage: boolean }>} canSee:
 *   ctx.manages || ctx.member (false, with [], only when neither)
 */
export async function listForProject({ viewer, projectId }) {
  const id = toId(projectId);
  const project = id ? await projects.findById(id) : null;
  if (!project) return nothing();
  const ctx = await viewerContext({ viewer, project });
  if (!ctx.active || (!ctx.manages && !ctx.member)) return nothing();
  const canManage = canManageFiles(ctx);
  const [rows, linkRows] = await Promise.all([
    guard019Read(
      'files',
      () => repo.listActiveForProject(project.id),
      () => [],
    ),
    guard020Read(
      'links',
      () => linkRepo.linksForProject(project.id),
      () => [],
    ),
  ]);
  const tab = filesWithLinks(ctx, project, rows, linkRows);
  const withText =
    canManage && tab.files.some(({ row }) => row.scope === 'project')
      ? await textFileIds(viewer, project.id)
      : new Set();
  const files = tab.files.map(({ row, fields }) =>
    toProjectFile(row, { canManage, hasText: withText.has(Number(row.id)), ...fields }),
  );
  return { files, links: tab.links, canSee: true, canManage };
}

/**
 * The files of one task the viewer may see: its own files in the order they were added, then the
 * project files linked to it (oldest link first) with `linked: true` and their place (`phase`).
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
  const [rows, linkedRows] = await Promise.all([
    guard019Read(
      'files',
      () => repo.listActiveForTask({ projectId: project.id, taskId }),
      () => [],
    ),
    guard020Read(
      'links',
      () => linkRepo.listLinkedForTasks([taskId]),
      () => [],
    ),
  ]);
  const canManage = canManageFiles(ctx);
  const own = rows
    .filter((row) => canSeeFile(ctx, accessShape(row)))
    .map((row) => toProjectFile(row, { canManage }));
  const onProject = linkedRows.filter((row) => Number(row.linkProjectId) === Number(project.id));
  const links = await linksNeeded(ctx, onProject);
  const linked = seenLinked(ctx, onProject, links).map((row) =>
    toProjectFile(row, { canManage, linked: true }),
  );
  return [...own, ...linked];
}

/**
 * File counts per task: own files `canSeeFile` allows plus linked active files passing
 * `canSeeLinkedOnTask`. One ctx per project (tasks may span projects: Today).
 * @param {{ viewer: object, tasks: Array<{ id: number }> }} args
 * @returns {Promise<Record<number, number>>} { [taskId]: n } for tasks with files; {} when none
 */
export async function countsForTasks({ viewer, tasks }) {
  const ids = uniqueIds(tasks, (task) => task?.id);
  if (ids.length === 0) return {};
  const rows = await guard019Read(
    'files',
    () => repo.countActiveByTask(ids),
    () => [],
  );
  const contextOf = contextsFor(viewer);
  const counts = {};
  for (const row of rows) {
    const projectId = Number(row.projectId);
    const ctx = await contextOf(projectId);
    const file = {
      projectId,
      scope: 'task',
      status: 'active',
      task: { assigneeId: row.assigneeId ?? null },
    };
    if (ctx && canSeeFile(ctx, file)) bump(counts, row.taskId, row.count);
  }
  await countLinked(ids, contextOf, counts);
  return counts;
}

/**
 * Files on a person's own and Anyone tasks per project (My projects), own files and links (each
 * link once), on projects where they are an active member.
 * @param {{ userId: number, projectIds: number[] }} args
 * @returns {Promise<Record<number, number>>} { [projectId]: n } for projects with files
 */
export async function countTaskFilesForMember({ userId, projectIds }) {
  const id = toId(userId);
  const ids = uniqueIds(projectIds);
  if (!id || ids.length === 0) return {};
  const [own, linked] = await Promise.all([
    guard019Read(
      'files',
      () => repo.countOnMemberTasks({ userId: id, projectIds: ids }),
      () => [],
    ),
    guard020Read(
      'links',
      () => linkRepo.countOnMemberTasks({ userId: id, projectIds: ids }),
      () => [],
    ),
  ]);
  const counts = {};
  for (const row of [...own, ...linked]) bump(counts, Number(row.projectId), Number(row.count));
  return counts;
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
 * `canSeeFile`, with the file's links, runs before anything else about the file is answered.
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
  const links = (await linksNeeded(ctx, [row])).get(fileId) ?? [];
  if (!canSeeFile(ctx, accessShape(row, links))) throw fileNotFound();
  const root = await ensureReady();
  const file = toProjectFile(row, { canManage: canManageFiles(ctx) });
  return {
    file,
    path: storedPath(root, row.storageKey),
    thumbPath: file.isPicture && row.hasThumb ? thumbPath(root, row.storageKey) : null,
  };
}
