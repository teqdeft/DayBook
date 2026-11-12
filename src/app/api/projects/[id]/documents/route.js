// POST /api/projects/:id/documents { phase, kind, title, text, pages?, pagesTotal? } adds a file's
// text or a note to a phase (the project's PM or Admin) and returns it without its text. A body over
// 1 MB is refused with 413 before it is parsed; the service validates the fields.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projectSummaries } from '@/modules/projectSummaries';
import { readLimitedJson } from '@/modules/projectSummaries/readBody';
import { routeId } from '@/modules/projectPlan/schemas';

export const POST = withRoute(
  { permission: 'project.manage', status: 201 },
  async ({ user, params, ip, request }) => {
    const projectId = routeId(params);
    if (!projectId) throw new AppError('NOT_FOUND');
    const input = await readLimitedJson(request);
    return projectSummaries.addDocument({ user, projectId, input, ip });
  },
);
