// Files on tasks (CONTRACT 27, Task files; CONTRACT 28, links): the attach, link, remove and limit
// steps of a task save, and POST /api/project-tasks/[id]/files. Every step runs inside the caller's
// transaction after the task row lock (lock order: the task row, then upload rows, then file rows,
// then link rows). The files and links are projectFiles' own rows: this file only calls its
// functions, which return [] for an empty list without a query, answer UPDATE_NEEDED for a list
// before migration 019 (files) or 020 (links), check the share confirm and write the
// project_file.add, .delete, .link and .unlink audit lines (ids and sizes, never a name).
import { db } from '@/lib/db';
import { AppError, validationError } from '@/lib/errors';
import { projectFiles } from '@/modules/projectFiles';
import { isProjectManager } from '@/modules/projectFiles/access';
import { sendFilesAdded, toldOf } from './messages';
import { MAX_TASK_FILES, projectTaskFilesSchema, TASK_FILES_MESSAGE } from './schemas';
import { lockForManage, parseInput, personOf, teamOf } from './shared';

function tooManyFiles() {
  return new AppError('TOO_MANY_FILES', { status: 409, message: TASK_FILES_MESSAGE });
}

/** The list without repeats (one upload or file sent twice counts once). */
function unique(values) {
  return [...new Set(values ?? [])];
}

/**
 * Attaches held uploads to a locked task and refuses the save past 20 files (its own active files
 * plus its links to active files). The count is a locking read after the task row lock (and after
 * the attach, so this save's own files count), so a snapshot taken earlier can't hide another
 * save's files; a refusal rolls the whole save back.
 * @returns {Promise<object[]>} the new ProjectFile rows
 * @throws VALIDATION_FAILED (`fields.uploadKeys`, from projectFiles), TOO_MANY_FILES (409),
 *   UPDATE_NEEDED (503, before migration 019)
 */
async function addFiles({ user, projectId, taskId, uploadKeys, ip }, trx) {
  const keys = unique(uploadKeys);
  if (keys.length === 0) return [];
  if (keys.length > MAX_TASK_FILES) throw tooManyFiles();
  const files = await projectFiles.attachUploads(
    { user, projectId, taskId, uploadKeys: keys, ip },
    trx,
  );
  const own = await projectFiles.countActiveForTask(taskId, trx);
  const links = await projectFiles.countActiveLinks(taskId, trx);
  if (own + links > MAX_TASK_FILES) throw tooManyFiles();
  return files;
}

/**
 * Links project files to a locked task (CONTRACT 28, Linking), judged against the task's person
 * after this save: an "Only PM and Admins" file for someone who isn't a manager needs
 * `shareConfirmed` and a `shareWith` naming that person (projectFiles checks and fails closed).
 * @param {{ user: object, project: { id: number, pmId: number | null }, taskId: number,
 *   person: { id: number, role: string, status: string } | null, fileIds?: number[],
 *   shareConfirmed?: boolean, shareWith?: number | null, ip?: string | null }} args person:
 *   null for anyone on the project
 * @returns {Promise<object[]>} the newly linked ProjectFile rows
 * @throws VALIDATION_FAILED (`fields.linkFileIds`, `fields.shareConfirmed`), TOO_MANY_FILES (409),
 *   UPDATE_NEEDED (503, before migration 020)
 */
export function linkProjectFiles(
  { user, project, taskId, person, fileIds, shareConfirmed = false, shareWith, ip = null },
  trx,
) {
  const ids = unique(fileIds);
  if (ids.length === 0) return Promise.resolve([]);
  const assignee = person ? { id: person.id, role: person.role, status: person.status } : null;
  return projectFiles.linkFiles(
    {
      user,
      project: { id: project.id, pmId: project.pmId ?? null },
      task: { id: taskId, projectId: project.id, assigneeId: assignee?.id ?? null, assignee },
      fileIds: ids,
      shareConfirmed,
      shareWith,
      ip,
    },
    trx,
  );
}

