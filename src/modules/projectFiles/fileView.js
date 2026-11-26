// The `ProjectFile` shape (CONTRACT 27, Modules, with CONTRACT 28's link fields): `toProjectFile`
// is the one mapper every answer uses (reads.js, linkReads.js, links.js and manage.js too).
// `projectFilesFor` answers the files just added: Finish of a project file, the files a task save
// or the attach call added, the files just linked, and storeFile. These files are new to the task,
// so none has `hasText` here.
import { db } from '@/lib/db';
import { projects } from '@/modules/projects';
import { kindOf, pictureType, typeLabel } from './kinds';

/** A picture without a thumbnail is shown itself when it is at most 2 MB (Downloads). */
const SMALL_PICTURE_BYTES = 2 * 1_048_576;

/**
 * One `ProjectFile` from a `project_files` row joined with its task and its creator. The link
 * fields of CONTRACT 28 default to "no links": `linked` (an entry shown on a task through a link),
 * `linkCount` and `linkedTasks` (the tasks this viewer may see it on) and `sharedByLink` (a member
 * reaches an "Only PM and Admins" file only through a link).
 * @param {object} row project_files columns plus taskTitle, taskPhase, taskAssigneeId,
 *   creatorName
 * @param {{ canManage: boolean, hasText?: boolean, linked?: boolean, linkCount?: number,
 *   linkedTasks?: object[], sharedByLink?: boolean }} options
 * @returns {import('./service').ProjectFile}
 */
export function toProjectFile(row, { canManage, hasText = false, ...links }) {
  const id = Number(row.id);
  const base = `/api/project-files/${id}`;
  const shown = Boolean(row.isPicture) && pictureType(row.ext) !== null;
  const viewUrl = shown ? `${base}/view` : null;
  let thumbUrl = null;
  if (shown && row.hasThumb) thumbUrl = `${base}/thumb`;
  else if (shown && Number(row.sizeBytes) <= SMALL_PICTURE_BYTES) thumbUrl = viewUrl;
  const task =
    row.scope === 'task' && row.taskId
      ? {
          id: Number(row.taskId),
          title: row.taskTitle,
          phase: row.taskPhase ?? null,
          assigneeId: row.taskAssigneeId === null ? null : Number(row.taskAssigneeId),
        }
      : null;
  return {
    id,
    projectId: Number(row.projectId),
    scope: row.scope,
    taskId: row.taskId === null ? null : Number(row.taskId),
    phase: row.scope === 'task' ? null : (row.phase ?? null),
    visibility: row.visibility,
    name: row.name,
    ext: row.ext,
    kind: kindOf(row.ext),
    typeLabel: typeLabel(row.ext),
    sizeBytes: Number(row.sizeBytes),
    isPicture: shown,
    thumbUrl,
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    createdBy: { id: Number(row.createdBy), name: row.creatorName ?? '' },
    createdAt: row.createdAt,
    task,
    hasText: canManage ? Boolean(hasText) : false,
    downloadUrl: base,
    viewUrl,
    canManage,
    linked: Boolean(links.linked),
    linkCount: Number(links.linkCount ?? 0),
    linkedTasks: links.linkedTasks ?? [],
    sharedByLink: Boolean(links.sharedByLink),
  };
}

/**
 * Files by id, in the order given, as the viewer gets them (the viewer added them: a manager).
 * @param {{ viewer: object, ids: number[] }} args
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<import('./service').ProjectFile[]>}
 */
export async function projectFilesFor({ viewer, ids }, trx = db) {
  if (!ids.length) return [];
  const rows = await trx('projectFiles as f')
    .join('projects as p', 'p.id', 'f.projectId')
    .leftJoin('projectTasks as t', 't.id', 'f.taskId')
    .leftJoin('users as u', 'u.id', 'f.createdBy')
    .whereIn('f.id', ids)
    .select(
      'f.*',
      'p.pmId as projectPmId',
      't.title as taskTitle',
      't.phase as taskPhase',
      't.assigneeId as taskAssigneeId',
      'u.name as creatorName',
    );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return ids
    .map((id) => byId.get(Number(id)))
    .filter(Boolean)
    .map((row) =>
      toProjectFile(row, {
        canManage: projects.canManage(viewer, { id: row.projectId, pmId: row.projectPmId }),
      }),
    );
}

/**
 * One file as the viewer who just added it gets it.
 * @param {{ viewer: object, id: number }} args
 * @param {import('knex').Knex.Transaction} [trx]
 * @returns {Promise<import('./service').ProjectFile | null>}
 */
export async function projectFileFor({ viewer, id }, trx = db) {
  const [file] = await projectFilesFor({ viewer, ids: [Number(id)] }, trx);
  return file ?? null;
}
