// GET /api/clients?q=&limit=&offset=: clients for the project form's Client field.
import { withRoute } from '@/lib/route';
import { projects } from '@/modules/projects';
import { clientListQuerySchema } from '@/modules/projects/schemas';

export const GET = withRoute(
  { permission: 'project.manage', query: clientListQuerySchema },
  async ({ query }) =>
    projects.listClients({ q: query.q, limit: query.limit, offset: query.offset }),
);
