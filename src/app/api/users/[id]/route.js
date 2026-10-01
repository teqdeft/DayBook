// One person: read (People or Team viewers) and edit profile fields (never the role).
import { can } from '@/lib/permissions';
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { users } from '@/modules/users';
import { updateUserSchema, userIdParamSchema } from '@/modules/users/schemas';

function personId(params) {
  const parsed = userIdParamSchema.safeParse(params);
  if (!parsed.success) throw new AppError('NOT_FOUND');
  return parsed.data.id;
}

export const GET = withRoute({ permission: 'signed_in' }, async ({ user, params }) => {
  const id = personId(params);
  const managesPeople = can(user, 'people.manage');
  if (!managesPeople && !can(user, 'team.view') && id !== user.id) throw new AppError('FORBIDDEN');
  const person = await users.findById(id);
  // Team viewers only see active people (deactivated people leave dashboards).
  if (!person || (!managesPeople && id !== user.id && person.status !== 'active')) {
    throw new AppError('NOT_FOUND');
  }
  return person;
});

export const PATCH = withRoute(
  { permission: 'people.manage', body: updateUserSchema },
  async ({ user, params, body, ip }) =>
    users.update({ user, id: personId(params), input: body, ip }),
);
