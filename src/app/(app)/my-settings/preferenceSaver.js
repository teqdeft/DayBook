// My settings saves each change at once (CONTRACT 21). Changes are sent one at a time, in the
// order they were made, so the server always ends on the last choice; a failed change is put
// back only while it is still the newest one for its key. Pure: the provider hands it `send`
// and callbacks, and the tests drive it the same way.

/**
 * @param {{
 *   initial: Record<string, unknown>,
 *   send: (key: string, value: unknown) => Promise<Record<string, unknown> | null | undefined>,
 *   onStatus?: (status: 'saving' | 'saved' | 'idle') => void,
 *   onRevert?: (key: string, value: unknown) => void,
 *   onError?: (error: Error, key: string) => void,
 *   onDrained?: () => void,
 * }} options
 *   initial: the saved preferences; send: saves `{ [key]: value }` and resolves with every
 *   preference as saved (rejects on failure); onStatus: "Saving…" while any change is on its way,
 *   then "Saved" when the last one worked (otherwise idle); onRevert: put this saved value back
 *   in the control; onError: tell the person; onDrained: the queue emptied after at least one
 *   change was saved (the page refreshes the shell then)
 * @returns {{ change: (key: string, value: unknown) => Promise<void>,
 *   saved: () => Record<string, unknown> }}
 */
export function createPreferenceSaver({ initial, send, onStatus, onRevert, onError, onDrained }) {
  let confirmed = { ...initial };
  let tail = Promise.resolve();
  let waiting = 0;
  let count = 0;
  let savedSinceDrain = false;
  const newest = new Map();

  async function run(key, value, id) {
    let ok = false;
    try {
      const data = await send(key, value);
      const stored = data && Object.hasOwn(data, key) ? data[key] : value;
      confirmed = { ...confirmed, [key]: stored };
      // The server may have kept a different value (a default it normalised): show that one.
      if (newest.get(key) === id && stored !== value) onRevert?.(key, stored);
      ok = true;
      savedSinceDrain = true;
    } catch (error) {
      if (newest.get(key) === id) onRevert?.(key, confirmed[key]);
      onError?.(error, key);
    }
    waiting -= 1;
    if (waiting > 0) return;
    onStatus?.(ok ? 'saved' : 'idle');
    if (savedSinceDrain) {
      savedSinceDrain = false;
      onDrained?.();
    }
  }

  return {
    change(key, value) {
      count += 1;
      const id = count;
      newest.set(key, id);
      waiting += 1;
      onStatus?.('saving');
      // run() handles the request's own failure; a callback that threw on an earlier change
      // must not stop the ones after it.
      tail = tail.catch(() => {}).then(() => run(key, value, id));
      return tail;
    },
    saved: () => ({ ...confirmed }),
  };
}
