// Linking and unlinking project files on tasks (CONTRACT 28, Linking, unlinking, the 20-file limit
// and the share confirm), and the "From project files" picker of files to link. `linkFiles` and
// `unlinkFiles` run inside the caller's transaction (B's task save; the task row is already
// locked), `unlinkFile` in its own. Lock order everywhere: the task row, then upload rows, then
// file rows (own files and the picked files, shared), then link rows. A link is never a copy: one
// row naming the task and the file; the file stays in its place. The share confirm is checked
// here, on the server, and fails closed. Audit rows never hold a file name; nothing here tells
// anyone (B's messages name the files to people allowed to see them). Before migration 020 a link
// write answers UPDATE_NEEDED (503) and the link count reads 0.
import { db } from '@/lib/db';
import { validationError } from '@/lib/errors';
import { can } from '@/lib/permissions';
import { nowDate } from '@/lib/time';
import { audit } from '@/modules/audit';
import { isPhase, PHASE_KEYS, phaseLabel } from '@/modules/projectPlan/phases';
import { projects } from '@/modules/projects';
import { needsShareConfirm } from './access';
import { countActiveForTask } from './attach';
import { cantChangeFiles, fileError, fileNotFound, projectNotFound, taskNotFound } from './errors';
import { projectFilesFor, toProjectFile } from './fileView';
import { guard019Write } from './migration019';
import { guard020Write, linksReady } from './migration020';
import { countActiveLinks } from './linkReads';
import * as linkRepo from './linkRepo';
import * as repo from './repo';
import { MAX_TASK_FILES } from './spaceRules';
import { toId, uniqueIds, viewerContext } from './viewer';

/** The server's sentences (never a file name). */
export const LINK_MESSAGES = Object.freeze({
  gone: "That file isn't in this project's files any more.",
  confirm: 'A file you picked is only for PM and Admins. Confirm to share it with this task.',
  stale: 'This task is now for someone else. Check who it is for and confirm again.',
});

const gone = () => validationError({ linkFileIds: LINK_MESSAGES.gone }, LINK_MESSAGES.gone);
const confirmError = (message) => validationError({ shareConfirmed: message }, message);

/**
 * True when a share confirm was for the task's person after the save: `shareWith` names that
 * person by id, or anyone on the project ('' or null) for an Anyone task; missing never fits. B's
 * reassign share check uses the same rule.
 * @param {number | string | null | undefined} shareWith
 * @param {number | null | undefined} assigneeId
 */
export function shareConfirmFits(shareWith, assigneeId) {
  if (shareWith === undefined) return false;
  const anyone = assigneeId === null || assigneeId === undefined;
  if (shareWith === null || shareWith === '') return anyone;
  return !anyone && Number(shareWith) === Number(assigneeId);
}

/** The task's person after the save as the share confirm judges them (null = Anyone). */
async function personAfter(task, trx) {
  if (task.assigneeId === null || task.assigneeId === undefined) return null;
  if (task.assignee) return task.assignee;
  return (await linkRepo.findPerson(Number(task.assigneeId), trx)) ?? null;
}

/** Writes `project_file.link` for each new link (`shared`: the share confirm was needed). */
async function auditLinks({ user, projectId, taskId, files, shared, ip }, trx) {
  for (const file of files) {
    await audit.log(
      {
        actorId: user.id,
        action: 'project_file.link',
        entityType: 'project_file',
        entityId: Number(file.id),
        after: { projectId, taskId, shared: shared(file) },
        ip,
      },
      trx,
    );
  }
}

/**
 * Links project files to a task inside the caller's transaction (the task row already locked).
 * Each picked file must be an active project file of this project (read with a shared lock); a
 * file already on the task is skipped. When a picked file is "Only PM and Admins" and the task's
 * person after this save isn't a manager (null = Anyone), the save needs `shareConfirmed: true`
 * with `shareWith` naming that person. Own active files + links to active files + the new links
 * stay within 20.
 * @param {{ user: object, project: { id: number, pmId: number | null },
 *   task: { id: number, assigneeId: number | null,
 *     assignee?: { id: number, role: string, status: string } | null },
 *   fileIds: number[], shareConfirmed?: boolean, shareWith?: number | '' | null,
 *   ip?: string | null }} args
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<import('./service').ProjectFile[]>} the newly linked files (`linked: true`)
 * @throws VALIDATION_FAILED (`fields.linkFileIds`, `fields.shareConfirmed`), TOO_MANY_FILES (409),
 *   UPDATE_NEEDED (503) before migration 020
 */
