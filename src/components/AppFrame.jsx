// Server only: loads what the shell needs (company name, nav badges, the timer state for the
// sidebar's timer chip) and renders the sidebar and main area around a page. Used by
// src/app/(app)/layout.js and by the not-found page for signed-in people.
import { cache } from 'react';
import { homePathFor, navigationFor } from '@/config/navigation';
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { dashboard } from '@/modules/dashboard';
import { push } from '@/modules/push';
import { settings } from '@/modules/settings';
import { timers } from '@/modules/timers';
import ActivityTracker from './ActivityTracker';
import AppShell from './AppShell';
import { PushSync } from './PushSwitch';
import Sidebar from './Sidebar';
import TimerChip from './TimerChip';
import { ToastProvider } from './ToastProvider';

// React's cache lasts one server request: the layout and the page share these.
const timerStates = cache(() => new Map());

/**
 * timers.getState for the signed-in person, read once per request (CONTRACT 15): the sidebar's
 * chip and Today's Working on card render the same state.
 * @param {object} user the session user (one who can use timers)
 * @returns {Promise<object>}
 */
export function timerStateFor(user) {
  const states = timerStates();
  if (!states.has(user.id)) states.set(user.id, timers.getState({ user }));
  return states.get(user.id);
}

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
  // Timers (CONTRACT 15): only for people who can use them; a failure just hides the chip. The
  // state is read even while timers are off: a timer left running then still shows, with Stop.
  const [all, badges, timerState] = await Promise.all([
    safely(settings.getAll(), {}, 'shell: could not load settings', user.id),
    safely(dashboard.getNavBadges(user), {}, 'shell: could not load nav badges', user.id),
    timers.canUse(user)
      ? safely(timerStateFor(user), null, 'shell: could not load the timer', user.id)
      : null,
  ]);
  const timersOff = timerState?.mode === 'off' || all?.timersMode === 'off';
  const showTimer = Boolean(timerState?.canUse) && (!timersOff || Boolean(timerState.running));
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
            footer={showTimer ? <TimerChip initialState={timerState} /> : null}
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
