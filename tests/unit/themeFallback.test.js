// The light theme for browsers without light-dark() (globals.css, CONTRACT 21): every colour token
// written light-dark(light, dark) has a fallback in the @supports not block, with the same light
// value, and the block holds nothing else. Without it those browsers would lose every colour.
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

function fallbackTokens() {
  const start = css.indexOf('@supports not (color: light-dark(#000, #fff))');
  expect(start).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf('\n}\n', start));
  return new Map(
    [...block.matchAll(/^ {4}(--[a-z0-9-]+): ([^;]+);/gm)].map(([, name, value]) => [name, value]),
  );
}

describe('globals.css without light-dark()', () => {
  it('gives every themed colour its light value', () => {
    const themed = themedTokens();
    expect(themed.size).toBeGreaterThan(40);
    expect(Object.fromEntries(fallbackTokens())).toEqual(Object.fromEntries(themed));
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