export async function linkFiles(
  { user, project, task, fileIds, shareConfirmed = false, shareWith = undefined, ip = null },
  trx,
) {
  const ids = uniqueIds(fileIds);
  if (ids.length === 0) return [];
  return guard020Write('links', async () => {
    const projectId = Number(project.id);
    const taskId = Number(task.id);
    // First, so before migration 020 the save answers UPDATE_NEEDED, never a 400 about a file or a
    // confirm that can't work yet. A plain read: the lock order above stays.
    const linked = await linkRepo.linkRows(taskId, null, trx);
    const picked = new Map(
      (await linkRepo.lockPickedFiles(ids, trx)).map((row) => [Number(row.id), row]),
    );
    const fits = (row) =>
      row &&
      row.status === 'active' &&
      row.scope === 'project' &&
      Number(row.projectId) === projectId;
    if (!ids.every((id) => fits(picked.get(id)))) throw gone();
    const person = await personAfter(task, trx);
    const shared = (file) => needsShareConfirm(picked.get(Number(file.id)), person, project);
    if (ids.some((id) => shared({ id }))) {
      if (shareConfirmed !== true) throw confirmError(LINK_MESSAGES.confirm);
      if (!shareConfirmFits(shareWith, task.assigneeId)) throw confirmError(LINK_MESSAGES.stale);
    }
    const own = await countActiveForTask(taskId, trx);
    const active = await countActiveLinks(taskId, trx, linked);
    const fresh = ids.filter((id) => !linked.includes(id));
    if (own + active + fresh.length > MAX_TASK_FILES) throw fileError('TOO_MANY_FILES');
    if (fresh.length === 0) return [];
    const createdAt = nowDate();
    await linkRepo.insertLinks(
      fresh.map((fileId) => ({ taskId, fileId, createdBy: user.id, createdAt })),
      trx,
    );
    const files = (await projectFilesFor({ viewer: user, ids: fresh }, trx)).map((file) => ({
      ...file,
      linked: true,
    }));
    await auditLinks({ user, projectId, taskId, files, shared, ip }, trx);
    return files;
  });
}

/**
 * Unlinks files from a task inside the caller's transaction (the task row already locked; only the
 * rows found are deleted, by their whole key); a file not linked is skipped. Writes
 * `project_file.unlink` for each. The files stay in Files.
 * @param {{ user: object, task: { id: number, projectId?: number }, fileIds: number[],
 *   ip?: string | null }} args
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<number[]>} the file ids removed now
 * @throws UPDATE_NEEDED (503) before migration 020
 */
export async function unlinkFiles({ user, task, fileIds, ip = null }, trx) {
  const ids = uniqueIds(fileIds);
  if (ids.length === 0) return [];
  return guard020Write('links', async () => {
    const taskId = Number(task.id);
    const present = await linkRepo.linkRows(taskId, ids, trx);
    if (present.length === 0) return [];
    await linkRepo.deleteLinks(taskId, present, trx);
    const projectId = Number(task.projectId ?? (await linkRepo.findTask(taskId, trx))?.projectId);
    for (const fileId of present) {
      await audit.log(
        {
          actorId: user.id,
          action: 'project_file.unlink',
          entityType: 'project_file',
          entityId: fileId,
          before: { projectId, taskId },
          ip,
        },
        trx,
      );
    }
    return present;
  });
}

/**
 * The project's PM and Admins may unlink; anyone who can see the task gets 403, anyone else 404
 * (another PM sees every task read only; a member sees their own and Anyone tasks).
 */
async function assertCanUnlink(user, project, task) {
  if (projects.canManage(user, project)) return;
  const ctx = await viewerContext({ viewer: user, project });
  const theirs = task.assigneeId === null || Number(task.assigneeId) === Number(user?.id);
  const seesTask = ctx.active && (can(user, 'project.manage') || (ctx.member && theirs));
  throw seesTask ? cantChangeFiles() : taskNotFound();
}

