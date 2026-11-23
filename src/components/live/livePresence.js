// The other tabs' presences (CONTRACT 26 "Leader and followers"), pure with an injected clock: the
// latest presence of each tabId is kept until its `gone` (pagehide, or the page frozen), so a tab
// that has been hidden for minutes is still known as the one whose audio runs; `front` and
// `visible` count only from presences of the last 75 s (a visible tab posts one every 30 s).
import { pickFrontTab, pickSoundTab, WATCHDOG_MS } from './liveRules';

/**
 * @param {{ now: () => number, selfId: string }} options
 * @returns {{ apply: (message: object) => boolean, all: () => object[], fresh: () => object[],
 *   anyVisible: () => boolean, anyAudio: () => boolean,
 *   pick: (options: { self: { front: boolean, audio: boolean }, fallback: boolean }) =>
 *   { frontTabId: string | null, soundTabId: string } }}
 */
export function createPresences({ now, selfId }) {
  const byTab = new Map();
  const all = () => [...byTab.values()];
  const fresh = () => all().filter((presence) => now() - presence.at <= WATCHDOG_MS);

  return {
    /** Another tab's presence message; true when its tabId wasn't known here (it just opened). */
    apply(message) {
      if (!message?.tabId || message.tabId === selfId) return false;
      if (message.gone) {
        byTab.delete(message.tabId);
        return false;
      }
      const known = byTab.has(message.tabId);
      byTab.set(message.tabId, message);
      return !known;
    },
    all,
    fresh,
    anyVisible: () => fresh().some((presence) => presence.visible),
    /** Another tab of this browser whose audio runs (its latest presence, however old). */
    anyAudio: () => all().some((presence) => presence.audio),
    /** A result's `frontTabId` and `soundTabId` from this tab's view; in fallback, itself. */
    pick({ self, fallback }) {
      if (fallback) return { frontTabId: null, soundTabId: selfId };
      const frontTabId = pickFrontTab({ presences: fresh(), selfId, selfFront: self.front });
      const soundTabId = pickSoundTab({
        presences: all(),
        selfId,
        selfAudio: self.audio,
        frontTabId,
      });
      return { frontTabId, soundTabId };
    },
  };
}
