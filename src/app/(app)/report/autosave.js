// The daily report's autosave loop (build guide 7.4.4), kept apart from React so it can be tested
// with fake timers: a draft saves one second after the last change, one request at a time
// (changes made while a save runs go out in the next one), and a save that couldn't reach the
// server is tried again every few seconds.

export const SAVE_DELAY_MS = 1000;
export const RETRY_DELAY_MS = 5000;

/**
 * @typedef {'waiting' | 'saving' | 'saved' | 'offline' | 'failed'} SaveStatus
 * @param {{ save: () => Promise<'saved' | 'offline' | 'failed' | 'stopped'>,
 *   onStatus: (status: SaveStatus) => void, delay?: number, retryDelay?: number }} options
 *   `save` sends the latest rows and says how it went: 'offline' tries again after `retryDelay`,
 *   'failed' waits for the next change, 'stopped' ends autosaving (the report locked or changed
 *   elsewhere).
 */
export function createAutosave({
  save,
  onStatus,
  delay = SAVE_DELAY_MS,
  retryDelay = RETRY_DELAY_MS,
}) {
  let timer = null;
  let retryTimer = null;
  let running = null;
  let again = false;
  let pending = false;
  let stopped = false;

  function clearTimers() {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    timer = null;
    retryTimer = null;
  }

  function settle(outcome) {
    if (outcome === 'saved') {
      onStatus(pending ? 'waiting' : 'saved');
      return true;
    }
    pending = true;
    if (outcome === 'offline' && !stopped) {
      onStatus('offline');
      retryTimer = setTimeout(saveNow, retryDelay);
    } else {
      if (outcome === 'stopped') stopped = true;
      onStatus('failed');
    }
    return false;
  }

  /**
   * Saves now, or right after the save that is running. Resolves true once saved.
   * @returns {Promise<boolean>}
   */
  async function saveNow() {
    if (stopped) return false;
    if (running) {
      again = true;
      return running;
    }
    clearTimers();
    pending = false;
    again = false;
    onStatus('saving');
    running = Promise.resolve()
      .then(save)
      .catch(() => 'failed')
      .then(settle);
    const ok = await running;
    running = null;
    if (ok && again) return saveNow();
    return ok;
  }

  return {
    /** A change was made: save `delay` ms after the last one. */
    changed() {
      if (stopped) return;
      pending = true;
      clearTimeout(timer);
      if (!running) onStatus('waiting');
      timer = setTimeout(() => {
        timer = null;
        saveNow();
      }, delay);
    },
    saveNow,
    /** Resolves once no save is running (submit builds on the version the last save returned). */
    async idle() {
      while (running) await running;
    },
    /** Stops the timers but keeps the changes marked as unsaved (submit sends them itself). */
    pause() {
      clearTimers();
    },
    /** The changes were saved another way (a submit): nothing is waiting any more. */
    markSaved() {
      clearTimers();
      pending = false;
    },
    /**
     * For the keepalive save when the person leaves: true when changes were waiting, and from
     * then on they count as sent.
     */
    takePending() {
      if (stopped || !pending) return false;
      clearTimers();
      pending = false;
      return true;
    },
    /** No more saves (the report locked, or it changed elsewhere and needs a reload). */
    stop() {
      stopped = true;
      clearTimers();
    },
    isSaving: () => Boolean(running),
    hasPending: () => pending,
  };
}
