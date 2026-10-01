import { withRoute } from '@/lib/route';
import { settings } from '@/modules/settings';
import { officeNetworkSchema } from '@/modules/settings/schemas';

export const GET = withRoute({ permission: 'settings.manage' }, async () =>
  settings.listOfficeNetworks(),
);

export const POST = withRoute(
  { permission: 'settings.manage', body: officeNetworkSchema, status: 201 },
  async ({ user, body, ip }) => settings.addOfficeNetwork({ user, ...body, ip }),
);
