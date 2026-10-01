// Reactivate a deactivated person so they can sign in again.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { users } from '@/modules/users';
import { userIdParamSchema } from '@/modules/users/schemas';

export const POST = withRoute({ permission: 'people.manage' }, async ({ user, params, ip }) => {
  const parsed = userIdParamSchema.safeParse(params);
  if (!parsed.success) throw new AppError('NOT_FOUND');
  return users.reactivate({ user, id: parsed.data.id, ip });
});
