// The rules behind Delete with Undo (CONTRACT 22), without React: one delete at a time waits behind
// its toast. It is sent when the toast ends, when another delete takes the toast, when the board goes
// away, or when the page is left (then with keepalive, so it still arrives). Undo takes it back before
// it is sent. Nothing is sent twice; only a delete that failed can be tried again. useUndoDelete.js
// wires this to the toast and the page.

/**
 * @param {{ send: (entry: object) => Promise<unknown>, sendOnLeave: (entry: object) => void }} io
 *   send: the DELETE while the page is open; sendOnLeave: the same with keepalive, when leaving
 * @returns {{ hold: Function, end: Function, undo: Function, sendNow: Function, leave: Function,
 *   listen: Function, readonly pending: object | null }}
 */
export function createDeleteQueue({ send, sendOnLeave }) {
  const sent = new Set();
  let pending = null;
  let nextToast = 0;
  let handlers = null;

  function commit(entry) {
    if (sent.has(entry.key)) return;
    sent.add(entry.key);
    Promise.resolve()
      .then(() => send(entry))
      .then(
        () => handlers?.onSent?.(entry),
        (error) => {
          // Nothing was deleted, so the row comes back and can be deleted again.
          sent.delete(entry.key);
          handlers?.onFailed?.(entry, error);
        },
      );
  }

  /** The toast ended (time up, closed or Escape): send its delete. */
  function end(toast) {
    if (!pending || pending.toast !== toast) return null;
    const entry = pending;
    pending = null;
    commit(entry);
    return entry;
  }

  return {
    get pending() {
      return pending;
    },

    /**
     * Who hears how a sent delete went; null stops it.
     * @param {{ onSent?: (entry: object) => void,
     *   onFailed?: (entry: object, error: Error) => void } | null} next
     */
    listen(next) {
      handlers = next;
    },

    /**
     * Holds a delete behind a new toast; the one waiting before it is sent now.
     * @param {{ key: string, url: string, label: string }} item
     * @returns {object | null} the entry (with its `toast` number), or null when that item was
     *   already sent
     */
    hold(item) {
      if (sent.has(item.key) || pending?.key === item.key) return null;
      if (pending) commit(pending);
      nextToast += 1;
      pending = { ...item, toast: nextToast };
      return pending;
    },

    end,

    /**
     * The board goes away but the page stays (another tab, a section closed): send the waiting
     * delete now, as its toast ending would, so the listener hears how it went.
     * @returns {object | null} the entry sent
     */
    sendNow() {
      return pending ? end(pending.toast) : null;
    },

    /** Undo: the delete is never sent. @returns {object | null} the entry taken back */
    undo(toast) {
      if (!pending || pending.toast !== toast) return null;
      const entry = pending;
      pending = null;
      return entry;
    },

    /** The page is left (pagehide): send the waiting delete with keepalive. */
    leave() {
      if (!pending) return null;
      const entry = pending;
      pending = null;
      sent.add(entry.key);
      sendOnLeave(entry);
      return entry;
    },
  };
}
