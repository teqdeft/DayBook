// PUT /api/projects/:id/members { userIds }: replaces the member list.
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { projects } from '@/modules/projects';
import { projectMembersSchema, routeId } from '@/modules/projects/schemas';

export const PUT = withRoute(
  { permission: 'project.manage', body: projectMembersSchema },
  async ({ user, params, body, ip }) => {
    const id = routeId(params);
    if (!id) throw new AppError('NOT_FOUND');
    return projects.setMembers({ user, id, userIds: body.userIds, ip });
  },
);
