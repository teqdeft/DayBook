// Leader and followers (CONTRACT 26): one Daybook tab per browser and person holds the Web Lock
// `daybook-live-<userId>` and runs the live checks; the others wait in line for it and get each
// answer over the BroadcastChannel of the same name. Locks are granted in the order asked, so the
// leader is the oldest open tab. The watchdog's `takeLead()` steals the lock from a frozen leader,
// whose request then rejects with an AbortError: it stops leading and asks again as a follower.
// Without Web Locks or BroadcastChannel (or when either throws) every tab is its own leader.
import { liveName, openChannel } from './liveChannel';

/**
 * @param {{ userId: number, locks?: LockManager | null,
 *   channelFactory?: (name: string) => BroadcastChannel, onLead: () => void,
 *   onFollow?: () => void, onMessage: (message: object) => void }} options
 *   `onLead`: this tab now leads (it checks at once); `onFollow`: it lost the lead (stolen).
 * @returns {{ isLeader: () => boolean, isFallback: () => boolean, post: (message: object) => void,
 *   takeLead: () => void, stop: () => void }}
 */
export function startLeadership({ userId, locks, channelFactory, onLead, onFollow, onMessage }) {
  const name = liveName(userId);
  let stopped = false;
  let leader = false;
  let fallback = false;
  let release = () => {}; // resolves the held promise of the lock this tab holds
  let waiting = null; // the AbortController of the request waiting in line
  const opened = locks?.request ? openChannel(name, channelFactory) : null;

  if (opened) {
    opened.channel.onmessage = (event) => {
      const message = event?.data;
      if (stopped || !message || message.userId !== userId) return;
      onMessage(message);
    };
  }

  /** The lock's callback: lead until stop() (or until the watchdog of another tab steals it). */
  function hold() {
    if (stopped) return undefined;
    leader = true;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    onLead();
    return held;
  }

  function lost(error) {
    const wasLeader = leader;
    leader = false;
    if (stopped) return;
    if (error?.name !== 'AbortError') {
      goFallback();
      return;
    }
    if (wasLeader) {
      onFollow?.();
      ask();
    }
  }

  function ask() {
    if (stopped) return;
    waiting = new AbortController();
    const { signal } = waiting;
    try {
      locks.request(name, { signal }, hold).then(
        () => {
          leader = false;
        },
        (error) => {
          if (signal.aborted) return; // our own abort (takeLead or stop), not a steal
          lost(error);
        },
      );
    } catch {
      goFallback();
    }
  }

  function goFallback() {
    if (fallback || stopped) return;
    fallback = true;
    leader = true;
    onLead();
  }

  if (opened) ask();
  else goFallback();

  return {
    isLeader: () => !stopped && leader,
    isFallback: () => fallback,
    post(message) {
      if (stopped || fallback || !opened) return;
      try {
        opened.channel.postMessage(message);
      } catch {
        // the other tabs catch up on their next result
      }
    },
    /** The watchdog: take the lock from a leader that stopped answering, then lead at once. */
    takeLead() {
      if (stopped || fallback || leader) return;
      waiting?.abort();
      try {
        locks.request(name, { steal: true }, hold).then(
          () => {
            leader = false;
          },
          (error) => lost(error),
        );
      } catch {
        goFallback();
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      leader = false;
      release();
      waiting?.abort();
      if (opened) {
        opened.channel.onmessage = null;
        opened.release();
      }
    },
  };
}
