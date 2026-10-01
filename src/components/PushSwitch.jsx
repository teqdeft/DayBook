'use client';
// Desktop notifications in the browser (CONTRACT 14). PushSync (mounted once in AppFrame) keeps
// this browser in line with whoever is signed in, on every page. useDesktopPush() is the bell's
// state, and PushSwitch is "Show on this computer" in the open bell dropdown.
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useToast } from './ToastProvider';
import Toggle from './Toggle';
import {
  currentSubscription,
  permission,
  pushState,
  pushSupported,
  syncExisting,
  turnOff,
  turnOn,
} from './NotificationBell.push';
import styles from './NotificationBell.module.css';

const HELP = {
  checking: 'Checking this browser…',
  off: 'Pop up on your desktop, even when Daybook is minimised.',
  on: 'On for this browser. New notifications pop up on your desktop.',
  blocked: "Blocked in this browser. Allow notifications for this site in the browser's settings.",
  turningOn: 'Turning on…',
  turningOff: 'Turning off…',
};

function readState(subscribed) {
  return pushState({ supported: pushSupported(), permission: permission(), subscribed });
}

// Browser support never changes while the page is open; the server render says "no".
const noSubscription = () => () => {};
const useSupported = () => useSyncExternalStore(noSubscription, pushSupported, () => false);

/**
 * @param {{ publicKey: string, userId: number } | null} config null when pushes are off for the
 *   company or the server has no keys
 * @returns {{ state: 'checking' | 'unsupported' | 'off' | 'on' | 'blocked',
 *   busy: false | 'on' | 'off', toggle: (on: boolean) => Promise<void> }}
 */
export function useDesktopPush(config) {
  const toast = useToast();
  const [state, setState] = useState('checking');
  const [busy, setBusy] = useState(false);
  const publicKey = config?.publicKey ?? null;
  const userId = config?.userId ?? null;
  const available = useSupported() && Boolean(publicKey);

  useEffect(() => {
    if (!available) return undefined;
    let cancelled = false;
    // After the shared sync, read what the browser really has (the person may have switched it
    // since the sync ran on an earlier page).
    const refresh = (options) =>
      syncExisting({ publicKey, userId }, options)
        .catch(() => null)
        .then(() => currentSubscription())
        .then(
          (subscription) => !cancelled && setState(readState(Boolean(subscription))),
          () => !cancelled && setState(readState(false)),
        );
    refresh();

    // The person can change the permission in the browser while Daybook is open.
    let status = null;
    const onChange = () => refresh({ fresh: true });
    navigator.permissions
      ?.query({ name: 'notifications' })
      .then((result) => {
        if (cancelled) return;
        status = result;
        status.addEventListener('change', onChange);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      status?.removeEventListener('change', onChange);
    };
  }, [available, publicKey, userId]);

  const toggle = useCallback(
    async (on) => {
      if (busy || !publicKey) return;
      setBusy(on ? 'on' : 'off');
      try {
        if (on) {
          const result = await turnOn({ publicKey, userId });
          setState(result);
          if (result === 'on') {
            toast({
              title: 'Desktop notifications are on',
              body: 'New notifications pop up on this computer.',
            });
          }
        } else {
          setState(await turnOff({ userId }));
        }
      } catch (error) {
        setState(readState(false));
        toast({
          title: on
            ? "Couldn't turn on desktop notifications"
            : "Couldn't turn off desktop notifications",
          body: error?.message,
          tone: 'error',
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, publicKey, userId, toast],
  );

  return { state: available ? state : 'unsupported', busy, toggle };
}

/** @param {{ push: ReturnType<typeof useDesktopPush> }} props */
export default function PushSwitch({ push }) {
  const { state, busy, toggle } = push;
  const noteId = useId();
  if (state === 'unsupported') return null;
  let help = HELP[state];
  if (busy) help = busy === 'on' ? HELP.turningOn : HELP.turningOff;
  // The way out of "Blocked" stays at full contrast, outside the faded switch.
  const blocked = state === 'blocked' && !busy;
  // Busy and Blocked switches ignore changes but stay focusable (aria-disabled, not disabled): a
  // keyboard user who just pressed Space keeps their place instead of being dropped on <body>.
  const inert = Boolean(busy) || blocked;
  // Only when blocked: an explicit undefined would replace the Toggle's link to its help text.
  const extra = blocked ? { 'aria-describedby': noteId } : {};
  if (inert) extra['aria-disabled'] = true;
  const rowClass = [
    styles.desktopToggle,
    busy ? styles.desktopBusy : null,
    blocked ? styles.desktopBlocked : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={styles.desktop}>
      <Toggle
        label="Show on this computer"
        help={blocked ? undefined : help}
        {...extra}
        checked={busy ? busy === 'on' : state === 'on'}
        disabled={state === 'checking'}
        onChange={(checked) => {
          if (!inert) toggle(checked);
        }}
        className={rowClass}
      />
      {blocked ? (
        <p id={noteId} className={styles.desktopNote}>
          {HELP.blocked}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Mounted once in the app shell: on every signed-in page, brings this browser's subscription in
 * line with the person signed in (see syncExisting). Renders nothing.
 * @param {{ push: { publicKey: string, userId: number } }} props
 */
export function PushSync({ push }) {
  const publicKey = push?.publicKey ?? null;
  const userId = push?.userId ?? null;
  const available = useSupported() && Boolean(publicKey);
  useEffect(() => {
    if (available) syncExisting({ publicKey, userId }).catch(() => {});
  }, [available, publicKey, userId]);
  return null;
}
