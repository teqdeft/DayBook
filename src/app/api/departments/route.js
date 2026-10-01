// Departments with active head counts, for pickers.
import { withRoute } from '@/lib/route';
import { users } from '@/modules/users';

export const GET = withRoute({ permission: 'signed_in' }, async () => users.listDepartments());
