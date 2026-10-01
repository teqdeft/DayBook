// Daybook's service worker. It lets Chrome and Edge offer "Install Daybook" and shows desktop
// notifications (CONTRACT 14): the worker pushes { id, title, body, url } for every bell
// notification, and this shows it in the system's notification centre, even when the Daybook
// window is minimised or closed. Daybook needs the server for every screen, so nothing is cached;
// when offline the browser's own offline page shows.
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

/** Open Daybook pages refresh their bell (NotificationBell listens for this message). */
async function tellPages() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: 'daybook:notification' });
}

self.addEventListener('push', (event) => {
  const data = readPush(event);
  const id = data.id ? String(data.id) : String(Date.now());
  const title = typeof data.title === 'string' && data.title ? data.title : 'Daybook';
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: typeof data.body === 'string' ? data.body : '',
        icon: ICON,
        badge: BADGE,
        // One entry per notification: a repeated push replaces it instead of stacking a copy.
        tag: `daybook-${id}`,
        timestamp: Date.now(),
        data: { url: samePath(data.url) },
      }),
      tellPages().catch(() => {}),
    ]),
  );
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
  const windows = (
    await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  ).filter((client) => new URL(client.url).origin === self.location.origin);
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
