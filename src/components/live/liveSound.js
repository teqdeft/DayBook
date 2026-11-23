// The chime decision at a batch's flush (CONTRACT 26 "When it chimes"): rules 1 to 5 (liveRules
// `shouldChime`, with the push state read only when it can matter), then whether the audio can run
// (before claiming, so a tab that can't play never blocks one that can), then the claim in the
// browser's `daybook-chime-<userId>` lock, and only then the sound.
import { claimChime, withChimeLock } from './chimeGate';
import { chimeLockName } from './liveChannel';
import { shouldChime } from './liveRules';

const NO_PUSH = Object.freeze({ active: false, apple: false });

/**
 * @param {{ batch: { items: object[], gapMs: number, soundTabId: string | null,
 *   frontTabId: string | null }, userId: number, tabId: string,
 *   choice: 'important' | 'all' | 'off', tone: string, osSound: Set<number>,
 *   pushState: () => Promise<{ active: boolean, apple: boolean }>,
 *   player: { ready: () => Promise<boolean>, play: (options: object) => void },
 *   locks?: LockManager | null, storage?: Storage | null, now: () => number }} options
 * @returns {Promise<string>} 'play' when it chimed, else the reason it didn't
 */
export async function decideChime({
  batch,
  userId,
  tabId,
  choice,
  tone,
  osSound,
  pushState,
  player,
  locks,
  storage,
  now,
}) {
  const base = { choice, batch, osSound, gapMs: batch.gapMs ?? 0, tabId };
  const early = shouldChime({ ...base, soundTabId: tabId, frontTabId: tabId, push: NO_PUSH });
  if (early === 'off' || early === 'not_important') return early;
  const push = (await pushState?.().catch(() => NO_PUSH)) ?? NO_PUSH;
  const reason = shouldChime({
    ...base,
    soundTabId: batch.soundTabId,
    frontTabId: batch.frontTabId,
    push,
  });
  if (reason !== 'play') return reason;
  if (!(await player.ready())) return 'no_audio';
  const ids = batch.items.map((item) => item.id);
  const claim = await withChimeLock(locks, chimeLockName(userId), () =>
    claimChime({ userId, ids, now: now(), ...(storage !== undefined ? { storage } : {}) }),
  );
  if (claim !== 'play') return claim;
  player.play({ ids, tone });
  return 'play';
}