/**
 * The files of a task just inserted in the create transaction: its held uploads, then the picked
 * project files (linked for the task's person).
 * @param {{ user: object, project: object, taskId: number, person: object | null,
 *   uploadKeys?: string[], linkFileIds?: number[], shareConfirmed?: boolean,
 *   shareWith?: number | null, ip?: string | null }} args
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<object[]>} the uploaded files, then the linked ones
 * @throws as addFiles and linkProjectFiles
 */
export async function attachToNewTask({ user, project, taskId, person, ...input }, trx) {
  const { uploadKeys, linkFileIds, shareConfirmed, shareWith, ip = null } = input;
  const uploaded = await addFiles({ user, projectId: project.id, taskId, uploadKeys, ip }, trx);
  const linked = await linkProjectFiles(
    { user, project, taskId, person, fileIds: linkFileIds, shareConfirmed, shareWith, ip },
    trx,
  );
  return [...uploaded, ...linked];
}

/**
 * An edit's file changes on a locked task, after its person was checked (CONTRACT 28, Edit order):
 * remove own files (soft delete; an id already deleted on this task is skipped by projectFiles),
 * unlink, attach uploads, then link the picked project files for the task's new person.
 * @param {{ user: object, project: object, task: { id: number, projectId: number },
 *   person: object | null, addUploadKeys?: string[], removeFileIds?: number[],
 *   addLinkFileIds?: number[], removeLinkFileIds?: number[], shareConfirmed?: boolean,
 *   shareWith?: number | null, ip?: string | null }} args person: the task's person after the save
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<{ added: object[], removed: object[], unlinked: number[] }>} added: uploads,
 *   then links (ProjectFile rows)
 * @throws VALIDATION_FAILED (`fields.uploadKeys`, `fields.removeFileIds`, `fields.linkFileIds`,
 *   `fields.shareConfirmed`), TOO_MANY_FILES (409), UPDATE_NEEDED (503, a list before 019 or 020)
 */
export async function changeFiles({ user, project, task, person, ...input }, trx) {
  const { addUploadKeys, removeFileIds, addLinkFileIds, removeLinkFileIds, ip = null } = input;
  const fileIds = unique(removeFileIds);
  const removed =
    fileIds.length > 0
      ? await projectFiles.removeTaskFiles({ user, taskId: task.id, fileIds, ip }, trx)
      : [];
  const unlinkIds = unique(removeLinkFileIds);
  const unlinked =
    unlinkIds.length > 0
      ? await projectFiles.unlinkFiles(
          { user, task: { id: task.id, projectId: task.projectId }, fileIds: unlinkIds, ip },
          trx,
        )
      : [];
  const uploaded = await addFiles(
    { user, projectId: task.projectId, taskId: task.id, uploadKeys: addUploadKeys, ip },
    trx,
  );
  const { shareConfirmed, shareWith } = input;
  const linked = await linkProjectFiles(
    {
      user,
      project,
      taskId: task.id,
      person,
      fileIds: addLinkFileIds,
      shareConfirmed,
      shareWith,
      ip,
    },
    trx,
  );
  return { added: [...uploaded, ...linked], removed, unlinked };
}

/**
 * Adds held uploads and project files to an existing task (the task window's "Add files", "From
 * project files" and a drop on a card), then tells the task's person, or every active member for
 * a task for anyone (never the actor; nobody for a done task), in one `files_added` for the batch.
 * @param {{ user: object, id: number, uploadKeys?: string[], linkFileIds?: number[],
 *   shareConfirmed?: boolean, shareWith?: number | '' | null, ip?: string | null }} args one list
 *   at least, together 1 to 20; uploadKeys: the user's own `ready` uploads for this task or new
 *   ones, not expired; linkFileIds: active files of the project's Files tab
 * @returns {Promise<{ files: object[], told: 'person' | 'members' | null,
 *   toldName: string | null }>} files: the new ProjectFile rows (uploads, then links)
 * @throws FORBIDDEN (not the project's PM or Admin), NOT_FOUND, VALIDATION_FAILED ("Add files or
 *   pick project files.", `fields.uploadKeys` "brief.pdf couldn't be added. Add it again.",
 *   `fields.linkFileIds`, `fields.shareConfirmed`), TOO_MANY_FILES (409), UPDATE_NEEDED (503,
 *   uploads before migration 019, links before 020)
 */
