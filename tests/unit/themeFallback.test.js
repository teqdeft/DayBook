// The light theme for browsers without light-dark() (globals.css, CONTRACT 21): every colour token
// written light-dark(light, dark) has a fallback in the @supports not block, with the same light
// value, and the block holds nothing else but the two shadows written without color-mix(). Without
// it those browsers would lose every colour.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');

/** The light side of light-dark(light, dark): everything before the top-level comma. */
function lightSide(args) {
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '(') depth += 1;
    else if (args[i] === ')') depth -= 1;
    else if (args[i] === ',' && depth === 0) return args.slice(0, i).trim();
  }
  throw new Error(`No light side in light-dark(${args})`);
}

function themedTokens() {
  const tokens = new Map();
  for (const [, name, args] of css.matchAll(/^ {2}(--[a-z0-9-]+): light-dark\((.+)\);/gm)) {
    tokens.set(name, lightSide(args));
  }
  return tokens;
}

/** A value written over several lines (a list of shadows), on one line. */
const oneLine = (value) => value.replace(/\s+/g, ' ').trim();

function fallbackTokens() {
  const start = css.indexOf('@supports not (color: light-dark(#000, #fff))');
  expect(start).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf('\n}\n', start));
  return new Map(
    [...block.matchAll(/^ {4}(--[a-z0-9-]+):\s*([^;]+);/gm)].map(([, name, value]) => [
      name,
      oneLine(value),
    ]),
  );
}

/** A top-level :root token's value (two-space indent, outside the @supports block). */
const rootToken = (name) => {
  const value = css.match(new RegExp(`^ {2}${name}:\\s*([^;]+);$`, 'm'))?.[1];
  return value === undefined ? undefined : oneLine(value);
};

/** The light navy as "r, g, b" for an rgba() fallback. */
const lightNavy = () => {
  const navy = themedTokens().get('--navy');
  return [1, 3, 5].map((at) => parseInt(navy.slice(at, at + 2), 16)).join(', ');
};

describe('globals.css without light-dark()', () => {
  it('gives every themed colour its light value, and the two shadows, and nothing else', () => {
    const themed = themedTokens();
    expect(themed.size).toBeGreaterThan(40);
    const fallback = fallbackTokens();
    fallback.delete('--shadow-menu'); // the tokens without light-dark() (below)
    fallback.delete('--shadow-lift');
    expect(Object.fromEntries(fallback)).toEqual(Object.fromEntries(themed));
  });

  it('has the menu shadow in both themes and without color-mix() (CONTRACT 27)', () => {
    // The value Menu.module.css and ToastProvider.module.css use; navy follows the theme.
    expect(rootToken('--shadow-menu')).toBe(
      '0 12px 32px color-mix(in srgb, var(--navy) 14%, transparent)',
    );
    // Browsers without light-dark() may lack color-mix() too: the light navy at 14%.
    expect(fallbackTokens().get('--shadow-menu')).toBe(`0 12px 32px rgba(${lightNavy()}, 0.14)`);
  });

  it("has the dragged card's lift shadow in both themes and without color-mix() (CONTRACT 28)", () => {
    expect(rootToken('--shadow-lift')).toBe(
      '0 14px 32px color-mix(in srgb, var(--navy) 18%, transparent), ' +
        '0 2px 6px color-mix(in srgb, var(--navy) 10%, transparent)',
    );
    // The light navy at 18% and 10%, as CONTRACT 28 writes it.
    expect(lightNavy()).toBe('21, 24, 51');
    expect(fallbackTokens().get('--shadow-lift')).toBe(
      '0 14px 32px rgba(21, 24, 51, 0.18), 0 2px 6px rgba(21, 24, 51, 0.1)',
    );
  });

  it('keeps the picture veil and its text the same in both themes (CONTRACT 27)', () => {
    expect(rootToken('--photo-veil')).toBe('rgba(5, 6, 16, 0.86)');
    expect(rootToken('--photo-veil-text')).toBe('#ffffff');
    const fallback = fallbackTokens();
    expect(fallback.has('--photo-veil')).toBe(false);
    expect(fallback.has('--photo-veil-text')).toBe(false);
  });

  it('covers the yellow project colour (CONTRACT 23)', () => {
    const fallback = fallbackTokens();
    expect(themedTokens().get('--label-yellow-bg')).toBe('#f6f2c0');
    expect(fallback.get('--label-yellow-bg')).toBe('#f6f2c0');
    expect(fallback.get('--label-yellow-text')).toBe('#565000');
    // The strong colour is the same in both themes, like the other label colours.
    expect(css).toMatch(/^ {2}--label-yellow: #d4b300;$/m);
    expect(fallback.has('--label-yellow')).toBe(false);
  });
});
