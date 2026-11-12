'use client';
// Delete with Undo on the project page (CONTRACT 22), for tasks, files and notes alike: the row hides
// at once and a toast offers Undo for 6 s (UndoToast, in the app's toast slot like the bell's). The
// DELETE goes out when the toast ends, when another delete takes the toast, when the board goes away
// or on pagehide (with keepalive). Every sent delete refreshes the page once it is done, also after
// the board has gone: the tab shown next was loaded before the delete went out. Undo cancels it; a
// failed delete brings the row back with an error toast. The rules live in undoQueue.js.
import { createElement, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import UndoToast from './UndoToast';
import { createDeleteQueue } from './undoQueue';

/** The waiting delete as the page goes away: keepalive, so it still arrives. */
function sendOnLeave(entry) {
  fetch(entry.url, { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(
    () => {},
  );
}

function changed(set, key, on) {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

/** Focus once the row is back on screen (after the render the Undo starts). */
function focusSoon(find) {
  if (find) requestAnimationFrame(() => find()?.focus());
}

/**
 * The queue, told how each sent delete went, and sending the waiting one when the page or the board
 * goes away. A failed delete shows its row again (`show`) with an error toast. The listener stays
 * set when the board goes away, so a delete still on its way then refreshes the page that follows.
 */
function useDeleteQueue({ show, hideToast }) {
  const router = useRouter();
  const toast = useToast();
  const [queue] = useState(() =>
    createDeleteQueue({ send: (entry) => api.delete(entry.url), sendOnLeave }),
  );

  useEffect(() => {
    queue.listen({
      onSent: () => router.refresh(),
      onFailed(entry, error) {
        if (error?.status === 404) {
          router.refresh(); // already gone
          return;
        }
        show(entry.key);
        const title = entry.failTitle ?? "Couldn't delete it";
        toast({ title, body: error?.message, tone: 'error' });
      },
    });
  });

  useEffect(() => {
    function leave() {
      if (queue.leave()) hideToast();
    }
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      // The page stays, so this is an ordinary DELETE and its listener refreshes the next tab.
      queue.sendNow();
    };
  }, [queue, hideToast]);

  return queue;
}

/**
 * @returns {{ isHidden: (key: string) => boolean,
 *   remove: (item: { key: string, url: string, label: string, failTitle?: string,
 *     keyboard?: boolean, returnFocus?: () => HTMLElement | null }) => void,
 *   toast: import('react').ReactElement }} key: unique on the page ('task:12'); url: what the DELETE
 *   is sent to; label: the toast ('Task deleted.'); failTitle: the error toast's title; keyboard:
 *   the delete came from the keyboard, so the toast takes focus; returnFocus: where focus goes after
 *   Undo, Tab or Escape. Render `toast` once, anywhere in the component.
 */
export function useUndoDelete() {
  const [hidden, setHidden] = useState(() => new Set());
  const [shown, setShown] = useState(null); // the toast: { key, title, keyboard }
  const show = useCallback((key) => setHidden((set) => changed(set, key, false)), []);
  const hideToast = useCallback(() => setShown(null), []);
  const queue = useDeleteQueue({ show, hideToast });

  const remove = useCallback(
    (item) => {
      const entry = queue.hold(item);
      if (!entry) return;
      setHidden((set) => changed(set, item.key, true));
      setShown({ key: entry.toast, title: item.label, keyboard: Boolean(item.keyboard) });
    },
    [queue],
  );

  const isHidden = useCallback((key) => hidden.has(key), [hidden]);

  function end() {
    if (shown) queue.end(shown.key);
    setShown(null);
  }

  function undo() {
    const entry = shown ? queue.undo(shown.key) : null;
    setShown(null);
    if (!entry) return;
    show(entry.key);
    if (shown.keyboard) focusSoon(entry.returnFocus);
  }

  const toast = createElement(UndoToast, {
    pending: shown,
    onUndo: undo,
    onEnd: end,
    onLeave: () => queue.pending?.returnFocus?.()?.focus(),
  });
  return { isHidden, remove, toast };
}
