// Server only: loads what the shell needs (company name, nav badges) and renders the sidebar and
// main area around a page. Used by src/app/(app)/layout.js and by the not-found page for
// signed-in people.
import { homePathFor, navigationFor } from '@/config/navigation';
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { dashboard } from '@/modules/dashboard';
import { push } from '@/modules/push';
import { settings } from '@/modules/settings';
import ActivityTracker from './ActivityTracker';
import AppShell from './AppShell';
import { PushSync } from './PushSwitch';
import Sidebar from './Sidebar';
import { ToastProvider } from './ToastProvider';

async function safely(promise, fallback, message, userId) {
  try {
    return await promise;
  } catch (error) {
    logger.warn({ err: error, userId }, message);
    return fallback;
  }
}

/**
 * @param {{ user: object, children: import('react').ReactNode }} props  `user` is the session user.
 */
export default async function AppFrame({ user, children }) {
  const [all, badges] = await Promise.all([
    safely(settings.getAll(), {}, 'shell: could not load settings', user.id),
    safely(dashboard.getNavBadges(user), {}, 'shell: could not load nav badges', user.id),
  ]);
  const items = navigationFor(user, badges ?? {});
  // Screen time (CONTRACT 11): only tracked people with activity.self, while it's turned on.
  const tracksScreenTime =
    all?.activityTrackingEnabled === true && can(user, 'activity.self') && user.tracksAttendance;
  // Desktop notifications (CONTRACT 14): only the public key goes to the browser.
  const pushKey = all?.pushEnabled === true ? push.publicKey() : null;

  return (
    <ToastProvider>
      <AppShell
        sidebar={
          <Sidebar
            items={items}
            companyName={all?.companyName}
            homeHref={homePathFor(user)}
            user={{
              name: user.name,
              email: user.email,
              designation: user.designation ?? user.roleLabel,
              initials: user.initials,
              avatarUrl: user.avatarUrl,
            }}
          />
        }
      >
        {children}
      </AppShell>
      {tracksScreenTime ? (
        <ActivityTracker userId={user.id} idleMinutes={all.activityIdleMinutes} />
      ) : null}
      {pushKey ? <PushSync push={{ publicKey: pushKey, userId: user.id }} /> : null}
    </ToastProvider>
  );
}
