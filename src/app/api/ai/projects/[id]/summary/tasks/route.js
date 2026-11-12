// POST /api/ai/projects/:id/summary/tasks { actionKey } adds an action item of the summary as one P2
// task in the current phase (the project's PM or Admin), once. SUMMARY_CHANGED (409) when the item is
// gone, 413 for a body over 1 MB.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { routeId } from '@/modules/projectPlan/schemas';
import { projectSummaries } from '@/modules/projectSummaries';
import { readLimitedJson } from '@/modules/projectSummaries/readBody';

export const POST = withRoute(
  { permission: 'project.manage' },
  async ({ user, params, ip, request }) => {
    const projectId = routeId(params);
    if (!projectId) throw new AppError('NOT_FOUND');
    const input = await readLimitedJson(request);
    return projectSummaries.addActionAsTask({ user, projectId, actionKey: input?.actionKey, ip });
  },
);
