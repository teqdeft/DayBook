// The bell's sounds and their gate (CONTRACT 26): the four synthesized sounds against a fake
// AudioContext that records every call, the player's unlock rules (no context before a gesture,
// touch, untrusted events, a resume that never settles, iPhone's interrupted state), Play sound,
// the e2e hook, and claimChime's record in localStorage (one chime per batch, one per 10 s).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHIME,
  TONE_NAMES,
  TONES,
  createChimePlayer,
  playChimeNow,
  scheduleChime,
} from '@/components/live/chime';
import {
  claimChime,
  isAlerted,
  markAlerted,
  readRecord,
  resetChimeGateForTests,
} from '@/components/live/chimeGate';

function fakeParam(name, log) {
  return {
    value: 0,
    setValueAtTime: (v, t) => log.push([name, 'set', v, t]),
    linearRampToValueAtTime: (v, t) => log.push([name, 'linear', v, t]),
    exponentialRampToValueAtTime: (v, t) => log.push([name, 'exp', v, t]),
  };
}

/** A fake AudioContext: every node and param call goes into `ctx.log`. */
function fakeContext({ state = 'running', resume } = {}) {
  const ctx = {
    state,
    currentTime: 1,
    sampleRate: 48_000,
    destination: { name: 'destination' },
    oscillators: [],
    gains: [],
    sources: [],
    log: [],
    onstatechange: null,
    createOscillator() {
      const osc = {
        type: 'square',
        frequency: fakeParam(`osc${ctx.oscillators.length}.frequency`, ctx.log),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      ctx.oscillators.push(osc);
      return osc;
    },
    createGain() {
      const gain = {
        gain: fakeParam(`gain${ctx.gains.length}`, ctx.log),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      ctx.gains.push(gain);
      return gain;
    },
    createBuffer: vi.fn(() => ({})),
    createBufferSource() {
      const source = { connect: vi.fn(), start: vi.fn(), buffer: null };
      ctx.sources.push(source);
      return source;
    },
    resume: vi.fn(resume ?? (() => Promise.resolve())),
    setState(next) {
      ctx.state = next;
      ctx.onstatechange?.();
    },
  };
  return ctx;
}

/** A fake window whose AudioContext constructor hands out `make()` contexts. */
function fakeWindow(make = () => fakeContext()) {
  const listeners = new Map();
  const win = {
    contexts: [],
    navigator: { userActivation: { isActive: true } },
    addEventListener: vi.fn((type, fn) => listeners.set(type, fn)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
    listeners,
    fire(type, extra = {}) {
      listeners.get(type)?.({ type, isTrusted: true, ...extra });
    },
  };
  win.AudioContext = function AudioContext() {
    const ctx = make();
    win.contexts.push(ctx);
    return ctx;
  };
  return win;
}

const close = (a, b) => Math.abs(a - b) < 0.01;

describe('scheduleChime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays Chime: E5 then B5, each with a quiet octave, no clicks', () => {
    const ctx = fakeContext();
    const t0 = 2;
    scheduleChime(ctx, t0);
    const hz = ctx.log
      .filter(([, kind]) => kind === 'set')
      .filter(([name]) => name.includes('frequency'));
    expect(
      hz.map(([, , v]) => v).every((v, i) => close(v, [659.25, 1318.5, 987.77, 1975.54][i])),
    ).toBe(true);
    expect(ctx.oscillators).toHaveLength(4);
    expect(ctx.oscillators.every((osc) => osc.type === 'sine')).toBe(true);
    const starts = ctx.oscillators.map((osc) => osc.start.mock.calls[0][0]);
    expect(starts).toEqual([t0, t0, t0 + 0.12, t0 + 0.12]);
    const stops = ctx.oscillators.map((osc) => osc.stop.mock.calls[0][0]);
    expect(stops.map((t, i) => close(t, starts[i] + 0.52))).toEqual([true, true, true, true]);
    // gains[0] is the master; gains[1..4] the partial envelopes
    expect(ctx.gains[0].gain.value).toBe(0.16);
    const envelope = (index) => ctx.log.filter(([name]) => name === `gain${index}`);
    const decays = [0.5, 0.25, 0.5, 0.25];
    const peaks = [1, 0.25, 1, 0.25];
    for (let i = 1; i <= 4; i += 1) {
      const [set, linear, exp] = envelope(i);
      const start = starts[i - 1];
      expect(set).toEqual([`gain${i}`, 'set', 0, start]);
      expect(linear[2]).toBe(peaks[i - 1]);
      expect(close(linear[3], start + 0.01)).toBe(true);
      expect(exp[2]).toBe(0.001);
      expect(close(exp[3], start + decays[i - 1])).toBe(true);
    }
    expect(ctx.log.some(([, kind, v]) => kind === 'exp' && v === 0)).toBe(false);
  });

  it.each(['bell', 'ding', 'pop'])('plays %s exactly as the TONES table says', (name) => {
    const ctx = fakeContext();
    const tone = TONES[name];
    const t0 = 3;
    const { master } = scheduleChime(ctx, t0, name);
    expect(master.gain.value).toBe(tone.master);
    const expected = tone.notes.flatMap((note) =>
      tone.partials.map((partial) => ({ note, partial })),
    );
    expect(ctx.oscillators).toHaveLength(expected.length);
    expected.forEach(({ note, partial }, i) => {
      const osc = ctx.oscillators[i];
      const start = t0 + note.at;
      const freq = ctx.log.filter(([n]) => n === `osc${i}.frequency`);
      expect(close(freq[0][2], note.hz * partial.ratio)).toBe(true);
      expect(osc.start.mock.calls[0][0]).toBe(start);
      expect(close(osc.stop.mock.calls[0][0], start + tone.stopAfter)).toBe(true);
      const env = ctx.log.filter(([n]) => n === `gain${i + 1}`);
      expect(env[1][2]).toBe(partial.gain);
      expect(close(env[1][3], start + tone.attack)).toBe(true);
      expect(env[2]).toEqual([`gain${i + 1}`, 'exp', 0.001, start + partial.decay]);
    });
    if (name === 'pop') {
      const freq = ctx.log.filter(([n]) => n === 'osc0.frequency');
      expect(freq[0].slice(1, 3)).toEqual(['set', 880]);
      expect(freq[1][1]).toBe('exp');
      expect(freq[1][2]).toBe(440);
      expect(close(freq[1][3], t0 + 0.08)).toBe(true);
    }
  });

  it('keeps every tone under clipping and longer than its decays', () => {
    expect(TONE_NAMES).toEqual(Object.keys(TONES));
    expect(CHIME).toBe(TONES.chime);
    for (const name of TONE_NAMES) {
      const tone = TONES[name];
      const sum = tone.partials.reduce((total, p) => total + p.gain, 0) * tone.master;
      expect(sum).toBeLessThan(0.5);
      expect(tone.stopAfter).toBeGreaterThanOrEqual(Math.max(...tone.partials.map((p) => p.decay)));
    }
    expect(Object.isFrozen(TONES)).toBe(true);
    expect(Object.isFrozen(TONES.chime.notes[0])).toBe(true);
  });

  it('plays Chime for an unknown name and lets the master go 300 ms after the last stop', () => {
    const ctx = fakeContext();
    ctx.currentTime = 2;
    const { master, endsAt } = scheduleChime(ctx, 2, 'siren');
    expect(ctx.oscillators).toHaveLength(4);
    expect(master.gain.value).toBe(0.16);
    expect(close(endsAt, 2 + 0.12 + 0.52 + 0.3)).toBe(true);
    vi.advanceTimersByTime(930);
    expect(master.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(master.disconnect).toHaveBeenCalled();
  });
});

describe('the player', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.window;
  });

  it('makes no context before a gesture, and none for a touch pointerdown without activation', () => {
    const win = fakeWindow();
    const player = createChimePlayer(win);
    player.listen(true);
    expect(win.contexts).toHaveLength(0);
    win.navigator.userActivation.isActive = false;
    win.fire('pointerdown', { pointerType: 'touch' });
    expect(win.contexts).toHaveLength(0);
    win.navigator.userActivation.isActive = true;
    win.fire('pointerup', { pointerType: 'touch' });
    expect(win.contexts).toHaveLength(1);
    expect(win.contexts[0].resume).toHaveBeenCalled();
    expect(win.contexts[0].sources[0].start).toHaveBeenCalledWith(0); // the silent buffer
  });

  it('ignores an untrusted click', () => {
    const win = fakeWindow();
    const player = createChimePlayer(win);
    player.listen(true);
    win.fire('click', { isTrusted: false });
    expect(win.contexts).toHaveLength(0);
  });

  it('unlocks again on a later event while the context isn’t running', () => {
    const win = fakeWindow(() => fakeContext({ state: 'suspended' }));
    const player = createChimePlayer(win);
    player.listen(true);
    win.fire('pointerdown');
    win.fire('keydown');
    expect(win.contexts).toHaveLength(1);
    expect(win.contexts[0].resume).toHaveBeenCalledTimes(2);
    expect(win.contexts[0].sources).toHaveLength(2);
  });

  it('removes the listeners once running and adds them back when interrupted', () => {
    const win = fakeWindow(() => fakeContext({ state: 'suspended' }));
    const player = createChimePlayer(win);
    player.listen(true);
    expect(win.listeners.size).toBe(5);
    win.fire('pointerdown');
    win.contexts[0].setState('running');
    expect(win.listeners.size).toBe(0);
    win.contexts[0].setState('interrupted');
    expect(win.listeners.size).toBe(5);
  });

  it('is not ready with a resume() that never settles, after 300 ms, and never makes a sound', async () => {
    const win = fakeWindow(() =>
      fakeContext({ state: 'suspended', resume: () => new Promise(() => {}) }),
    );
    const player = createChimePlayer(win);
    expect(await player.ready()).toBe(false); // no context: the person never clicked
    player.unlock({ isTrusted: true });
    const ready = player.ready();
    await vi.advanceTimersByTimeAsync(300);
    expect(await ready).toBe(false);
    expect(win.contexts[0].oscillators).toHaveLength(0);
  });

  it('plays the person’s sound for a batch', () => {
    const win = fakeWindow();
    const player = createChimePlayer(win);
    player.unlock({ isTrusted: true });
    player.play({ ids: [4], tone: 'ding' });
    const freq = win.contexts[0].log.find(([name]) => name === 'osc0.frequency');
    expect(freq[2]).toBe(1046.5);
  });

  it('plays at once and resolves played when the context starts on the next tick', async () => {
    let ctx;
    const win = fakeWindow(() => {
      ctx = fakeContext({ state: 'suspended' });
      ctx.resume = vi.fn(() =>
        Promise.resolve().then(() => {
          ctx.state = 'running';
        }),
      );
      return ctx;
    });
    globalThis.window = win;
    const played = playChimeNow('pop');
    expect(ctx.oscillators).toHaveLength(1); // scheduled synchronously, inside the click
    expect(ctx.log.find(([name]) => name === 'osc0.frequency')[2]).toBe(880);
    expect(await played).toEqual({ played: true });
  });

  it('resolves not played when the context never runs, and lets the master go at once', async () => {
    const win = fakeWindow(() =>
      fakeContext({ state: 'suspended', resume: () => new Promise(() => {}) }),
    );
    const player = createChimePlayer(win);
    const played = player.playNow('chime');
    await vi.advanceTimersByTimeAsync(300);
    expect(await played).toEqual({ played: false });
    expect(win.contexts[0].gains[0].disconnect).toHaveBeenCalled();
  });

  it('resolves not played without Web Audio', async () => {
    const win = fakeWindow();
    delete win.AudioContext;
    expect(await createChimePlayer(win).playNow('chime')).toEqual({ played: false });
  });

  it('calls the e2e hook instead of making a sound, with no context', async () => {
    const win = fakeWindow();
    const calls = [];
    win.__daybookChime = (info) => calls.push(info);
    const player = createChimePlayer(win);
    player.listen(true);
    player.unlock({ isTrusted: true });
    expect(await player.ready()).toBe(true);
    expect(player.state()).toBe('running');
    player.play({ ids: [7, 6], tone: 'ding' });
    expect(await player.playNow('pop')).toEqual({ played: true });
    expect(calls).toEqual([
      { reason: 'batch', ids: [7, 6], tone: 'ding' },
      { reason: 'test', ids: [], tone: 'pop' },
    ]);
    expect(win.contexts).toHaveLength(0);
  });
});

