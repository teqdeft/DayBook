// GET /api/project-requests?status=pending (PMs and Admins) and POST /api/project-requests
// { name, note, sendAnyway? }. POST answers 200 with { request: null, similarProject } when a
// similar project exists and the request was not sent, and 201 once it is saved.
import { listResult, withRoute } from '@/lib/route';
import { projects } from '@/modules/projects';
import {
  projectRequestCreateSchema,
  projectRequestListQuerySchema,
} from '@/modules/projects/schemas';

export const GET = withRoute(
  { permission: 'project_request.handle', query: projectRequestListQuerySchema },
  async ({ user, query }) => {
    const { status, limit, offset } = query;
    const { rows, total } = await projects.listRequests({ user, status, limit, offset });
    return listResult(rows, { limit, offset, total });
  },
);

export const POST = withRoute(
  { permission: 'project.request', body: projectRequestCreateSchema },
  async ({ user, body, ip }) => {
    const result = await projects.createRequest({ user, input: body, ip });
    return Response.json({ data: result }, { status: result.request ? 201 : 200 });
  },
);
