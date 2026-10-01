// People list (People screen, top bar search) and Add employee.
import { listResult, withRoute } from '@/lib/route';
import { users } from '@/modules/users';
import { addUserSchema, listUsersQuerySchema } from '@/modules/users/schemas';

// people.manage sees everyone; team.view sees active people. The service checks both.
export const GET = withRoute(
  { permission: 'signed_in', query: listUsersQuerySchema },
  async ({ user, query }) => {
    const { rows, total, limit, offset } = await users.list({ user, ...query });
    return listResult(rows, { limit, offset, total });
  },
);

export const POST = withRoute(
  { permission: 'people.manage', body: addUserSchema, status: 201 },
  async ({ user, body, ip }) => users.add({ user, input: body, ip }),
);
