// POST /api/ai/projects/:id/summary writes or updates a project's AI summary from its files and notes
// (the project's PM or Admin) and returns it. AI_OFF while Settings → AI has it off, AI_LIMIT past
// today's limits, RATE_LIMITED past 4 a minute for one person, 413 for a body over 1 MB. It takes no
// fields.
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { routeId } from '@/modules/projectPlan/schemas';
import { projectSummaries } from '@/modules/projectSummaries';
import { readLimitedJson } from '@/modules/projectSummaries/readBody';

// Per person, not per IP or project: behind the office network everyone shares one address. The
// daily cap (15) is the real limit; this only stops a stuck page or script.
const PER_PERSON = { key: 'ai-project-summary', limit: 4, windowMs: 60_000 };

export const POST = withRoute(
  { permission: 'project.manage' },
  async ({ user, params, ip, request }) => {
    checkRateLimit(PER_PERSON, '/api/ai/projects/summary', `user:${user.id}`);
    const projectId = routeId(params);
    if (!projectId) throw new AppError('NOT_FOUND');
    await readLimitedJson(request);
    return projectSummaries.writeSummary({ user, projectId, ip });
  },
);
