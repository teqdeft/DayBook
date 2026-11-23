// The bell's sounds (CONTRACT 26): four short sounds Daybook synthesizes with Web Audio (plain
// sine oscillators with gain envelopes; no file, nothing to download), and the one player per page
// that unlocks the audio inside a gesture and plays the person's sound. A sound is never queued
// for later: when the audio can't run right now, nothing plays and the card still shows.
//
// Test hook: when `window.__daybookChime` is a function, the player calls it instead of making a
// sound ({ reason: 'batch' | 'test', ids, tone }), `ready()` is true and no context is ever made.
// Production never defines it; the e2e does with page.addInitScript.

const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'];
const RESUME_WAIT_MS = 300; // a resume() can stay pending for ever (browser.md §1)
const START_DELAY_S = 0.01;
const MASTER_TAIL_S = 0.3; // the master gain goes 300 ms after the last oscillator stops
const FLOOR = 0.001; // exponential ramps never reach 0 (they throw)

const freezeTone = (tone) =>
  Object.freeze({
    ...tone,
    notes: Object.freeze(tone.notes.map((note) => Object.freeze({ ...note }))),
    partials: Object.freeze(tone.partials.map((partial) => Object.freeze({ ...partial }))),
  });

/** The four sounds, exactly CONTRACT 26's table. */
export const TONES = Object.freeze({
  chime: freezeTone({
    label: 'Chime',
    notes: [
      { hz: 659.25, at: 0 },
      { hz: 987.77, at: 0.12 },
    ],
    partials: [
      { ratio: 1, gain: 1, decay: 0.5 },
      { ratio: 2, gain: 0.25, decay: 0.25 },
    ],
    attack: 0.01,
    stopAfter: 0.52,
    master: 0.16,
  }),
  bell: freezeTone({
    label: 'Soft bell',
    notes: [{ hz: 783.99, at: 0 }],
    partials: [
      { ratio: 1, gain: 1, decay: 1.2 },
      { ratio: 2.76, gain: 0.3, decay: 0.6 },
      { ratio: 5.4, gain: 0.12, decay: 0.3 },
    ],
    attack: 0.005,
    stopAfter: 1.22,
    master: 0.14,
  }),
  ding: freezeTone({
    label: 'Ding',
    notes: [{ hz: 1046.5, at: 0 }],
    partials: [
      { ratio: 1, gain: 1, decay: 0.6 },
      { ratio: 2, gain: 0.2, decay: 0.3 },
    ],
    attack: 0.005,
    stopAfter: 0.62,
    master: 0.14,
  }),
  pop: freezeTone({
    label: 'Pop',
    notes: [{ hz: 880, at: 0, glideTo: 440, glide: 0.08 }],
    partials: [{ ratio: 1, gain: 1, decay: 0.12 }],
    attack: 0.004,
    stopAfter: 0.14,
    master: 0.2,
  }),
});

/** The `bellTone` values, in My settings' order. */
export const TONE_NAMES = Object.freeze(['chime', 'bell', 'ding', 'pop']);

/** The default sound. */
export const CHIME = TONES.chime;

const toneOf = (name) => (Object.hasOwn(TONES, name) ? TONES[name] : CHIME);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeDisconnect(node) {
  try {
    node?.disconnect();
  } catch {
    // already disconnected
  }
}

/** One sine per partial of one note, with its own attack and decay, into `master`. */
function schedulePartial(ctx, master, { note, partial, tone, start }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(note.hz * partial.ratio, start);
  if (note.glideTo) {
    osc.frequency.exponentialRampToValueAtTime(note.glideTo * partial.ratio, start + note.glide);
  }
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(partial.gain, start + tone.attack);
  env.gain.exponentialRampToValueAtTime(FLOOR, start + partial.decay);
  osc.connect(env);
  env.connect(master);
  osc.onended = () => {
    safeDisconnect(osc);
    safeDisconnect(env);
  };
  osc.start(start);
  osc.stop(start + tone.stopAfter);
}

/**
 * Schedules one sound on a running (or starting) context.
 * @param {AudioContext} ctx
 * @param {number} t0 when it starts, in the context's time (ctx.currentTime + 0.01)
 * @param {string} [tone] a TONE_NAMES value; an unknown name plays Chime
 * @returns {{ master: GainNode, endsAt: number }} `endsAt` = when the master gain goes
 */
export function scheduleChime(ctx, t0, tone = 'chime') {
  const spec = toneOf(tone);
  const master = ctx.createGain();
  master.gain.value = spec.master;
  master.connect(ctx.destination);
  for (const note of spec.notes) {
    const start = t0 + note.at;
    for (const partial of spec.partials)
      schedulePartial(ctx, master, { note, partial, tone: spec, start });
  }
  const lastAt = Math.max(...spec.notes.map((note) => note.at));
  const endsAt = t0 + lastAt + spec.stopAfter + MASTER_TAIL_S;
  const delayMs = Math.max(0, (endsAt - (ctx.currentTime ?? 0)) * 1000);
  setTimeout(() => safeDisconnect(master), delayMs);
  return { master, endsAt };
}