describe('claimChime and the alerted record', () => {
  const userId = 4;
  let store;
  const storage = () => ({
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  });

  beforeEach(() => {
    store = new Map();
    resetChimeGateForTests();
  });

  it('allows one chime per 10 s', () => {
    const s = storage();
    expect(claimChime({ userId, ids: [1], now: 100_000, storage: s })).toBe('play');
    expect(claimChime({ userId, ids: [2], now: 109_999, storage: s })).toBe('too_soon');
    expect(claimChime({ userId, ids: [2], now: 110_000, storage: s })).toBe('play');
  });

  it('says done_elsewhere for an id another tab chimed for', () => {
    const s = storage();
    claimChime({ userId, ids: [1, 2], now: 100_000, storage: s });
    expect(claimChime({ userId, ids: [2, 3], now: 200_000, storage: s })).toBe('done_elsewhere');
  });

  it('plays for ids a card of the same flush marked shown', () => {
    const s = storage();
    markAlerted({ userId, ids: [5], now: 100_000, storage: s });
    expect(isAlerted({ userId, id: 5, now: 100_000, storage: s })).toBe(true);
    expect(claimChime({ userId, ids: [5], now: 100_000, storage: s })).toBe('play');
  });

  it('falls back to memory when the storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(claimChime({ userId, ids: [1], now: 100_000, storage: broken })).toBe('play');
    expect(claimChime({ userId, ids: [2], now: 105_000, storage: broken })).toBe('too_soon');
    expect(claimChime({ userId, ids: [1], now: 200_000, storage: broken })).toBe('done_elsewhere');
  });

  it('keeps 50 ids per list and drops ones older than 10 minutes', () => {
    const s = storage();
    const ids = Array.from({ length: 60 }, (_, i) => i + 1);
    markAlerted({ userId, ids, now: 100_000, storage: s });
    let record = readRecord(userId, s, 100_000);
    expect(record.shown).toHaveLength(50);
    expect(record.shown[0][0]).toBe(11);
    claimChime({ userId, ids: [99], now: 100_000, storage: s });
    record = readRecord(userId, s, 100_000 + 600_001);
    expect(record.shown).toEqual([]);
    expect(record.chimed).toEqual([]);
    expect(JSON.parse(store.get('daybook.live.4')).chimed).toEqual([[99, 100_000]]);
  });
});
