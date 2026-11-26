// Reads with links (CONTRACT 28, Every read with links): the links a member's access needs, the
// linked files a viewer may see on a task, the Files tab's "On 2 tasks" and "Shared with you" fields,
// the board's file chips, the 20-file count of links and the private-link counts (the picker is
// in links.js). Every read
// builds a file's `links` the same way (linkRepo, from the task rows, never a caller's copy), and a
// task-scoped list or count uses `canSeeLinkedOnTask`, so a member's data never holds another
// person's task. Before migration 020 links read as none (guard020Read): 1.12's answers.
import { accessShape, canSeeFile, canSeeLinkedOnTask, isProjectManager } from './access';
import { toProjectFile } from './fileView';
import { guard019Read } from './migration019';
import { guard020Read } from './migration020';
import * as linkRepo from './linkRepo';
import * as repo from './repo';
import { contextsFor, groupBy, uniqueIds } from './viewer';

/** Chips per card (Limits). */
const CHIPS_PER_TASK = 2;

/** Adds `by` to `counts[key]`. */
export const bump = (counts, key, by = 1) => {
  counts[key] = (counts[key] ?? 0) + by;
};

/** A project file only PM and Admins see: the one kind whose links a member's access needs. */
const isPrivateProjectFile = (row) => row.scope === 'project' && row.visibility !== 'everyone';

/** A link row as `canSeeFile` reads it. */
const toAccessLink = (link) => ({
  taskId: Number(link.taskId),
  assigneeId:
    link.assigneeId === null || link.assigneeId === undefined ? null : Number(link.assigneeId),
  projectId: Number(link.projectId),
});

/**
 * The links that decide a member's access, read only where they matter (a member and an "Only PM
 * and Admins" project file); managers and Everyone files never need the query.
 * @param {import('./access').FilesCtx} ctx
 * @param {Array<{ id: number, scope: string, visibility: string }>} rows
 * @returns {Promise<Map<number, import('./access').FileLink[]>>}
 */
export async function linksNeeded(ctx, rows) {
  if (!ctx?.active || ctx.manages || !ctx.member) return new Map();
  const ids = uniqueIds(rows.filter(isPrivateProjectFile), (row) => row.id);
  if (ids.length === 0) return new Map();
  return guard020Read(
    'links',
    () => linkRepo.linksForFiles(ids, ctx.projectId),
    () => new Map(),
  );
}

/**
 * The linked rows (listLinkedForTasks) this viewer may see on their task (`canSeeLinkedOnTask`).
 * @param {import('./access').FilesCtx} ctx
 * @param {object[]} rows linked rows of the ctx's project
 * @param {Map<number, import('./access').FileLink[]>} links linksNeeded's
 */
export function seenLinked(ctx, rows, links) {
  return rows.filter((row) =>
    canSeeLinkedOnTask(ctx, accessShape(row, links.get(Number(row.id)) ?? []), {
      assigneeId: row.linkAssigneeId ?? null,
    }),
  );
}

/**
 * Adds the linked active files of these tasks the viewer may see on them to `counts` (one query
 * for the links, one ctx per project).
 * @param {number[]} ids task ids
 * @param {(projectId: number) => Promise<object | null>} contextOf contextsFor's
 * @param {Record<number, number>} counts
 */
export async function countLinked(ids, contextOf, counts) {
  const rows = await guard020Read(
    'links',
    () => linkRepo.countLinkedByTask(ids),
    () => [],
  );
  for (const [projectId, links] of groupBy(rows, (row) => Number(row.projectId))) {
    const ctx = await contextOf(projectId);
    if (!ctx) continue;
    const fileLinks = await linksNeeded(
      ctx,
      links.map((row) => ({ id: row.fileId, scope: 'project', visibility: row.visibility })),
    );
    for (const row of links) {
      const file = {
        projectId,
        scope: 'project',
        status: 'active',
        visibility: row.visibility,
        links: fileLinks.get(row.fileId) ?? [],
      };
      if (canSeeLinkedOnTask(ctx, file, { assigneeId: row.assigneeId })) bump(counts, row.taskId);
    }
  }
}

// ---------- the Files tab ----------

/** A linked task as managers get it, with its person for Edit details' line. */
function managerTask(link, project) {
  const assigneeId = toAccessLink(link).assigneeId;
  const person =
    assigneeId === null
      ? null
      : { id: assigneeId, role: link.assigneeRole, status: link.assigneeStatus };
  return {
    id: Number(link.taskId),
    title: link.taskTitle,
    assigneeId,
    assigneeName: assigneeId === null ? null : (link.assigneeName ?? null),
    assigneeManages: isProjectManager(person, project),
  };
}

/**
 * The Files tab's files with their link fields: each project file's `linkCount`, `linkedTasks`
 * (managers: every task with its person; anyone else: only their own and Anyone tasks, whatever the
 * file's setting) and `sharedByLink`, and the links this viewer may see for "On tasks".
 * @param {import('./access').FilesCtx} ctx
 * @param {{ id: number, pmId: number | null }} project
 * @param {object[]} rows repo.listActiveForProject's
 * @param {object[]} linkRows linkRepo.linksForProject's
 * @returns {{ files: Array<{ row: object, fields: object }>, links: Array<{ fileId: number,
 *   taskId: number, taskTitle: string, taskPhase: string | null,
 *   taskAssigneeId: number | null }> }}
 */
