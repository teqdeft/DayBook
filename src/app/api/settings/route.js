import { withRoute } from '@/lib/route';
import { settings } from '@/modules/settings';
import { settingsUpdateSchema } from '@/modules/settings/schemas';

export const GET = withRoute({ permission: 'settings.manage' }, async () => settings.getAll());

export const PUT = withRoute(
  { permission: 'settings.manage', body: settingsUpdateSchema },
  async ({ user, body, ip }) => settings.update({ user, values: body, ip }),
);
