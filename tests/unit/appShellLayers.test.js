// The sticky sidebar paints over the page (CONTRACT 28, Performance limits). Chrome gives the sticky
// box its own layer, and every positioned piece of the page painted after it then gets one of its
// own ("Overlap"): 149 layers on a board of 150 cards, about 28 ms of each frame in which anything
// moves. With a z-index over the page's own pieces (1 to 6) the board is on 6 layers; it stays under
// everything that floats (menus, windows, toasts, the drag preview: 30 and up), so nothing is hidden.
// board-perf.spec.js counts the layers in the browser.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SHELL = 'src/components/AppShell.module.css';

/** Every z-index in the stylesheets but the shell's, as `{ file, value }`. */
const others = readdirSync('src', { recursive: true })
  .map((name) => `src/${name.replaceAll('\\', '/')}`)
  .filter((file) => file.endsWith('.css') && file !== SHELL)
  .flatMap((file) =>
    [...read(file).matchAll(/z-index:\s*(-?\d+)/g)].map(([, value]) => ({ file, value: +value })),
  );

describe("the sidebar's layer", () => {
  const rule = /\.shell \.sidebar > \* \{([^}]*)\}/.exec(read(SHELL))[1];
  const sidebar = Number(/z-index:\s*(\d+)/.exec(rule)?.[1]);

  it('is the sticky box, over every piece of the page', () => {
    expect(rule).toMatch(/position: sticky;/);
    expect(sidebar).toBeGreaterThan(6);
    expect(others.length).toBeGreaterThan(20);
    const page = others.filter(({ value }) => value < 30);
    expect(page.filter(({ value }) => value >= sidebar)).toEqual([]);
  });

  it('stays under what floats over the page', () => {
    const floating = others.filter(({ value }) => value >= 30);
    expect(floating.length).toBeGreaterThan(10);
    expect(sidebar).toBeLessThan(30);
    const skip = /\.skip \{([^}]*)\}/.exec(read(SHELL))[1];
    expect(Number(/z-index:\s*(\d+)/.exec(skip)[1])).toBeGreaterThan(sidebar);
  });
});
