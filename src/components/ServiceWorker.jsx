'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * True when it's fine to leave this page for `url`: an unsaved form (useUnsavedChangesWarning)
 * gets the same question a link click gets. The check sends a click through a hidden link and
 * sees whether the page's own guard let it through.
 */
function mayLeaveFor(url) {
  const link = document.createElement('a');
  link.href = url;
  link.hidden = true;
  let allowed = false;
  link.addEventListener('click', (event) => {
    allowed = true;
    event.preventDefault(); // the router navigates, not the browser
  });
  document.body.appendChild(link);
  try {
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  } finally {
    link.remove();
  }
  return allowed;
}

/**
 * Registers the service worker (public/sw.js), in development too: Chrome and Edge offer
 * "Install Daybook", and desktop notifications are shown by it (CONTRACT 14). Clicking a desktop
 * notification while Daybook is open asks this page to open the notification's link.
 */
export default function ServiceWorker() {
  const router = useRouter();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    navigator.serviceWorker.register('/sw.js').catch(() => {});

    function onMessage(event) {
      if (event.data?.type !== 'daybook:open' || typeof event.data.url !== 'string') return;
      event.ports?.[0]?.postMessage('opening');
      const target = new URL(event.data.url, window.location.origin);
      if (target.origin !== window.location.origin) return;
      const path = target.pathname + target.search + target.hash;
      if (mayLeaveFor(target.href)) router.push(path);
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.startMessages?.();
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  return null;
}
