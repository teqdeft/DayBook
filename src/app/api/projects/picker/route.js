// GET /api/projects/picker: urgent, mine, then other active projects, plus pending requests.
import { withRoute } from '@/lib/route';
import { projects } from '@/modules/projects';

export const GET = withRoute({ permission: 'report.self' }, async ({ user }) =>
  projects.getPickerFor(user.id),
);
