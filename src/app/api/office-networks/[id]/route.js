import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { settings } from '@/modules/settings';
import { officeNetworkIdSchema } from '@/modules/settings/schemas';

export const DELETE = withRoute({ permission: 'settings.manage' }, async ({ user, params, ip }) => {
  const parsed = officeNetworkIdSchema.safeParse(params);
  if (!parsed.success) throw new AppError('NOT_FOUND');
  return settings.removeOfficeNetwork({ user, id: parsed.data.id, ip });
});
