// When the preview cards wait (CONTRACT 26 "When cards show", rule 4): while a modal is open
// (Dialog, Drawer, the away question) or a list of suggestions is (GlobalSearch's results, the
// pickers). One MutationObserver on the body, connected only while the stack or the queue has
// entries, its callback run at most once per animation frame.

const MODAL = '[aria-modal="true"]';
const OPEN_LIST = '[role="combobox"][aria-expanded="true"]';

/** A modal is open. */
export const modalOpen = () => document.querySelector(MODAL) !== null;

/** A modal or an open list of suggestions would cover the cards. */
export const blockedNow = () => modalOpen() || document.querySelector(OPEN_LIST) !== null;

/**
 * @param {(blocked: boolean) => void} onChange called after a change that may matter
 * @returns {{ sync: (active: boolean) => void }} `sync(true)` connects, `sync(false)` disconnects
 */
export function createWaitWatch(onChange) {
  let observer = null;
  let frame = 0;
  const run = () => {
    frame = 0;
    onChange(blockedNow());
  };
  return {
    sync(active) {
      if (active && !observer && typeof MutationObserver === 'function') {
        observer = new MutationObserver(() => {
          if (!frame) frame = requestAnimationFrame(run);
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['aria-modal', 'aria-expanded'],
        });
      } else if (!active && observer) {
        observer.disconnect();
        observer = null;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      }
    },
  };
}
