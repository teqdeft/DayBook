// Whether desktop push is active in this browser (CONTRACT 26): the company has it on with keys
// (AppFrame's `pushKey`), the person allowed notifications and the service worker has a push
// subscription. `apple`: Safari's endpoint, where the system notification always shows and iPhone
// and iPad ignore `silent`. At most `timeoutMs`; unknown = not active.

const INACTIVE = Object.freeze({ active: false, apple: false });

/** The host test of @/modules/push `isApplePush` (a client can't import the module). */
export function isAppleEndpoint(endpoint) {
  try {
    const host = new URL(endpoint).hostname;
    return host === 'push.apple.com' || host.endsWith('.push.apple.com');
  } catch {
    return false;
  }
}

/**
 * @param {{ pushConfigured: boolean, timeoutMs?: number, nav?: Navigator,
 *   NotificationClass?: typeof Notification }} options `nav` and `NotificationClass` for tests
 * @returns {Promise<{ active: boolean, apple: boolean }>}
 */
export async function desktopPushActive({
  pushConfigured,
  timeoutMs = 500,
  nav = typeof navigator === 'undefined' ? undefined : navigator,
  NotificationClass = typeof Notification === 'undefined' ? undefined : Notification,
}) {
  if (!pushConfigured || NotificationClass?.permission !== 'granted') return INACTIVE;
  if (!nav?.serviceWorker) return INACTIVE;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const lookup = nav.serviceWorker.ready.then((registration) =>
      registration.pushManager.getSubscription(),
    );
    const subscription = await Promise.race([lookup, timeout]);
    if (!subscription?.endpoint) return INACTIVE;
    return { active: true, apple: isAppleEndpoint(subscription.endpoint) };
  } catch {
    return INACTIVE;
  } finally {
    clearTimeout(timer);
  }
}
