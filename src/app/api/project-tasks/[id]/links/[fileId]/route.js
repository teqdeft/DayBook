// DELETE /api/project-tasks/:id/links/:fileId → { data: { removed: true } }: takes a project file
// off a task (CONTRACT 28, API); the file stays in Files. The browser sends it after its 6 s Undo
// toast, so Undo never reaches the server; a link already gone answers the same. The project's PM
// and Admins (the service: 403 "You can't change files on this project." to anyone who can see the
// task, else 404 "We couldn't find that task."); UPDATE_NEEDED (503) before migration 020; 120 a
// minute per person. No notification.
import { checkRateLimit, withRoute } from '@/lib/route';
import { projectFiles } from '@/modules/projectFiles';
import { fileNotFound, taskNotFound } from '@/modules/projectFiles/errors';
import { routeId } from '@/modules/projectPlan/schemas';

// Per person, not per IP: behind the office network everyone shares one address.
const PER_PERSON = { key: 'project-task-links', limit: 120, windowMs: 60_000 };
const ROUTE = '/api/project-tasks/[id]/links/[fileId]';

export const DELETE = withRoute({ permission: 'project.manage' }, async ({ user, params, ip }) => {
  checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
  const taskId = routeId(params);
  if (!taskId) throw taskNotFound();
  const fileId = routeId({ id: params?.fileId });
  if (!fileId) throw fileNotFound();
  return projectFiles.unlinkFile({ user, taskId, fileId, ip });
});