export function filesWithLinks(ctx, project, rows, linkRows) {
  const byFile = groupBy(linkRows, (link) => Number(link.fileId));
  const files = [];
  const links = [];
  for (const row of rows) {
    const fileLinks = byFile.get(Number(row.id)) ?? [];
    const shape = accessShape(row, fileLinks.map(toAccessLink));
    if (!canSeeFile(ctx, shape)) continue;
    if (row.scope !== 'project') {
      files.push({ row, fields: {} });
      continue;
    }
    const seen = fileLinks.filter((link) => canSeeLinkedOnTask(ctx, shape, toAccessLink(link)));
    const linkedTasks = seen.map((link) =>
      ctx.manages ? managerTask(link, project) : { id: Number(link.taskId), title: link.taskTitle },
    );
    const sharedByLink = !ctx.manages && row.visibility !== 'everyone';
    files.push({ row, fields: { linkCount: linkedTasks.length, linkedTasks, sharedByLink } });
    for (const link of seen) {
      links.push({
        fileId: Number(row.id),
        taskId: Number(link.taskId),
        taskTitle: link.taskTitle,
        taskPhase: link.taskPhase ?? null,
        taskAssigneeId: toAccessLink(link).assigneeId,
      });
    }
  }
  return { files, links };
}

// ---------- the board's file chips ----------

/** A file as a card's chip. */
const toChip = (file) => ({
  id: file.id,
  name: file.name,
  ext: file.ext,
  kind: file.kind,
  typeLabel: file.typeLabel,
  isPicture: file.isPicture,
  thumbUrl: file.thumbUrl,
  viewUrl: file.viewUrl,
  downloadUrl: file.downloadUrl,
  sizeBytes: file.sizeBytes,
});

const timeOf = (value) => (value ? new Date(value).getTime() : 0);

/** Pictures with a thumbnail first, then the oldest on the task first (own and linked mixed). */
function chipOrder(a, b) {
  const pictureA = a.file.isPicture && a.file.thumbUrl !== null ? 0 : 1;
  const pictureB = b.file.isPicture && b.file.thumbUrl !== null ? 0 : 1;
  return pictureA - pictureB || a.at - b.at || a.file.id - b.file.id;
}

/**
 * The files line of each card and the Table's Files count: own files plus linked files the viewer
 * may see on that task (`canSeeLinkedOnTask`), and the first 2 as chips. Two file queries for any
 * number of tasks, one ctx per project.
 * @param {{ viewer: object, tasks: Array<{ id: number }> }} args
 * @returns {Promise<Record<number, { count: number,
 *   chips: import('./service').FileChip[] }>>} only tasks with files
 */
export async function chipsForTasks({ viewer, tasks }) {
  const ids = uniqueIds(tasks, (task) => task?.id);
  if (ids.length === 0) return {};
  const [own, linked] = await Promise.all([
    guard019Read(
      'files',
      () => repo.listActiveForTasks(ids),
      () => [],
    ),
    guard020Read(
      'links',
      () => linkRepo.listLinkedForTasks(ids),
      () => [],
    ),
  ]);
  const contextOf = contextsFor(viewer);
  const onTask = new Map();
  const add = (taskId, row, at) => {
    const id = Number(taskId);
    if (!onTask.has(id)) onTask.set(id, []);
    onTask.get(id).push({ file: toProjectFile(row, { canManage: false }), at: timeOf(at) });
  };
  for (const row of own) {
    const ctx = await contextOf(row.projectId);
    if (ctx && canSeeFile(ctx, accessShape(row))) add(row.taskId, row, row.createdAt);
  }
  for (const [projectId, rows] of groupBy(linked, (row) => Number(row.linkProjectId))) {
    const ctx = await contextOf(projectId);
    if (!ctx) continue;
    const links = await linksNeeded(ctx, rows);
    for (const row of seenLinked(ctx, rows, links)) add(row.linkTaskId, row, row.linkCreatedAt);
  }
  const chips = {};
  for (const [taskId, entries] of onTask) {
    const shown = [...entries].sort(chipOrder).slice(0, CHIPS_PER_TASK);
    chips[taskId] = { count: entries.length, chips: shown.map((entry) => toChip(entry.file)) };
  }
  return chips;
}

// ---------- the 20-file limit and the private-link counts ----------

/**
 * The task's links to active files, counted after the task row lock for the 20-file limit: the
 * task's own link rows (linkRepo.linkRows: under the task row lock, never a join with
 * project_files, which would lock file rows another link save holds shared), then a plain count of
 * those files that are active. A file deleted meanwhile only lowers the count. Before 020: 0.
 * @param {number} taskId
 * @param {import('knex').Knex.Transaction} trx
 * @param {number[] | null} [linkedIds] the link rows this save already read (linkFiles)
 * @returns {Promise<number>}
 */
export async function countActiveLinks(taskId, trx, linkedIds = null) {
  return guard020Read(
    'links',
    async () => {
      const ids = linkedIds ?? (await linkRepo.linkRows(Number(taskId), null, trx));
      return linkRepo.countActiveAmong(ids, trx);
    },
    () => 0,
  );
}

/**
 * Links to active "Only PM and Admins" files per task (B's reassign share check, the board's
 * `privateLinkCount`, `TaskDetails`); inside `trx` a shared locking read. Before 020: {}.
 * @param {number[]} taskIds
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<Record<number, number>>} task id → n, only tasks with private links
 */
export async function privateLinkCounts(taskIds, trx) {
  const ids = uniqueIds(taskIds);
  if (ids.length === 0) return {};
  const rows = await guard020Read(
    'links',
    () => linkRepo.countPrivateByTask(ids, trx),
    () => [],
  );
  return Object.fromEntries(rows.map((row) => [row.taskId, row.count]));
}
