// Daybook's service worker. It lets Chrome and Edge offer "Install Daybook" and shows desktop
// notifications (CONTRACT 14): the worker pushes { id, userId, title, body, url, mustShow? } for
// every bell notification, and this shows it in the system's notification centre, even when the
// Daybook window is minimised or closed. A Daybook window in front that shows its own preview card
// is asked first, and then no system notification is shown (CONTRACT 26). Daybook needs the server
// for every screen, so nothing is cached; when offline the browser's own offline page shows.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';

/** Any link becomes a path on this origin, so a notification can never open another site. */
function samePath(url) {
  try {
    const target = new URL(url || '/', self.location.origin);
    return target.pathname + target.search + target.hash;
  } catch {
    return '/';
  }
}

function readPush(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    return { body: event.data.text() };
  }
}

// How long a push waits for the open Daybook windows to answer (all are asked at once).
const ASK_MS = 1000;

/** Every Daybook window of this origin, controlled by this worker or not. */
async function daybookWindows() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windows.filter((client) => new URL(client.url).origin === self.location.origin);
}

/** True for Safari's push service, which revokes a subscription that pushes without a pop-up. */
async function appleSubscription() {
  try {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription) return false;
    const host = new URL(subscription.endpoint).hostname.toLowerCase();
    return host === 'push.apple.com' || host.endsWith('.push.apple.com');
  } catch {
    return false;
  }
}

/**
 * Asks one window whether it shows this notification itself (its live check, CONTRACT 26). A page
 * on the 1.10 bundle reloads its bell on the message and never answers; no answer within ASK_MS,
 * or any error, counts as { shown: false, alerted: false }.
 */
function askWindow(client, data, mustShow) {
  return new Promise((resolve) => {
    let timer = null;
    let channel = null;
    const finish = (answer) => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      if (channel) channel.port1.onmessage = null;
      resolve(answer);
    };
    timer = setTimeout(() => finish({ shown: false, alerted: false }), ASK_MS);
    try {
      channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        const reply = event.data || {};
        finish({ shown: reply.shown === true, alerted: reply.alerted === true });
      };
      const message = {
        type: 'daybook:notification',
        ask: true,
        id: data.id ?? null,
        userId: data.userId ?? null,
        mustShow,
      };
      client.postMessage(message, [channel.port2]);
    } catch {
      finish({ shown: false, alerted: false });
    }
  });
}

/** Tells every window what happened, so a tab not in front leaves the sound to the system. */
function tellShown(windows, id, silent) {
  for (const client of windows) {
    try {
      client.postMessage({ type: 'daybook:notification', os: true, id: id ?? null, silent });
    } catch {
      // A window that closed meanwhile.
    }
  }
}

async function handlePush(data) {
  const id = data.id ? String(data.id) : String(Date.now());
  const title = typeof data.title === 'string' && data.title ? data.title : 'Daybook';
  const mustShow = data.mustShow === true || (await appleSubscription());
  const windows = await daybookWindows().catch(() => []);
  const answers = await Promise.all(windows.map((client) => askWindow(client, data, mustShow)));
  const shownInFront = windows.some(
    (client, i) => client.focused && client.visibilityState === 'visible' && answers[i].shown,
  );
  if (shownInFront && !mustShow) return; // the page in front shows its own card (CONTRACT 26)
  // Already alerted in this browser, or Sound is Off in the window in front. Never with mustShow:
  // iPhone and iPad ignore silent, and on Apple the page leaves the sound to the system.
  const silent = !mustShow && answers.some((answer) => answer.alerted);
  await self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    icon: ICON,
    badge: BADGE,
    // One entry per notification: a repeated push replaces it instead of stacking a copy.
    tag: `daybook-${id}`,
    timestamp: Date.now(),
    data: { url: samePath(data.url) },
    ...(silent ? { silent: true } : {}),
  });
  tellShown(windows, data.id, silent);
}

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(readPush(event)));
});

/** The Daybook window to reuse: the focused one, else a visible one, else any. */
function pickWindow(windows) {
  return (
    windows.find((client) => client.focused) ||
    windows.find((client) => client.visibilityState === 'visible') ||
    windows[0]
  );
}

async function openPath(path) {
  const windows = await daybookWindows();
  const existing = pickWindow(windows);
  if (!existing) {
    await self.clients.openWindow(path);
    return;
  }
  const focused = await existing.focus().catch(() => existing);
  const target = focused || existing;
  const current = new URL(target.url);
  if (current.pathname + current.search + current.hash === path) return;
  // The page navigates itself (src/components/ServiceWorker.jsx), so an unsaved form can still
  // ask before it is left. A page that doesn't answer is sent there directly.
  if (await askPage(target, path)) return;
  try {
    await target.navigate(new URL(path, self.location.origin).href);
  } catch {
    await self.clients.openWindow(path);
  }
}

/** Posts { type: 'daybook:open', url } to the page; true once the page confirms it got it. */
function askPage(client, path) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 1500);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    client.postMessage({ type: 'daybook:open', url: path }, [channel.port2]);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openPath(samePath(event.notification.data && event.notification.data.url)));
});