export async function attachFiles({ user, id, uploadKeys = [], linkFileIds = [], ...input }) {
  const values = parseInput(projectTaskFilesSchema, {
    uploadKeys,
    linkFileIds,
    shareConfirmed: input.shareConfirmed,
    shareWith: input.shareWith,
  });
  const ip = input.ip ?? null;
  return db.transaction(async (trx) => {
    const { project, before } = await lockForManage(user, id, trx);
    const team = await teamOf(project, trx, { alsoIds: [user.id, before.assigneeId] });
    const person = await personOf(team, before.assigneeId, trx);
    const files = await attachToNewTask(
      { user, project, taskId: before.id, person, ...values, ip },
      trx,
    );
    const reached =
      before.status === 'open'
        ? await sendFilesAdded({ task: before, project, ...team, actor: user, files }, trx)
        : [];
    return { files, ...toldOf(reached, before) };
  });
}

// ---------- the reassign share check (CONTRACT 28, Linking) ----------

export const SHARE_NEW_PERSON =
  'This task has a file only for PM and Admins. Confirm to share it with the new person.';
export const SHARE_BULK =
  'A task you picked has a file only for PM and Admins. Confirm to share it with the new person.';
export const SHARE_STALE =
  'This task is now for someone else. Check who it is for and confirm again.';

const shareRefused = (message) => validationError({ shareConfirmed: message }, message);

/** True when the confirm names this person (`shareWith` null = anyone on the project). */
function namesPerson(shareWith, person) {
  if (shareWith === undefined) return false;
  if (shareWith === null || shareWith === '') return person === null;
  return person !== null && Number(shareWith) === Number(person.id);
}

/**
 * Before a task goes to a new person: when it has links to "Only PM and Admins" files (after this
 * save's unlinks and links) and the new person isn't a manager of the project (the PM or an active
 * Admin; anyone on the project isn't), the save needs the share confirm, naming that person. Taking
 * a task (the viewer manages) never needs it. Nothing is written on a refusal (it throws inside
 * the save's transaction).
 * @param {{ project: { id: number, pmId: number | null },
 *   changes: Array<{ taskId: number, person: { id, role, status } | null }>,
 *   shareConfirmed?: boolean, shareWith?: number | null, bulk?: boolean }} args shareWith: the
 *   single PATCH's person the confirm named (the bulk route names the person in each change)
 * @param {import('knex').Knex.Transaction} trx
 * @throws VALIDATION_FAILED `fields.shareConfirmed` (SHARE_NEW_PERSON, SHARE_BULK or SHARE_STALE)
 */
export async function checkReassignShare(
  { project, changes, shareConfirmed = false, shareWith, bulk = false },
  trx,
) {
  const pending = changes.filter(({ person }) => !isProjectManager(person, project));
  if (pending.length === 0) return;
  const counts = await projectFiles.privateLinkCounts(
    pending.map((change) => change.taskId),
    trx,
  );
  const shared = pending.filter((change) => Number(counts?.[change.taskId] ?? 0) > 0);
  if (shared.length === 0) return;
  if (shareConfirmed !== true) throw shareRefused(bulk ? SHARE_BULK : SHARE_NEW_PERSON);
  if (!bulk && !shared.every(({ person }) => namesPerson(shareWith, person))) {
    throw shareRefused(SHARE_STALE);
  }
}