/**
 * Unlinks one file from a task in its own transaction (`DELETE /api/project-tasks/[id]/links/
 * [fileId]`, sent after the browser's 6 s Undo toast): locks the task row (read only), checks the
 * person may change it, then removes the link. A link already gone answers the same. No
 * notification.
 * @param {{ user: object, taskId: number, fileId: number, ip?: string | null }} args
 * @returns {Promise<{ removed: true }>}
 * @throws NOT_FOUND ("We couldn't find that task." / "We couldn't find that file."), FORBIDDEN
 *   ("You can't change files on this project."), UPDATE_NEEDED (503) before migration 020
 */
export async function unlinkFile({ user, taskId, fileId, ip = null }) {
  const task = toId(taskId);
  const file = toId(fileId);
  if (!task) throw taskNotFound();
  if (!file) throw fileNotFound();
  return guard020Write('links', () =>
    db.transaction(async (trx) => {
      const row = await linkRepo.lockTaskRow(task, trx);
      const project = row ? await projects.findById(row.projectId) : null;
      if (!row || !project) throw taskNotFound();
      await assertCanUnlink(user, project, row);
      await unlinkFiles({ user, task: row, fileIds: [file], ip }, trx);
      return { removed: true };
    }),
  );
}

/** The picker lists at most this many project files, newest first (Limits). */
export const PICKER_MAX = 500;

// ---------- the "From project files" picker ----------

/** 404 for anyone who can't see the project, 403 for a member or another PM (Who sees). */
async function assertPicks(viewer, project) {
  const ctx = await viewerContext({ viewer, project });
  if (ctx.manages) return;
  if (ctx.active && (ctx.member || can(viewer, 'project.manage'))) throw cantChangeFiles();
  throw projectNotFound();
}

/** The picker's places with their counts: All files, Whole project, then each phase. */
function placesOf(files) {
  const count = (test) => files.filter(test).length;
  return [
    { key: 'all', label: 'All files', count: files.length },
    { key: 'project', label: 'Whole project', count: count((file) => !isPhase(file.phase)) },
    ...PHASE_KEYS.map((key) => ({
      key,
      label: phaseLabel(key),
      count: count((file) => file.phase === key),
    })),
  ];
}

/**
 * The "From project files" picker (managers only): the project's active project files, newest
 * first (at most 500), each with `onThisTask` and `linkCount`, the places and their counts, and the
 * task's phase for the preset. Before migration 020: nothing to pick and `linksReady: false`.
 * @param {{ viewer: object, projectId: number, taskId?: number | null }} args
 * @returns {Promise<{ files: import('./service').PickerFile[], places: Array<{ key: string,
 *   label: string, count: number }>, taskPhase: string | null, linksReady: boolean }>}
 * @throws NOT_FOUND ("We couldn't find that project." / "We couldn't find that task."), FORBIDDEN
 *   ("You can't change files on this project."), UPDATE_NEEDED (503) before migration 019
 */
export async function pickerFiles({ viewer, projectId, taskId = null }) {
  const id = toId(projectId);
  const project = id ? await projects.findById(id) : null;
  if (!project) throw projectNotFound();
  await assertPicks(viewer, project);
  let task = null;
  if (taskId !== null && taskId !== undefined) {
    const found = toId(taskId) ? await linkRepo.findTask(toId(taskId)) : null;
    if (!found || Number(found.projectId) !== Number(project.id)) throw taskNotFound();
    task = found;
  }
  const rows = await guard019Write('files', () =>
    repo.listActiveProjectFiles(project.id, PICKER_MAX),
  );
  const taskPhase = isPhase(task?.phase) ? task.phase : null;
  if (!(await linksReady())) return { files: [], places: [], taskPhase, linksReady: false };
  const [counts, onTask] = await Promise.all([
    linkRepo.linkCountsForProject(project.id),
    task ? linkRepo.fileIdsOnTask(task.id) : new Set(),
  ]);
  const files = rows.map((row) => ({
    ...toProjectFile(row, { canManage: true, linkCount: counts.get(Number(row.id)) ?? 0 }),
    onThisTask: onTask.has(Number(row.id)),
  }));
  return { files, places: placesOf(files), taskPhase, linksReady: true };
}
