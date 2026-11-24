// Who sees and does what with project and task files (CONTRACT 27, Who sees and does what): one
// pure rule used by every read, count, download and page. A `ctx` is for one viewer on one project:
// `{ projectId, userId, active, manages, member }` (`viewerContext` in reads.js builds it). Pure and
// browser-safe (no imports), so client components may import it too (CONTRACT 2).

/**
 * @typedef {{ projectId: number, userId: number, active: boolean, manages: boolean,
 *   member: boolean }} FilesCtx
 */

/**
 * True when the viewer may see (list, count, download) the file. A "no" is always a 404 on a read.
 * @param {FilesCtx} ctx
 * @param {{ projectId: number, scope: 'project' | 'task', status: string,
 *   visibility?: string, task?: { assigneeId: number | null } | null }} file
 */
export function canSeeFile(ctx, file) {
  if (!ctx?.active || !file) return false;
  if (Number(file.projectId) !== Number(ctx.projectId)) return false; // a ctx is for one project
  if (file.status !== 'active') return false;
  if (file.scope === 'task' && !file.task) return false; // its task is gone
  if (ctx.manages) return true;
  if (!ctx.member) return false; // other PMs, HR not on the project, people taken off
  if (file.scope === 'project') return file.visibility === 'everyone';
  if (file.scope !== 'task') return false;
  const assigneeId = file.task.assigneeId;
  return (
    assigneeId === null || assigneeId === undefined || Number(assigneeId) === Number(ctx.userId)
  );
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
