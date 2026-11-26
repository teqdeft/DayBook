// The motion tokens (CONTRACT 28 Motion, Tokens): src/lib/motion/tokens.js and globals.css hold
// the same numbers; the reduce block zeroes exactly the moving names and turns entrances and exits
// into the short fade; the 1.12 global "0.01 ms" rule stays gone. Every CSS module with an
// animation or a transition uses the tokens: no literal times (outside the infinite animations
// below, which keep their own times and have their own reduce block), @keyframes move only by the
// distance tokens (so with reduce they become fades), a transform transition stops with reduce, and
// nothing transitions a layout property.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DUR, EASE, LIFT, LIMITS, duration } from '@/lib/motion/tokens';

/** Infinite animations that keep their own times, and what their reduce block does. */
const INFINITE = {
  'src/components/Button.module.css': 'pulse',
  'src/app/(app)/projects/[id]/BusyButton.module.css': 'pulse',
  'src/app/(app)/report/LinePolish.module.css': 'pulse',
  'src/app/(app)/report/PolishProvider.module.css': 'pulse',
  'src/components/Skeleton.module.css': 'still',
  'src/components/NotificationBell.module.css': 'still', // the bell swing
  'src/app/(app)/today/TimerCard.module.css': 'still', // the live dot
  'src/components/TimerChip.module.css': 'still',
  'src/app/(app)/ask/AskChat.module.css': 'still',
  'src/components/LaunchSplash.module.css': 'hidden', // launchScript.js skips it with reduce too
};
const REDUCE = '(prefers-reduced-motion: reduce)';
const LAYOUT =
  /^(width|height|min-width|max-width|min-height|max-height|top|right|bottom|left|inset|margin(-[a-z]+)?|padding(-[a-z]+)?|flex-basis|all)$/;
const MOVES = /^(transform|translate|scale|rotate)$/;
const TIMED = /^(animation|transition)(-duration|-delay)?$/;
const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The index of the brace that closes the one at `open`. */
function closing(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && (depth -= 1) === 0) return i;
  }
  throw new Error('Unbalanced braces');
}

/** Splits at `sep` outside parentheses. */
function splitTop(text, sep) {
  const parts = [''];
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === sep && depth === 0) parts.push('');
    else parts[parts.length - 1] += char;
  }
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** `prop: value` pairs of a block, each value on one line. */
const declarations = (body) =>
  splitTop(body, ';').map((text) => {
    const colon = text.indexOf(':');
    const value = text
      .slice(colon + 1)
      .replace(/\s+/g, ' ')
      .trim();
    return { prop: text.slice(0, colon).trim(), value };
  });

/**
 * Every rule of a stylesheet, flat: { at: the @media and @supports around it, selector, decls };
 * a @keyframes is one rule with its `steps`.
 */
function rules(css, at = []) {
  const found = [];
  for (let start = 0, open; (open = css.indexOf('{', start)) !== -1;) {
    const close = closing(css, open);
    const selector = css.slice(start, open).trim().replace(/\s+/g, ' ');
    const body = css.slice(open + 1, close);
    if (/^@(media|supports)/.test(selector)) found.push(...rules(body, [...at, selector]));
    else if (selector.startsWith('@keyframes')) {
      const steps = rules(body).flatMap((step) => step.decls);
      found.push({ at, selector, name: selector.split(' ')[1], steps, decls: [] });
    } else found.push({ at, selector, decls: declarations(body) });
    start = close + 1;
  }
  return found;
}

/** Every stylesheet in src, without its comments, as rules. */
const read = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const sheets = readdirSync('src', { recursive: true })
  .map((name) => `src/${name.replaceAll('\\', '/')}`)
  .filter((file) => file.endsWith('.css'))
  .map((file) => ({ file, rules: rules(read(file)) }));
const globals = sheets.find(({ file }) => file === 'src/app/globals.css').rules;

