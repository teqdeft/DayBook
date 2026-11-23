// The live store (CONTRACT 26): what the bell and the cards share in one tab. The bell reads the
// unread count, gets every row of each live answer (`items`), learns what was read elsewhere
// (`read`, `read-all`) and is asked to open (`openBell`). It reports its own writes, hidden rows,
// its button and whether its list is open, and raises the cursor after its own load (markSeen).
// `hooks` connect the store to the live engine (broadcast, batches, cards); a store without hooks
// works on its own. No React, no browser.

/**
 * @param {{ userId: number, cursor?: number | null }} options `cursor` = AppFrame's `latestId`
 */
export function createLiveStore({ userId, cursor = null }) {
  const listeners = new Set();
  const hidden = new Set();
  let hooks = {};
  let bell = null; // { button, open }
  const state = { unread: null, cursor: Number.isFinite(cursor) ? cursor : null, bellOpen: false };

  const emit = (event) => listeners.forEach((listener) => listener(event));
  const setCount = (count) => {
    if (Number.isFinite(count)) state.unread = Math.max(0, count);
  };
  const toIds = (ids) => (ids ?? []).map(Number).filter(Number.isFinite);

  const store = {
    userId,
    /** The latest unread count from the live check or a write, null until the first. */
    get unread() {
      return state.unread;
    },
    get cursor() {
      return state.cursor;
    },
    get bellOpen() {
      return state.bellOpen;
    },
    get hidden() {
      return hidden;
    },
    hasBell: () => bell !== null,
    /** The registered bell's button element (registered as an element or a ref), or null. */
    bellButton() {
      const button = bell?.button ?? null;
      return button && typeof button === 'object' && 'current' in button ? button.current : button;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setUnread(count) {
      setCount(count);
    },
    /** This tab marked `ids` read (the bell or a card): every tab and card follows. */
    reportRead(ids, readAt, unreadCount) {
      const list = toIds(ids);
      setCount(unreadCount);
      emit({ kind: 'read', ids: list, readAt });
      hooks.onRead?.(list, Number.isFinite(unreadCount) ? unreadCount : state.unread, true);
    },
    reportReadAll(readAt) {
      state.unread = 0;
      emit({ kind: 'read-all', readAt });
      hooks.onReadAll?.(true);
    },
    reportHidden(id, on) {
      const key = Number(id);
      if (on) hidden.add(key);
      else hidden.delete(key);
      hooks.onHidden?.(key, on);
    },
    registerBell({ button, open }) {
      const entry = { button, open };
      bell = entry;
      return () => {
        if (bell === entry) bell = null;
        store.setBellOpen(false);
      };
    },
    setBellOpen(open) {
      const next = Boolean(open);
      if (next === state.bellOpen) return;
      state.bellOpen = next;
      hooks.onBellOpen?.(next);
    },
    /** The bell's own load showed the list up to `id`: no card or chime for those later. */
    markSeen(id) {
      if (!Number.isFinite(id)) return;
      state.cursor = state.cursor === null ? id : Math.max(state.cursor, id);
    },
    /** A summary's "See them": the bell opens its list (and focuses its button). */
    openBell() {
      if (!bell) return false;
      emit({ kind: 'openBell' });
      return true;
    },

    // The engine's side.
    setHooks(next) {
      hooks = next ?? {};
    },
    /** A live answer (this tab's or a broadcast one): the count, then every row to the bell. */
    applyAnswer({ items, unreadCount, latestId }) {
      setCount(unreadCount);
      if (Number.isFinite(latestId)) store.markSeen(latestId);
      emit({ kind: 'items', items: items ?? [] });
    },
    /** Another tab marked `ids` read. */
    applyRead(ids, unreadCount, readAt) {
      const list = toIds(ids);
      setCount(unreadCount);
      emit({ kind: 'read', ids: list, readAt });
      hooks.onRead?.(list, state.unread, false);
    },
    applyReadAll(readAt) {
      state.unread = 0;
      emit({ kind: 'read-all', readAt });
      hooks.onReadAll?.(false);
    },
  };
  return store;
}
