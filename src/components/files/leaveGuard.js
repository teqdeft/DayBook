'use client';
// Asks before a page with running uploads is left (CONTRACT 27, Uploads, Browser side): the
// browser's own "Leave site?" on `beforeunload`, and a capture-phase click listener on links,
// since App Router navigation never fires `beforeunload`. Links to /api/ (downloads), links with
// a target or `download`, and links that keep the page (and, for a tab's uploader, the `tab`
// value: a place, a search, `?task=`) never ask. Every uploader on the page shares one listener,
// so a click asks once even when the Files tab and the attach store both have uploads. The
// browser's Back button leaves without asking (no browser lets a page stop it).
//
// A download never asks: the browser fires `beforeunload` for a plain link before it knows the
// answer is an attachment, so while a guard is up a plain click on a download (and the row menu's
// Download, `startDownload`) goes through a hidden frame and the page is never left. A frame only
// ever shows a page when the link failed (a missing file, one deleted meanwhile, signed out); then
// the page asks the guard's question and, on yes, shows that error as the plain page it is, so a
// failed download never stops the uploads without asking.
import { useEffect } from 'react';
import { plural } from '@/lib/text';
import { isInAppNavigation } from '@/components/useUnsavedChangesWarning';

/** @type {Set<{ message: string, scope: 'tab' | 'page' }>} */
const guards = new Set();

/** Until when `beforeunload` lets the page go: the guard has just asked for a failed download. */
let leavingUntil = 0;

/**
 * "Leave this page? 2 files are still uploading and will stop."
 * @param {number} count
 */
export function uploadingLeaveMessage(count) {
  const files = `${count} ${plural(count, 'file')} ${count === 1 ? 'is' : 'are'}`;
  return `Leave this page? ${files} still uploading and will stop.`;
}

const tabOf = (url) => url.searchParams.get('tab') || 'board';

/**
 * Whether following this link leaves what the uploads belong to.
 * @param {{ href: string, target?: string, download?: boolean }} link `href` fully resolved
 * @param {{ button: number, metaKey?: boolean, ctrlKey?: boolean, shiftKey?: boolean,
 *   altKey?: boolean }} click
 * @param {string} current the page's URL (location.href)
 * @param {'tab' | 'page'} [scope] 'tab': the uploads belong to one tab of the page (the Files
 *   tab, a task form), so another tab asks; 'page': they live around the tabs (the attach store)
 */
export function leaveAsks(link, click, current, scope = 'tab') {
  let to;
  let from;
  try {
    to = new URL(link.href, current);
    from = new URL(current);
  } catch {
    return false;
  }
  if (link.download || (link.target && link.target !== '_self')) return false;
  if (to.origin === from.origin) {
    if (to.pathname.startsWith('/api/')) return false;
    if (to.pathname === from.pathname && (scope === 'page' || tabOf(to) === tabOf(from))) {
      return false;
    }
  }
  return isInAppNavigation(link, click, current);
}

/**
 * Whether this click is a download in this tab: a plain click on a link to this site's /api/
 * with no target or `download` (a new tab or a saved link never unloads the page).
 * @param {{ href: string, target?: string, download?: boolean }} link `href` fully resolved
 * @param {{ button: number, metaKey?: boolean, ctrlKey?: boolean, shiftKey?: boolean,
 *   altKey?: boolean }} click
 * @param {string} current the page's URL (location.href)
 */
export function isDownloadClick(link, click, current) {
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) {
    return false;
  }
  if (link.download || (link.target && link.target !== '_self')) return false;
  try {
    const to = new URL(link.href, current);
    return to.origin === new URL(current).origin && to.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/** The frame showed a page, so the download failed: ask, then show the error as the page. */
function onFrameLoad(frame, href) {
  frame.remove();
  const asking = [...guards][0];
  if (asking && !window.confirm(asking.message)) return;
  leavingUntil = Date.now() + 3000;
  window.location.assign(href);
}

function downloadInFrame(href) {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.addEventListener('load', () => onFrameLoad(frame, href), { once: true });
  // The address before the frame joins the page, so its first page is the download itself.
  frame.src = href;
  document.body.append(frame);
}

/**
 * Starts a download that isn't a link (the Files tab's row menu): through the hidden frame while
 * a guard is up, else as a plain page load (the browser keeps the page for an attachment).
 * @param {string} href the file's downloadUrl
 */
export function startDownload(href) {
  if (guards.size > 0) downloadInFrame(href);
  else window.location.assign(href);
}

function onBeforeUnload(event) {
  if (guards.size === 0 || Date.now() < leavingUntil) return;
  event.preventDefault();
  event.returnValue = '';
}

function onClick(event) {
  if (guards.size === 0 || event.defaultPrevented) return;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!anchor) return;
  const link = {
    href: anchor.href,
    target: anchor.target,
    download: anchor.hasAttribute('download'),
  };
  if (isDownloadClick(link, event, window.location.href)) {
    event.preventDefault();
    downloadInFrame(link.href);
    return;
  }
  const asking = [...guards].find((guard) =>
    leaveAsks(link, event, window.location.href, guard.scope),
  );
  if (!asking || window.confirm(asking.message)) return;
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Puts a guard up until the returned function takes it down (useLeaveGuard's effect).
 * @param {string} message the question, for example uploadingLeaveMessage(2)
 * @param {'tab' | 'page'} [scope] see leaveAsks
 * @returns {() => void}
 */
export function holdLeaveGuard(message, scope = 'tab') {
  const guard = { message, scope };
  guards.add(guard);
  if (guards.size === 1) {
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
  }
  return () => {
    if (!guards.delete(guard) || guards.size !== 0) return;
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('click', onClick, true);
  };
}

/**
 * While `active`, the page asks before it is left.
 * @param {boolean} active
 * @param {string} message the question, for example uploadingLeaveMessage(2)
 * @param {{ scope?: 'tab' | 'page' }} [options] see leaveAsks
 */
export function useLeaveGuard(active, message, { scope = 'tab' } = {}) {
  useEffect(() => {
    if (!active) return undefined;
    return holdLeaveGuard(message, scope);
  }, [active, message, scope]);
}
