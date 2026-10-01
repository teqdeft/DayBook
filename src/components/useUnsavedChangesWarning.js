'use client';
// Asks before unsaved changes are lost. `beforeunload` covers reloads, closing the tab and
// leaving the site, but App Router navigation (sidebar links, menus) never fires it, so clicks on
// in-app links are checked here too. Programmatic router.push() and the Back button are not.
import { useEffect } from 'react';

export const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Leave this page without saving?';

/**
 * True when clicking this link moves to another page of this site in the same tab, the case
 * `beforeunload` misses. Other sites, new tabs, downloads and same-page anchors are left alone.
 * @param {{ href: string, target?: string, download?: boolean }} link `href` fully resolved
 * @param {{ button: number, metaKey?: boolean, ctrlKey?: boolean, shiftKey?: boolean,
 *   altKey?: boolean }} click
 * @param {string} current the page's URL (location.href)
 */
export function isInAppNavigation(link, click, current) {
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) {
    return false;
  }
  if ((link.target && link.target !== '_self') || link.download) return false;
  let to;
  let from;
  try {
    to = new URL(link.href, current);
    from = new URL(current);
  } catch {
    return false;
  }
  if (to.origin !== from.origin) return false;
  return to.pathname !== from.pathname || to.search !== from.search;
}

/**
 * While `dirty`, asks for confirmation before the page is left.
 * @param {boolean} dirty
 * @param {string} [message]
 */
export function useUnsavedChangesWarning(dirty, message = UNSAVED_CHANGES_MESSAGE) {
  useEffect(() => {
    if (!dirty) return undefined;
    function onBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = '';
    }
    // Capture phase on the document runs before next/link's own click handler.
    function onClick(event) {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor || event.defaultPrevented) return;
      const link = {
        href: anchor.href,
        target: anchor.target,
        download: anchor.hasAttribute('download'),
      };
      if (!isInAppNavigation(link, event, window.location.href)) return;
      if (window.confirm(message)) return;
      event.preventDefault();
      event.stopPropagation();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}
