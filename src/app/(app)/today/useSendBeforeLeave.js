'use client';
// Leaving Today while a removed to-do line or project waits behind its Undo toast (CONTRACT 24).
// Its DELETE would only go out as the page goes away, after the server has drawn the next page: the
// report would still list the line, and its first save would be refused as changed somewhere else.
// So a plain click on a link to another page sends the waiting DELETE first, waits for it (at most
// 4 s), and then follows the link as it would have. Back and forward still send it as the page
// goes away.
import { useEffect } from 'react';

export const LEAVE_WAIT_MS = 4000;

/**
 * The link to another page of the site that this click follows, or null (a modified or middle
 * click, a new tab, a download, another site, the same page).
 * @param {MouseEvent} event
 * @param {{ href: string, origin: string, pathname: string }} here window.location
 */
export function leavingLink(event, here) {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const link = event.target?.closest?.('a[href]');
  if (!link || link.hasAttribute('download')) return null;
  const target = link.getAttribute('target');
  if (target && target !== '_self') return null;
  const url = new URL(link.getAttribute('href'), here.href);
  return url.origin === here.origin && url.pathname !== here.pathname ? link : null;
}

/**
 * The click listener (window, capture phase): while deletes wait, it holds a click on a link to
 * another page, waits for them, then follows the link (the last one clicked).
 * @param {{ waiting: () => boolean, settle: () => Promise<void>, here: () => object,
 *   wait: (ms: number) => Promise<void>, follow: (link: HTMLAnchorElement) => void }} io
 */
export function createLeaveGuard({ waiting, settle, here, wait, follow }) {
  let held = null;
  let passing = false;
  return function onClick(event) {
    if (passing || (!held && !waiting())) return;
    const link = leavingLink(event, here());
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const first = held === null;
    held = link;
    if (!first) return;
    Promise.race([settle(), wait(LEAVE_WAIT_MS)]).then(() => {
      const next = held;
      held = null;
      passing = true;
      try {
        follow(next);
      } finally {
        passing = false;
      }
    });
  };
}

/** A link still on the page is clicked again (Link or the browser follows it); else load it. */
function follow(link) {
  if (link.isConnected) link.click();
  else window.location.assign(link.href);
}

/**
 * @param {() => boolean} waiting whether a delete waits or is on its way (useUndoDelete)
 * @param {() => Promise<void>} settle sends it now and waits for the answer (useUndoDelete)
 */
export function useSendBeforeLeave(waiting, settle) {
  useEffect(() => {
    const onClick = createLeaveGuard({
      waiting,
      settle: () => settle(),
      here: () => window.location,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      follow,
    });
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [waiting, settle]);
}
