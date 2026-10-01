// GET /api/projects?status=&mine=1&q= (anyone signed in; mine=1: projects the person is a member
// or the PM of) and POST /api/projects (New project).
import { listResult, withRoute } from '@/lib/route';
import { projects } from '@/modules/projects';
import { projectCreateSchema, projectListQuerySchema } from '@/modules/projects/schemas';

export const GET = withRoute(
  { permission: 'signed_in', query: projectListQuerySchema },
  async ({ user, query }) => {
    const { status, mine, q, limit, offset } = query;
    const { rows, total } = await projects.list({
      status,
      mineFor: mine ? user.id : undefined,
      q,
      limit,
      offset,
    });
    return listResult(rows, { limit, offset, total });
  },
);

export const POST = withRoute(
  { permission: 'project.manage', body: projectCreateSchema, status: 201 },
  async ({ user, body, ip }) => projects.create({ user, input: body, ip }),
);
