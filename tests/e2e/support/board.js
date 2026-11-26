// Shared steps for the board specs (CONTRACT 28): a pointer drag as a person makes it with a mouse,
// the check that the page itself never scrolls sideways, and the animations still running.
import { expect } from '@playwright/test';

/**
 * A point of an element that is inside the window: the centre of the part of its box on screen
 * (a column taller than the window has its centre below the fold).
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} element
 * @returns {Promise<{ x: number, y: number }>}
 */
export async function pointOf(page, element) {
  const box = await element.boundingBox();
  if (!box) throw new Error('The element has no box (it is hidden or gone).');
  const { width, height } = page.viewportSize();
  const left = Math.max(box.x, 0);
  const right = Math.min(box.x + box.width, width);
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, height);
  if (right <= left || bottom <= top) throw new Error('The element is outside the window.');
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * Drags with the mouse (CONTRACT 28, Pointer drag): the element is scrolled into view, pressed at
 * its centre, moved 8 px (past the 6 px start), then in `steps` moves to the target, and released
 * there unless `release` is false (to press Escape, scroll or look at the preview mid-drag; call
 * `page.mouse.up()` afterwards).
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} from what is pressed: a card, its title or its grip
 * @param {import('@playwright/test').Locator | { x: number, y: number }} to a column, a card or a
 *   point in the window
 * @param {{ steps?: number, release?: boolean }} [options]
 * @returns {Promise<{ x: number, y: number }>} where the pointer ended
 */
export async function pointerDrag(page, from, to, { steps = 12, release = true } = {}) {
  await from.scrollIntoViewIfNeeded();
  const start = await pointOf(page, from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y);
  const end = 'boundingBox' in to ? await pointOf(page, to) : to;
  await page.mouse.move(end.x, end.y, { steps });
  if (release) await page.mouse.up();
  return end;
}

/**
 * Checks the page itself doesn't scroll sideways (CONTRACT 28, The sideways scroll): the document
 * is never wider than the window. The board and the Table scroll inside their own boxes.
 * @param {import('@playwright/test').Page} page
 * @param {string} where named in the failure message
 */
export async function expectNoSidewaysScroll(page, where) {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll, `${where}: the page is no wider than the window`).toBeLessThanOrEqual(
    sizes.client,
  );
}

/**
 * The animations still running after waiting at most 2 s for them to end: finite ones only (a
 * spinner or the live dot runs forever on purpose), optionally only those inside `scope` (a CSS
 * selector, for example the board). Each is named by its animation or transition and its element.
 * @param {import('@playwright/test').Page} page
 * @param {string} [scope]
 * @returns {Promise<string[]>} empty when nothing moves
 */
export async function runningAnimations(page, scope = null) {
  const running = () =>
    page.evaluate((selector) => {
      const name = (element) => {
        if (!element || !element.tagName) return 'a pseudo element';
        const id = element.id ? `#${element.id}` : '';
        const flip = element.getAttribute('data-flip');
        return `${element.tagName.toLowerCase()}${id}${flip ? `[data-flip="${flip}"]` : ''}`;
      };
      return document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .filter((animation) => {
          if (!selector) return true;
          const target = animation.effect?.target;
          return Boolean(target?.closest?.(selector));
        })
        .map((animation) => {
          const what =
            animation.animationName ??
            (animation.transitionProperty ? `transition of ${animation.transitionProperty}` : '');
          return `${what || animation.id || 'an animation'} on ${name(animation.effect?.target)}`;
        });
    }, scope);
  const deadline = Date.now() + 2000;
  let left = await running();
  while (left.length > 0 && Date.now() < deadline) {
    await page.waitForTimeout(100);
    left = await running();
  }
  return left;
}