/** Calls resume() without throwing; the promise never rejects. */
function resumeQuietly(ctx) {
  try {
    return Promise.resolve(ctx.resume()).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

/** A 1-sample silent buffer: starting a node inside the gesture also unlocks Safari. */
function startSilence(ctx) {
  try {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // never break the page for a sound
  }
}

/**
 * The page's player. `win` is injected for tests; the app uses getChimePlayer().
 * @param {Window} win
 */
export function createChimePlayer(win) {
  let ctx = null;
  let wanted = false; // the provider wants the unlock listeners (Sound isn't Off)
  let attached = false;
  const listeners = new Set();
  const hook = () => (typeof win?.__daybookChime === 'function' ? win.__daybookChime : null);
  const AudioContextClass = () => win?.AudioContext || win?.webkitAudioContext || null;
  const state = () => (hook() ? 'running' : (ctx?.state ?? 'none'));

  function attach(on) {
    const next = on && wanted;
    if (next === attached || !win?.addEventListener) return;
    attached = next;
    for (const type of UNLOCK_EVENTS) {
      if (next) win.addEventListener(type, onGesture, { capture: true, passive: true });
      else win.removeEventListener(type, onGesture, { capture: true });
    }
  }

  function onStateChange() {
    const current = ctx?.state;
    if (current === 'running') attach(false);
    else if (current === 'suspended' || current === 'interrupted') attach(true);
    listeners.forEach((listener) => listener(current));
  }

  /** The context, made if there is none, with resume() called and the silent buffer started. */
  function wake() {
    const Ctor = AudioContextClass();
    if (!Ctor) return null;
    try {
      if (!ctx) {
        ctx = new Ctor();
        ctx.onstatechange = onStateChange;
      }
    } catch {
      return null;
    }
    resumeQuietly(ctx);
    startSilence(ctx);
    return ctx;
  }

  /** Inside a gesture only (a touch pointerdown or Escape isn't one); never on an untrusted event. */
  function unlock(event) {
    if (!event?.isTrusted || hook()) return;
    const activation = win?.navigator?.userActivation;
    if (activation && !activation.isActive) return;
    wake();
  }

  function onGesture(event) {
    unlock(event);
  }

  return {
    unlock,
    state,
    /** The provider turns the unlock listeners on (Sound isn't Off) or off. */
    listen(on) {
      wanted = Boolean(on) && Boolean(AudioContextClass()) && !hook();
      attach(state() !== 'running');
    },
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Whether a sound could play now. It never makes a sound. */
    async ready() {
      if (hook()) return true;
      if (!ctx) return false;
      if (ctx.state === 'running') return true;
      await Promise.race([resumeQuietly(ctx), wait(RESUME_WAIT_MS)]);
      return ctx.state === 'running';
    },
    /** Plays the person's sound for a batch; only after ready() and claimChime said so. */
    play({ ids = [], tone = 'chime' } = {}) {
      const test = hook();
      if (test) {
        test({ reason: 'batch', ids, tone });
        return;
      }
      if (ctx?.state !== 'running') return;
      scheduleChime(ctx, ctx.currentTime + START_DELAY_S, tone);
    },
    /** My settings' Play sound and a pick: synchronously in the click, whatever the Sound choice. */
    playNow(tone = 'chime') {
      const test = hook();
      if (test) {
        test({ reason: 'test', ids: [], tone });
        return Promise.resolve({ played: true });
      }
      const context = wake();
      if (!context) return Promise.resolve({ played: false });
      let master = null;
      try {
        master = scheduleChime(context, (context.currentTime ?? 0) + START_DELAY_S, tone).master;
      } catch {
        return Promise.resolve({ played: false });
      }
      return Promise.race([resumeQuietly(context), wait(RESUME_WAIT_MS)]).then(() => {
        const played = context.state === 'running';
        if (!played) safeDisconnect(master); // a context that starts later never plays it late
        return { played };
      });
    },
  };
}

let pagePlayer = null;

/** The one player of this page (made on first use; no AudioContext until a gesture). */
export function getChimePlayer() {
  const win = typeof window === 'undefined' ? null : window;
  if (!pagePlayer || pagePlayer.win !== win) pagePlayer = { win, player: createChimePlayer(win) };
  return pagePlayer.player;
}

/**
 * Plays `tone` at once (My settings' Play sound, and picking a sound). Call it synchronously in the
 * click handler, before any await, so the click also unlocks the sound for this page.
 * @param {string} [tone] a TONE_NAMES value
 * @returns {Promise<{ played: boolean }>}
 */
export function playChimeNow(tone = 'chime') {
  return getChimePlayer().playNow(tone);
}
