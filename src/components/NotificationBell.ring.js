// When the bell swings (CONTRACT 20 and 21). Pure: no React, no browser.

/**
 * The bell's swing: about every 6 s while something is unread and the list is closed, starting
 * with a swing ('now', after the count went up) or after one quiet cycle ('later'). None when the
 * person turned "Ring the bell" off in My settings; the red dot and the count stay either way.
 * @param {{ enabled: boolean, unread: number, open: boolean, now: boolean }} state
 * @returns {'now' | 'later' | null}
 */
export function bellSwing({ enabled, unread, open, now }) {
  if (!enabled || !(unread > 0) || open) return null;
  return now ? 'now' : 'later';
}