/** Every timed declaration of every sheet, with where it is. */
const timed = sheets.flatMap(({ file, rules: list }) =>
  list.flatMap((rule) =>
    rule.decls
      .filter(({ prop }) => TIMED.test(prop))
      .map((decl) => ({
        file,
        rule,
        ...decl,
        where: `${file} ${rule.selector} { ${decl.prop}: ${decl.value} }`,
      })),
  ),
);
const withoutVars = (value) => value.replace(/var\(--[a-z0-9-]+\)/g, '');
const literalTime = (value) => /(^|[\s,(])-?\d*\.?\d+m?s\b/.test(withoutVars(value));
const literalEase = (value) =>
  /cubic-bezier\(|\bease(-in|-out|-in-out)?\b/.test(withoutVars(value));
const inReduce = (rule) => rule.at.some((at) => at.includes(REDUCE));

/** The declarations of the top-level :root rules (or the ones inside `at`), as a Map. */
function rootTokens(at) {
  const list = globals.filter(
    (rule) => rule.selector === ':root' && (at ? rule.at.includes(at) : rule.at.length === 0),
  );
  return new Map(list.flatMap((rule) => rule.decls).map(({ prop, value }) => [prop, value]));
}
const root = rootTokens();
const reduced = rootTokens(`@media ${REDUCE}`);
const named = (prefix) => [...root.keys()].filter((name) => name.startsWith(prefix));

describe('the motion tokens', () => {
  it('are the same in tokens.js and globals.css', () => {
    expect(Object.fromEntries(named('--dur-').map((name) => [name, root.get(name)]))).toEqual(
      Object.fromEntries(
        Object.entries(DUR).map(([key, ms]) => [`--dur-${kebab(key)}`, `${ms}ms`]),
      ),
    );
    expect(Object.fromEntries(named('--ease-').map((name) => [name, root.get(name)]))).toEqual(
      Object.fromEntries(Object.entries(EASE).map(([key, curve]) => [`--ease-${key}`, curve])),
    );
    expect([root.get('--lift-scale'), root.get('--lift-tilt'), root.get('--lift-rise')]).toEqual([
      String(LIFT.scale),
      `${LIFT.tiltDeg}deg`,
      `${LIFT.risePx}px`,
    ]);
  });

  it('have the numbers of CONTRACT 28', () => {
    expect(DUR).toMatchObject({ press: 110, fade: 120, lift: 150, room: 200, flash: 700 });
    expect(DUR).toMatchObject({ dropMin: 250, dropMax: 400, in: 220, out: 160, toastOut: 150 });
    expect(LIFT).toEqual({ scale: 1.02, tiltDeg: 2, risePx: -2 });
    expect(LIMITS).toEqual({
      flipCards: 150,
      dragThreshold: 6,
      settleLock: 400,
      autoScrollDelay: 300,
      edgeMax: 160,
      edgeShare: 0.25,
      edgeSpeed: 20,
      tickWait: 600,
      announceDebounce: 100,
      newCardWait: 2000,
    });
    expect(root.get('--shift-live')).toBe('-8px');
    expect(root.get('--shift-menu')).toBe('-4px');
    expect(root.get('--scale-pop')).toBe('0.98');
  });

  it('with reduce zero exactly the moving names, fade the entrances and keep the rest', () => {
    const moving = [
      'lift',
      'room',
      'tint',
      'tick',
      'drop-min',
      'drop-max',
      'fold',
      'glide',
      'fill',
    ];
    const faded = ['tag', 'in', 'out', 'toast-in', 'toast-out'];
    const expected = {
      '--lift-scale': '1',
      '--lift-tilt': '0deg',
      '--lift-rise': '0px',
      ...Object.fromEntries(moving.map((name) => [`--dur-${name}`, '0ms'])),
      ...Object.fromEntries(faded.map((name) => [`--dur-${name}`, 'var(--dur-fade)'])),
      ...Object.fromEntries(named('--shift-').map((name) => [name, '0px'])),
      ...Object.fromEntries(named('--scale-').map((name) => [name, '1'])),
    };
    expect(Object.fromEntries(reduced)).toEqual(expected);
    expect(named('--shift-')).toHaveLength(8);
    expect(named('--scale-')).toEqual(['--scale-pop', '--scale-fold']);
  });

  it("duration() follows the same reduce block; with no window it isn't reduced", () => {
    for (const key of Object.keys(DUR)) {
      const css = reduced.get(`--dur-${kebab(key)}`);
      const ms = css === '0ms' ? 0 : css === 'var(--dur-fade)' ? DUR.fade : DUR[key];
      expect([key, duration(key, true)]).toEqual([key, ms]);
      expect(duration(key, false)).toBe(DUR[key]);
      expect(duration(key)).toBe(DUR[key]);
    }
    expect([duration('press', true), duration('flash', true), duration('in', true)]).toEqual([
      110, 700, 120,
    ]);
  });

  it('keep the lift shadow beside the menu shadow', () => {
    expect(root.get('--shadow-lift')).toBe(
      '0 14px 32px color-mix(in srgb, var(--navy) 18%, transparent), 0 2px 6px color-mix(in srgb, var(--navy) 10%, transparent)',
    );
  });
});

describe('every stylesheet', () => {
  it('is read, the 38 modules with motion among them (39 files in 1.12 with globals.css)', () => {
    const moving = new Set(timed.map(({ file }) => file));
    expect(moving.size).toBeGreaterThanOrEqual(38);
    for (const file of Object.keys(INFINITE)) expect(moving.has(file)).toBe(true);
  });

  it('never brings back the global 0.01 ms rule', () => {
    expect(
      timed.filter(({ value }) => /0\.01ms|!important/.test(value)).map((d) => d.where),
    ).toEqual([]);
    const star = globals.filter(
      (rule) => rule.selector.includes('*') && rule.decls.some((d) => TIMED.test(d.prop)),
    );
    expect(star).toEqual([]);
  });

  it('times every animation and transition with the tokens', () => {
    const allowed = ({ file, prop, value }) =>
      INFINITE[file] === 'hidden' ||
      (INFINITE[file] &&
        (prop !== 'animation' || value.includes('infinite')) &&
        prop !== 'transition');
    const literal = timed.filter((decl) => !allowed(decl) && literalTime(decl.value));
    expect(literal.map((d) => d.where)).toEqual([]);
    const curves = timed.filter((decl) => !allowed(decl) && literalEase(decl.value));
    expect(curves.map((d) => d.where)).toEqual([]);
    const loops = timed.filter(({ file, value }) => !INFINITE[file] && /\binfinite\b/.test(value));
    expect(loops.map((d) => d.where)).toEqual([]);
  });

  it('uses only tokens that globals.css defines', () => {
    const used = sheets.flatMap(({ file }) =>
      [...read(file).matchAll(/var\((--(dur|ease|shift|scale|lift)-[a-z0-9-]+)\)/g)].map(
        ([, name]) => ({
          file,
          name,
        }),
      ),
    );
    expect(used.length).toBeGreaterThan(50);
    expect(used.filter(({ name }) => !root.has(name))).toEqual([]);
  });

  it('never transitions a layout property', () => {
    const named = timed
      .filter(({ prop }) => prop === 'transition')
      .flatMap((decl) =>
        splitTop(decl.value, ',').map((part) => ({ ...decl, part: part.split(' ')[0] })),
      );
    expect(named.filter(({ part }) => LAYOUT.test(part)).map((d) => d.where)).toEqual([]);
  });

  it('stops a transform transition with reduce (a moving token or the module turns it off)', () => {
    const zero = new Set([...reduced].filter(([, value]) => value === '0ms').map(([name]) => name));
    const offInReduce = (file) =>
      sheets
        .find((sheet) => sheet.file === file)
        .rules.some(
          (rule) =>
            inReduce(rule) && rule.decls.some((d) => d.prop === 'transition' && d.value === 'none'),
        );
    const moving = timed
      .filter(({ prop, rule }) => prop === 'transition' && !inReduce(rule))
      .flatMap((decl) => splitTop(decl.value, ',').map((part) => ({ ...decl, part })))
      .filter(({ part }) => MOVES.test(part.split(' ')[0]));
    expect(moving.length).toBeGreaterThan(5);
    const kept = moving.filter(({ file, part }) => {
      const token = part.match(/var\((--dur-[a-z-]+)\)/)?.[1];
      return !zero.has(token) && !offInReduce(file);
    });
    expect(kept.map((d) => d.where)).toEqual([]);
  });

  it('changes only colours on hover and press: no scale, and with reduce nothing moves', () => {
    const pressed = sheets.flatMap(({ file, rules: list }) =>
      list
        .filter((rule) => /:(hover|active)\b/.test(rule.selector) && !inReduce(rule))
        .flatMap((rule) =>
          rule.decls
            .filter(({ prop, value }) => MOVES.test(prop) && value !== 'none')
            .map(({ prop, value }) => ({ file, list, rule, prop, value })),
        ),
    );
    const where = ({ file, rule, prop, value }) => `${file} ${rule.selector} { ${prop}: ${value} }`;
    const scaled = pressed.filter(({ prop, value }) => prop === 'scale' || /scale/.test(value));
    expect(scaled.map(where)).toEqual([]);
    const stays = ({ list, rule, prop }) =>
      list.some(
        (one) =>
          inReduce(one) &&
          one.selector === rule.selector &&
          one.decls.some((d) => d.prop === prop && d.value === 'none'),
      );
    expect(pressed.filter((move) => !stays(move)).map(where)).toEqual([]);
    const swatch = sheets.find(({ file }) => file.endsWith('projects/ColorSwatches.module.css'));
    const hover = swatch.rules.find((rule) => rule.selector === '.panelSwatch:hover');
    expect(hover?.decls).toEqual([{ prop: 'background', value: 'var(--line-strong)' }]);
  });

  it('moves @keyframes only by the distance tokens, so with reduce they are fades', () => {
    const TOKEN =
      /var\(--(shift|scale|lift)-[a-z-]+\)|calc\(var\(--shift-[a-z-]+\) \* -?\d*\.?\d+\)|var\(--share\)/g;
    const FUNCTIONS = /^((translate[XYZ]?|scale[XYZ]?|rotate[XYZ]?)\(T(, T)*\) ?)+$/;
    const bad = sheets
      .filter(({ file }) => !INFINITE[file])
      .flatMap(({ file, rules: list }) =>
        list.flatMap((rule) =>
          (rule.steps ?? [])
            .filter(({ prop }) => MOVES.test(prop))
            .filter(
              ({ value }) =>
                value.trim() !== 'none' && !FUNCTIONS.test(value.replace(TOKEN, 'T').trim()),
            )
            .map(({ value }) => `${file} ${rule.selector} ${value}`),
        ),
      );
    expect(bad).toEqual([]);
  });

  it('gives every infinite animation its own reduce block', () => {
    for (const [file, kind] of Object.entries(INFINITE)) {
      const list = sheets.find((sheet) => sheet.file === file).rules;
      const reduce = list.filter(inReduce).flatMap((rule) => rule.decls);
      const has = (prop, test) => reduce.some((d) => d.prop === prop && test(d.value));
      if (kind === 'still')
        expect([file, has('animation', (v) => v === 'none')]).toEqual([file, true]);
      if (kind === 'hidden')
        expect([file, has('display', (v) => v === 'none')]).toEqual([file, true]);
      if (kind !== 'pulse') continue;
      // Spinners: a slow pulse whose keyframes only change opacity (work is still going on).
      const fades = (name) =>
        list.some(
          (rule) => rule.name === name && rule.steps.every((step) => step.prop === 'opacity'),
        );
      const pulse = reduce.find((d) => d.prop === 'animation' && d.value.includes('infinite'));
      expect([file, Boolean(pulse && fades(pulse.value.split(' ')[0]))]).toEqual([file, true]);
    }
  });
});

describe('the moments of CONTRACT 28', () => {
  const decl = (file, selector, prop = 'animation') =>
    sheets
      .find((sheet) => sheet.file === file)
      .rules.find((rule) => rule.selector === selector && !inReduce(rule))
      ?.decls.find((d) => d.prop === prop)?.value;

  it('bring windows in with --dur-in, menus with the fade and toasts with --dur-toast-in', () => {
    expect(decl('src/components/Dialog.module.css', '.panel')).toBe(
      'pop-in var(--dur-in) var(--ease-decelerate)',
    );
    expect(decl('src/components/Drawer.module.css', '.panel')).toBe(
      'slide-in var(--dur-in) var(--ease-decelerate)',
    );
    expect(decl('src/components/Menu.module.css', '.menu')).toBe(
      'menu-in var(--dur-fade) var(--ease-out)',
    );
    expect(decl('src/components/ToastProvider.module.css', '.toast')).toBe(
      'toast-in var(--dur-toast-in) var(--ease-out)',
    );
  });

  it("keep the preview stack's in and out as fades with reduce, so animationend still fires", () => {
    const stack = 'src/components/live/PreviewStack.module.css';
    expect(decl(stack, '.item')).toBe('live-in var(--dur-toast-in) var(--ease-out)');
    expect(decl(stack, '.item.leaving')).toBe(
      'live-out var(--dur-toast-out) var(--ease-accelerate) forwards',
    );
    expect([reduced.get('--dur-toast-in'), reduced.get('--dur-toast-out')]).toEqual([
      'var(--dur-fade)',
      'var(--dur-fade)',
    ]);
  });
});
