// The "play once the page shows it" queue (CONTRACT 28, Motion, Modules and signatures;
// commitMotion.js and useMotion.js): a request plays once when ready, waits while it isn't, is
// dropped after 2 s, and a StrictMode-like second layout effect never plays it twice. A commit with
// no request never animates.
import { describe, expect, it, vi } from 'vitest';

const effects = [];
vi.mock('react', async (original) => ({
  ...(await original()),
  useRef: (initial) => ({ current: initial }),
  useMemo: (make) => make(),
  useLayoutEffect: (effect) => effects.push(effect),
}));
vi.mock('react-dom', () => ({ flushSync: (fn) => fn() }));

const { queueRequest, runReady } = await import('@/lib/motion/commitMotion');
const { useCommitMotion } = await import('@/lib/motion/useMotion');

const request = (ready, extra = {}) => ({ id: 'enter:5', ready, play: vi.fn(), ...extra });

describe('runReady', () => {
  it('plays a ready request once and keeps the others waiting', () => {
    const root = {};
    const now = request(() => true, { at: 0 });
    const later = request(() => false, { id: 'enter:6', at: 0 });
    const waiting = runReady([now, later], root, 100);
    expect(now.play).toHaveBeenCalledWith(root);
    expect(later.play).not.toHaveBeenCalled();
    expect(waiting).toEqual([later]);
  });

  it('drops a request older than its maxAgeMs (2 s by default)', () => {
    const old = request(() => true, { at: 0 });
    expect(runReady([old], {}, 2001)).toEqual([]);
    expect(old.play).not.toHaveBeenCalled();
    const patient = request(() => false, { at: 0, maxAgeMs: 10000 });
    expect(runReady([patient], {}, 5000)).toEqual([patient]);
  });

  it('never replays: a second run of the same queue (StrictMode) plays nothing', () => {
    const once = request(() => true, { at: 0 });
    const queue = [once];
    runReady(queue, {}, 10);
    runReady(queue, {}, 20);
    expect(once.play).toHaveBeenCalledTimes(1);
  });

  it('treats a throwing ready as not ready and a throwing play as played', () => {
    const broken = request(
      () => {
        throw new Error('gone');
      },
      { at: 0 },
    );
    expect(runReady([broken], {}, 1)).toEqual([broken]);
    const failing = request(() => true, {
      at: 0,
      play: vi.fn(() => {
        throw new Error('x');
      }),
    });
    expect(runReady([failing], {}, 1)).toEqual([]);
  });

  it('waits without a root', () => {
    const first = request(() => true, { at: 0 });
    expect(runReady([first], null, 1)).toEqual([first]);
  });
});

describe('queueRequest', () => {
  it('stamps the time and replaces a waiting request with the same id', () => {
    const one = queueRequest(
      [],
      request(() => false),
      50,
    );
    expect(one[0]).toMatchObject({ id: 'enter:5', at: 50, maxAgeMs: 2000, played: false });
    const two = queueRequest(
      one,
      request(() => true),
      80,
    );
    expect(two).toHaveLength(1);
    expect(two[0].at).toBe(80);
  });
});

describe('useCommitMotion', () => {
  it('plays only what an action queued, in the commit that draws it', () => {
    effects.length = 0;
    const root = { has: false };
    const motion = useCommitMotion({ current: root });
    const effect = effects[0];
    effect(); // a commit with nothing queued
    const play = vi.fn();
    motion.expect({ id: 'enter:9', ready: (r) => r.has, play });
    effect(); // the refresh hasn't drawn it yet
    expect(play).not.toHaveBeenCalled();
    root.has = true;
    effect();
    effect(); // StrictMode runs layout effects twice
    expect(play).toHaveBeenCalledTimes(1);
  });
});
