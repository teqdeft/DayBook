// Change a person's role (Admin only). The last active Admin keeps the Admin role.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { users } from '@/modules/users';
import { changeRoleSchema, userIdParamSchema } from '@/modules/users/schemas';

export const PATCH = withRoute(
  { permission: 'roles.manage', body: changeRoleSchema },
  async ({ user, params, body, ip }) => {
    const parsed = userIdParamSchema.safeParse(params);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return users.changeRole({ user, id: parsed.data.id, role: body.role, ip });
  },
);
