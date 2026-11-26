// The viewer's ctx on one project (CONTRACT 27, Who sees and does what), shared by reads.js and
// linkReads.js: `{ projectId, userId, active, manages, member }`, built for one viewer and one
// project from the database each time (nothing is cached per person), plus the small id helpers
// both read files use.
import { projects } from '@/modules/projects';
import * as repo from './repo';

/** A positive whole id, or null. */
export const toId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** The distinct positive ids of a list (of ids, or of what `of` picks from each item). */
export const uniqueIds = (list, of = (item) => item) => [
  ...new Set((list ?? []).map((item) => toId(of(item))).filter(Boolean)),
];

/** The items of a list by a key, in order (Node 20 has no Map.groupBy). */
export function groupBy(list, keyOf) {
  const groups = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

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

/**
 * One ctx per project for one viewer, built once per call (tasks may span projects: Today, My
 * tasks), so a ctx is never shared by several projects. An unknown project gives null.
 * @param {object} viewer
 * @returns {(projectId: number) => Promise<import('./access').FilesCtx | null>}
 */
export function contextsFor(viewer) {
  const contexts = new Map();
  return (projectId) => {
    const id = Number(projectId);
    if (!contexts.has(id)) {
      const ctx = projects
        .findById(id)
        .then((project) => (project ? viewerContext({ viewer, project }) : null));
      contexts.set(id, ctx);
    }
    return contexts.get(id);
  };
}
