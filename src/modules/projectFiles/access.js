// Who sees and does what with project and task files (CONTRACT 27, Who sees and does what, and
// CONTRACT 28, Links: who sees a linked file): one pure rule used by every read, count, download and
// page. A `ctx` is for one viewer on one project: `{ projectId, userId, active, manages, member }`
// (`viewerContext` in viewer.js builds it). Pure and browser-safe (its one import, the role map, is
// too), so client components may import it (CONTRACT 2): the browser's share confirm and the server
// use the same rules.
import { can } from '@/lib/permissions';

/**
 * @typedef {{ projectId: number, userId: number, active: boolean, manages: boolean,
 *   member: boolean }} FilesCtx
 */

/**
 * @typedef {{ taskId: number, assigneeId: number | null, projectId?: number }} FileLink one link
 *   of a project file, read from the task row by A's repo (never a caller's copy); `projectId` the
 *   task's project, when known (a link whose task is on another project never counts)
 */

/**
 * @typedef {{ projectId: number, scope: 'project' | 'task', status: string,
 *   visibility?: string, task?: { assigneeId: number | null } | null,
 *   links?: FileLink[] }} AccessFile
 */

/** True when a task with this person is the viewer's, or for anyone on the project (null). */
const isFor = (assigneeId, userId) =>
  assigneeId === null || assigneeId === undefined || Number(assigneeId) === Number(userId);

/** True when a link reaches the viewer: its task is on the file's project and theirs or Anyone. */
const reaches = (file, userId) => (link) =>
  (link.projectId === undefined || Number(link.projectId) === Number(file.projectId)) &&
  isFor(link.assigneeId, userId);

/**
 * The fields `canSeeFile` reads, from a repo row (the task and the links from the database, never a
 * copy). `links` matter only for a member and an "Only PM and Admins" project file, so a read may
 * leave them out everywhere else (the short cut of CONTRACT 28).
 * @param {{ projectId: number, scope: string, status: string, visibility?: string,
 *   taskRowId?: number | null, taskAssigneeId?: number | null }} row
 * @param {FileLink[]} [links]
 * @returns {AccessFile}
 */
export function accessShape(row, links = []) {
  return {
    projectId: row.projectId,
    scope: row.scope,
    status: row.status,
    visibility: row.visibility,
    task: row.taskRowId ? { assigneeId: row.taskAssigneeId ?? null } : null,
    links: links ?? [],
  };
}

/**
 * True when the viewer may see (list, count, download) the file. A "no" is always a 404 on a read.
 * A member opens an "Only PM and Admins" project file only when one of its links is to a task of
 * theirs or an Anyone task (CONTRACT 28); the file's own setting doesn't change.
 * @param {FilesCtx} ctx
 * @param {AccessFile} file
 */
export function canSeeFile(ctx, file) {
  if (!ctx?.active || !file) return false;
  if (Number(file.projectId) !== Number(ctx.projectId)) return false; // a ctx is for one project
  if (file.status !== 'active') return false;
  if (file.scope === 'task' && !file.task) return false; // its task is gone
  if (ctx.manages) return true;
  if (!ctx.member) return false; // other PMs, HR not on the project, people taken off
  if (file.scope === 'project') {
    if (file.visibility === 'everyone') return true;
    return (file.links ?? []).some(reaches(file, ctx.userId)); // new in 1.13
  }
  if (file.scope !== 'task') return false;
  return isFor(file.task.assigneeId, ctx.userId);
}

// ---- Links (CONTRACT 28, Links: who sees a linked file). `project` is `{ id, pmId }`; a person is
// `{ id, role, status } | null` (null = anyone on the project).

/**
 * "Through that task only": may this viewer see this file listed on this task? A non-manager sees
 * a link only on a task that is theirs or for anyone, whatever the file's setting (as 1.12's own
 * task files), so no list ever names another person's task to them.
 * @param {FilesCtx} ctx
 * @param {AccessFile} file
 * @param {{ assigneeId: number | null }} task
 */
export function canSeeLinkedOnTask(ctx, file, task) {
  if (!canSeeFile(ctx, file)) return false;
  return ctx.manages || (Boolean(task) && isFor(task.assigneeId, ctx.userId)); // no task: no
}

/**
 * True when linking `file` to a task for `assignee` (null = Anyone) needs the share confirm.
 * @param {{ visibility?: string }} file
 * @param {{ id: number, role: string, status: string } | null} assignee
 * @param {{ id: number, pmId: number | null }} project
 */
export function needsShareConfirm(file, assignee, project) {
  return file?.visibility === 'managers' && !isProjectManager(assignee, project);
}

/**
 * The project's PM or an active Admin (the browser and the server use the same rule), as
 * `canManageProject` decides `ctx.manages`: whoever still holds the project's `pmId` after a move to
 * employee or HR can't manage it, so `canSeeFile` treats them as a member and so does the share
 * confirm.
 * @param {{ id: number, role: string, status: string } | null} person users.status: 'active' |
 *   'deactivated'
 * @param {{ id: number, pmId: number | null }} project
 */
export function isProjectManager(person, project) {
  if (!person || person.status !== 'active' || !can(person, 'project.manage')) return false;
  return person.role === 'admin' || Number(person.id) === Number(project?.pmId);
}

/**
 * True when the viewer may upload, rename, move, change who sees and delete files (managers).
 * @param {FilesCtx} ctx
 */
export const canManageFiles = (ctx) => Boolean(ctx?.active && ctx.manages);

/**
 * The file rights a page follows (`head.filesAccess`), never the page's task `access`.
 * @param {FilesCtx} ctx
 * @returns {'manage' | 'member' | 'none'}
 */
export const filesAccess = (ctx) =>
  canManageFiles(ctx) ? 'manage' : ctx?.active && ctx.member ? 'member' : 'none';

/**
 * True when the viewer may read a project document's text: managers read every document; members
 * read only Everyone notes and Everyone text-only documents (the text of a project file is for
 * managers only).
 * @param {FilesCtx} ctx
 * @param {{ projectId: number, kind: 'note' | 'file', visibility?: string,
 *   fileId?: number | null }} doc
 */
export function canReadDocument(ctx, doc) {
  if (!ctx?.active || !doc || Number(doc.projectId) !== Number(ctx.projectId)) return false;
  if (ctx.manages) return true;
  const textOnly = doc.fileId === null || doc.fileId === undefined;
  return Boolean(ctx.member && doc.visibility === 'everyone' && (doc.kind === 'note' || textOnly));
}
