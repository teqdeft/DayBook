// GET /api/projects/:id/files?taskId=88 → { data: { files, places, taskPhase, linksReady } }: the
// "From project files" picker (CONTRACT 28, API): the project's active project files, newest first
// (at most 500), each with `onThisTask` (for `taskId`) and `linkCount`, the places with their
// counts and the task's phase. The project's PM and Admins only (the service: 403 "You can't change
// files on this project." for a member or another PM, 404 for a project or task it can't find);
// 400 for an id that isn't a number; UPDATE_NEEDED (503) before migration 019, and
// `linksReady: false` before 020. `Cache-Control: no-store`; 120 a minute per person.
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { projectFiles } from '@/modules/projectFiles';
import { routeId } from '@/modules/projectPlan/schemas';

// Per person, not per IP: behind the office network everyone shares one address.
const PER_PERSON = { key: 'project-files-picker', limit: 120, windowMs: 60_000 };
const ROUTE = '/api/projects/[id]/files';

const badId = () => new AppError('BAD_REQUEST');

/** `?taskId=` as a task id, null when it isn't given; anything but a plain number is a 400. */
function taskIdOf(query) {
  const value = query?.taskId;
  if (value === undefined || value === '') return null;
  const id = routeId({ id: value });
  if (!id) throw badId();
  return id;
}

export const GET = withRoute({ permission: 'project.manage' }, async ({ user, params, query }) => {
  checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
  const projectId = routeId(params);
  if (!projectId) throw badId();
  const taskId = taskIdOf(query);
  const data = await projectFiles.pickerFiles({ viewer: user, projectId, taskId });
  return Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
});
