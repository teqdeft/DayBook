// The signed-in person: profile, role, permissions and today's check-in state.
import { withRoute } from '@/lib/route';
import { workDate } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';

export const GET = withRoute({ permission: 'signed_in' }, async ({ user }) => {
  const { timezone } = await settings.getAll();
  const today = workDate(timezone);
  const [profile, row] = await Promise.all([
    users.findById(user.id),
    attendance.getForUserOnDate(user.id, today),
  ]);
  return {
    user: profile,
    permissions: user.permissions,
    workDate: today,
    today: row ?? null,
  };
});
