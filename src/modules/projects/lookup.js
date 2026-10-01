// Reads shared by the projects service files (kept apart so the files don't import each other).
import { db } from '@/lib/db';
import { compactName } from '@/lib/text';
import * as repo from './repo';
import { toPerson, toProject } from './shared';

/** One project (contract shape) inside or outside a transaction. */
export async function loadProject(id, trx = db) {
  return toProject(await repo.findById(id, trx));
}

/** Adds `members` (active people only, in the order they were added) to each project. */
export async function attachMembers(projects, trx = db) {
  const rows = await repo.listMembers(
    projects.map((project) => project.id),
    trx,
  );
  const byProject = new Map(projects.map((project) => [project.id, []]));
  for (const row of rows) {
    if (row.status !== 'active') continue;
    byProject.get(row.projectId)?.push(toPerson(row));
  }
  return projects.map((project) => ({ ...project, members: byProject.get(project.id) ?? [] }));
}

/**
 * The first existing project or pending request whose name matches, ignoring case, spaces,
 * dashes and underscores.
 * @param {string} name
 * @param {{ excludeProjectId?: number, excludeRequestId?: number, ignoreRequestsLike?: string }}
 *   [options] ignoreRequestsLike: pending requests with this name (compared the same way) don't
 *   count, used when one of them is being approved
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<null | { kind: 'project', id: number, name: string, status: string }
 *   | { kind: 'request', requestId: number, name: string, requestedBy: number,
 *   requestedByName: string }>}
 */
export async function findSimilarName(
  name,
  { excludeProjectId, excludeRequestId, ignoreRequestsLike } = {},
  trx = db,
) {
  const key = compactName(name);
  if (!key) return null;
  const projects = await repo.listAllNames(trx);
  const project = projects.find(
    (row) => row.id !== excludeProjectId && compactName(row.name) === key,
  );
  if (project) {
    return { kind: 'project', id: project.id, name: project.name, status: project.status };
  }
  if (ignoreRequestsLike !== undefined && compactName(ignoreRequestsLike) === key) return null;
  const requests = await repo.listPendingRequestNames(trx);
  const request = requests.find(
    (row) => row.id !== excludeRequestId && compactName(row.name) === key,
  );
  if (!request) return null;
  return {
    kind: 'request',
    requestId: request.id,
    name: request.name,
    requestedBy: request.requestedBy,
    requestedByName: request.requesterName,
  };
}
