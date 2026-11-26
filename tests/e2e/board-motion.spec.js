// CONTRACT 28 (Daybook 1.13), Motion: the PM's pointer drag, the keyboard move and the calm motion
// around them (motion.md 6.3). A card dragged with the mouse from Development to Testing lands at
// its sorted place with one PATCH and "Moved to Testing.", and Undo takes it back; let go low, with
// the pointer over "+ Add task" and the card's centre below the column, it lands too, and on a short
// board (iwilltillimwell) in the room under the tallest column's cards as well. A click (or a 4 px
// wobble) opens the task; a real drag never does, not even after Escape. Escape, a release
// over its own column, the Done phases rail or the band sends nothing and leaves no preview. The
// keyboard move speaks in #move-live and keeps the focus on the grip. With reduced motion the
// preview's card never tilts and nothing slides. Nothing animates on load or on a server refresh.
// Touch never lifts a card (the board scrolls); the board scrolls itself near its edge during a
// drag; files from the computer still attach to a card; a phase move puts the ring and "Current"
// on the next phase. A tick leaves the open list after its pause.
//
// acme-store is the board (iwilltillimwell for the phase move); everything moved is moved back
// (Undo, or the API), so the later specs find the demo as it is. Every /api/ai/** request is
// answered in the browser (support/projectPlan.js).
import { pointOf, pointerDrag, runningAnimations } from './support/board.js';
import { closeDemoData, projectIdByName } from './support/demoData.js';
import { dropFiles, fileFixture } from './support/files.js';
import { PEOPLE, expect, open, problemsOf, signIn, test, toasts } from './support/fixtures.js';
import { stubAi, write } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'acme-store';
const DRAGGED = 'Stock sync with the warehouse'; // Simran's, open, P2, in Development
const OTHER = 'Shipping options at checkout'; // Simran's, open, P2, in Development
const TALL = 'Checkout fix before client demo'; // Simran's, open, P1, in Development, with files
const INTO = 'Write the test plan'; // the PM's, open, P2, in Testing
const SHORT = 'Test on phones and tablets'; // Simran's, open, P2, in Testing on iwilltillimwell

const ids = { store: null, iwill: null };
test.beforeAll(async () => {
  ids.store = await projectIdByName(PROJECT);
  ids.iwill = await projectIdByName('iwilltillimwell');
});
test.afterAll(closeDemoData);

/** Signs in as the PM with every AI request stubbed, sets the motion setting and opens a board. */
async function openBoard(signInAs, { reduce = false, path = `/projects/${ids.store}` } = {}) {
  const page = await signInAs(PEOPLE.pm);
  await stubAi(page);
  if (reduce) await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, path);
  return page;
}

const column = (page, name) => page.getByRole('region', { name, exact: true });
const card = (page, title) =>
  page.locator('li[id^="board-card-"]').filter({
    has: page.getByRole('button', { name: title, exact: true }),
  });
const titleOf = (page, title) =>
  card(page, title).getByRole('button', { name: title, exact: true });
const preview = (page) => page.locator('[data-drag-preview]');
const live = (page) => page.locator('#move-live');
/** The titles of a column's open cards, in order. */
const openTitles = (page, name) =>
  column(page, name).locator('ul[data-cards] [data-card-title]').allInnerTexts();

/** Records the body of every task PATCH from now on. */
function watchMoves(page) {
  const moves = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && /\/api\/project-tasks\/\d+$/.test(request.url())) {
      moves.push(request.postDataJSON());
    }
  });
  return moves;
}

const movePatched = (page, phase) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /\/api\/project-tasks\/\d+$/.test(response.url()) &&
      response.request().postDataJSON()?.phase === phase,
  );

/** Takes a move back with the toast's Undo and waits for it to be saved. */
async function undoMove(page, text, phase) {
  const back = movePatched(page, phase);
  await toasts(page)
    .getByRole('status')
    .filter({ hasText: text })
    .getByRole('button', { name: 'Undo' })
    .click();
  expect((await back).status()).toBe(200);
}

/** Animations inside the band, the toolbar and the board right now (no waiting): none on load. */
const animationsNow = (page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) =>
        animation.effect?.target?.closest?.(
          '[aria-label="Progress and phases"], [aria-label="Tasks"]',
        ),
      )
      .map((animation) => animation.animationName ?? animation.transitionProperty ?? 'animation'),
  );

/** Running animations that move something (a transform), from the Web Animations list. */
const movingNow = (page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === 'running')
      .filter((animation) =>
        animation.transitionProperty
          ? /transform|translate|scale/.test(animation.transitionProperty)
          : (animation.effect?.getKeyframes() ?? []).some((frame) =>
              // A keyframe moves when its transform has a number other than 0 or 1 (an identity
              // matrix, translate(0px) and scale(1) don't move).
              (
                String(frame.transform ?? frame.translate ?? frame.scale ?? '').match(
                  /-?\d*\.?\d+/g,
                ) ?? []
              ).some((number) => Number(number) !== 0 && Number(number) !== 1),
            ),
      )
      .map((animation) => animation.animationName ?? animation.transitionProperty ?? 'animation'),
  );

test('a pointer drag lands at the sorted place with one PATCH, and Undo takes it back', async ({
  signInAs,
}) => {
  const page = await openBoard(signInAs);
  const moves = watchMoves(page);
  expect(await openTitles(page, 'Testing')).toEqual(['Acme testing round', INTO, 'Test on phones']);
  const moved = movePatched(page, 'testing');
  await pointerDrag(page, titleOf(page, DRAGGED), column(page, 'Testing'));
  expect((await moved).status()).toBe(200);
  await expect(toasts(page).getByText('Moved to Testing.')).toBeVisible();
  // P1, then P2 by due date: it goes after "Write the test plan" (30 Nov), before 8 Dec.
  expect(await openTitles(page, 'Testing')).toEqual([
    'Acme testing round',
    INTO,
    DRAGGED,
    'Test on phones',
  ]);
  await expect(titleOf(page, DRAGGED)).toBeFocused();
  await expect(preview(page)).toHaveCount(0);
  await expect(page.locator('[data-outline]')).toHaveCount(0);
  expect(moves).toEqual([{ phase: 'testing' }]);

  await undoMove(page, 'Moved to Testing.', 'development');
  await expect(
    column(page, 'Development').getByRole('button', { name: DRAGGED, exact: true }),
  ).toHaveCount(1);
  expect(moves).toHaveLength(2);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('a card held by its title and let go over the column’s "+ Add task" lands in the gap', async ({
  signInAs,
}) => {
  const page = await openBoard(signInAs);
  const moves = watchMoves(page);
  const testing = column(page, 'Testing');
  const foot = testing.getByRole('button', { name: 'Add task to Testing' });
  await foot.scrollIntoViewIfNeeded();
  await titleOf(page, TALL).scrollIntoViewIfNeeded();
  const low = await pointOf(page, foot);
  await pointerDrag(page, titleOf(page, TALL), low, { release: false });
  await expect(testing).toHaveAttribute('data-drop', 'on');
  const heights = await page.evaluate(() => {
    const card = document.querySelector('[data-drag-preview]').getBoundingClientRect();
    const column = document.querySelector('[data-column="testing"]').getBoundingClientRect();
    return { centre: card.top + card.height / 2, bottom: column.bottom };
  });
  expect(heights.centre, 'its centre is below the column').toBeGreaterThan(heights.bottom);
  const moved = movePatched(page, 'testing');
  await page.mouse.up();
  expect((await moved).status()).toBe(200);
  await expect(toasts(page).getByText('Moved to Testing.')).toBeVisible();
  // P1, due first: at its sorted place, not where it was let go.
  expect(await openTitles(page, 'Testing')).toEqual([
    TALL,
    'Acme testing round',
    INTO,
    'Test on phones',
  ]);
  await expect(preview(page)).toHaveCount(0);
  await undoMove(page, 'Moved to Testing.', 'development');
  expect(moves).toEqual([{ phase: 'testing' }, { phase: 'development' }]);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('a click or a 4 px wobble opens the task; a drag, Escape and a wrong drop do not', async ({
  signInAs,
}) => {
  const page = await openBoard(signInAs);
  const moves = watchMoves(page);
  const window = page.getByRole('dialog', { name: DRAGGED });
  const title = titleOf(page, DRAGGED);

  for (const wobble of [0, 4]) {
    await title.scrollIntoViewIfNeeded();
    const at = await pointOf(page, title);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    if (wobble) await page.mouse.move(at.x + wobble, at.y);
    await page.mouse.up();
    await expect(window, `a press that moved ${wobble} px opens the task`).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(window).toHaveCount(0);
  }

  await test.step('Escape mid-drag: back, no request, no preview, no window', async () => {
    const at = await pointerDrag(page, title, column(page, 'Testing'), { release: false });
    await expect(preview(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    // Back over the card it came from, and released there: still no window.
    const home = await pointOf(page, title);
    await page.mouse.move(home.x, home.y, { steps: 6 });
    await page.mouse.up();
    await expect(preview(page)).toHaveCount(0);
    expect(at.x).toBeGreaterThan(home.x);
  });

  for (const [where, target] of [
    ['its own column', column(page, 'Development')],
    ['the Done phases rail', page.getByRole('region', { name: 'Done phases' })],
    ['the sidebar, outside the board', page.getByRole('navigation', { name: 'Main' })],
  ]) {
    await test.step(`a release over ${where} goes back`, async () => {
      await pointerDrag(page, title, target);
      await expect(preview(page)).toHaveCount(0);
      await expect(
        column(page, 'Development').getByRole('button', { name: DRAGGED, exact: true }),
      ).toBeVisible();
    });
  }
  await page.waitForTimeout(500);
  expect(moves, 'nothing was sent').toEqual([]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('the keyboard move speaks, keeps the focus on the grip, and Escape or Tab cancel', async ({
  signInAs,
}) => {
  const page = await openBoard(signInAs);
  const moves = watchMoves(page);
  const grip = () => card(page, DRAGGED).getByRole('button', { name: `Move ${DRAGGED}` });

  await grip().focus();
  await page.keyboard.press('Space');
  await expect(live(page)).toHaveText(
    `Picked up ${DRAGGED}, in Development. Use the Left and Right arrow keys to choose a phase, Space to drop, Escape to cancel.`,
  );
  await page.keyboard.press('ArrowRight');
  await expect(live(page)).toHaveText('Over Testing. It goes in at 3 of 4.');
  await page.keyboard.press('ArrowUp');
  await expect(live(page)).toHaveText('Cards are sorted by priority, so it goes in its place.');
  await expect(grip()).toBeFocused();
  const moved = movePatched(page, 'testing');
  await page.keyboard.press('Space');
  expect((await moved).status()).toBe(200);
  await expect(live(page)).toHaveText(`Moved ${DRAGGED} to Testing from Development.`);
  await expect(
    column(page, 'Testing').getByRole('button', { name: `Move ${DRAGGED}` }),
  ).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await undoMove(page, 'Moved to Testing.', 'development');

  for (const key of ['Escape', 'Tab']) {
    await test.step(`${key} cancels`, async () => {
      await grip().focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowRight');
      await expect(live(page)).toHaveText(/^Over Testing\./);
      await page.keyboard.press(key);
      await expect(live(page)).toHaveText(`Move cancelled. ${DRAGGED} is back in Development.`);
      await expect(preview(page)).toHaveCount(0);
    });
  }

  await test.step('a click in the search field cancels and drops nothing', async () => {
    await grip().focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    const search = page.getByRole('searchbox', { name: 'Search tasks or #number' });
    await search.click();
    await page.keyboard.press('Space');
    await expect(live(page)).toHaveText(`Move cancelled. ${DRAGGED} is back in Development.`);
    await expect(search).toHaveValue(' ');
    await expect(preview(page)).toHaveCount(0);
  });

  await test.step("the grip's click opens Move to phase… for its card", async () => {
    await grip().click();
    const dialog = page.getByRole('dialog', { name: `Move ${DRAGGED}` });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
  expect(moves).toEqual([{ phase: 'testing' }, { phase: 'development' }]);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('the lift tilts the card; a page scroll mid-drag still drops on Testing', async ({
  signInAs,
}) => {
  const page = await openBoard(signInAs);
  const title = titleOf(page, DRAGGED);
  await title.scrollIntoViewIfNeeded();
  const at = await pointOf(page, title);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 8, at.y);
  // Two frames after the lift the preview's card transitions in (scale and tilt).
  await page.waitForFunction(
    () => {
      const inner = document.querySelector('[data-drag-preview] > *');
      return (inner?.getAnimations() ?? []).some(
        (animation) =>
          animation.playState === 'running' && /transform/.test(animation.transitionProperty),
      );
    },
    null,
    { polling: 'raf', timeout: 2000 },
  );

  const testing = await pointOf(page, column(page, 'Testing'));
  await page.mouse.move(testing.x, testing.y, { steps: 12 });
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  const after = await pointOf(page, column(page, 'Testing'));
  await page.mouse.move(after.x, after.y, { steps: 3 });
  const moved = movePatched(page, 'testing');
  await page.mouse.up();
  expect((await moved).status()).toBe(200);
  await expect(
    column(page, 'Testing').getByRole('button', { name: DRAGGED, exact: true }),
  ).toHaveCount(1);
  await undoMove(page, 'Moved to Testing.', 'development');
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('over a column with done cards the fold moves down with the room', async ({ signInAs }) => {
  const page = await openBoard(signInAs);
  const development = column(page, 'Development');
  await expect(development.getByRole('button', { name: '6 done' })).toBeVisible();
  await pointerDrag(page, titleOf(page, INTO), development, { release: false });
  await expect(development.locator('ul[data-cards]')).toHaveAttribute('data-room', /.*/);
  const sizes = await development.evaluate(async (element) => {
    await new Promise((done) => setTimeout(done, 400)); // the room's slide
    const cards = [...element.querySelectorAll('ul[data-cards] > li')];
    const shifted = cards.filter((li) => getComputedStyle(li).transform !== 'none');
    const fold = element.querySelector('[data-follow]');
    const body = element.querySelector('[data-column-body]');
    const view = element.closest('[aria-label="Tasks"]');
    return {
      shifted: shifted.length,
      lastBottom: Math.max(...shifted.map((li) => li.getBoundingClientRect().bottom)),
      foldTop: fold.getBoundingClientRect().top,
      fill: view.hasAttribute('data-fill'),
      scrolls: body.scrollHeight > body.clientHeight,
    };
  });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(sizes.shifted).toBeGreaterThan(0);
  expect(sizes.foldTop).toBeGreaterThanOrEqual(sizes.lastBottom - 0.5);
  if (!sizes.fill) expect(sizes.scrolls, 'no scrollbar on the body').toBe(false);
  await expect(preview(page)).toHaveCount(0);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('on a short board the columns reach into the room, and a card let go there lands', async ({
  signInAs,
}) => {
  const page = await openBoard(signInAs, { path: `/projects/${ids.iwill}` });
  await page.setViewportSize({ width: 1440, height: 1400 });
  const moves = watchMoves(page);
  const development = column(page, 'Development'); // the tallest one
  await pointerDrag(page, titleOf(page, SHORT), development, { release: false });
  await expect(development).toHaveAttribute('data-drop', 'on');
  const sizes = await development.evaluate(async (element) => {
    await new Promise((done) => setTimeout(done, 400)); // the room's slide
    const bottomOf = (node) => node.getBoundingClientRect().bottom;
    const columns = [...document.querySelectorAll('[data-column]')].filter((node) => !node.hidden);
    return {
      fill: element.closest('[aria-label="Tasks"]').hasAttribute('data-fill'),
      bottom: bottomOf(element),
      bottoms: columns.map((node) => Math.round(bottomOf(node))),
      lowest: Math.max(...[...element.querySelectorAll('[data-follow]')].map(bottomOf)),
    };
  });
  expect(sizes.fill).toBe(false);
  expect(sizes.lowest, 'the fold and "+ Add task" stay on it').toBeLessThanOrEqual(sizes.bottom);
  expect(new Set(sizes.bottoms).size, 'every column reaches as low').toBe(1);

  const at = await pointOf(page, development);
  await page.mouse.move(at.x, sizes.bottom - 12, { steps: 4 });
  await expect(development).toHaveAttribute('data-drop', 'on');
  const moved = movePatched(page, 'development');
  await page.mouse.up();
  expect((await moved).status()).toBe(200);
  await undoMove(page, 'Moved to Development.', 'testing');
  expect(moves).toEqual([{ phase: 'development' }, { phase: 'testing' }]);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('reduced motion: no tilt, no slide, the card already in place, windows only fade', async ({
  signInAs,
}) => {
  const page = await openBoard(signInAs, { reduce: true });
  expect(await animationsNow(page), 'nothing animates on load').toEqual([]);
  await pointerDrag(page, titleOf(page, DRAGGED), column(page, 'Testing'), { release: false });
  await page.waitForTimeout(100);
  const tilt = await page
    .locator('[data-drag-preview] > *')
    .evaluate((element) => getComputedStyle(element).transform);
  expect(tilt).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  const moved = movePatched(page, 'testing');
  await page.mouse.up();
  await expect(
    column(page, 'Testing').getByRole('button', { name: DRAGGED, exact: true }),
  ).toHaveCount(1);
  expect(await movingNow(page), 'nothing slides after the drop').toEqual([]);
  expect((await moved).status()).toBe(200);
  await undoMove(page, 'Moved to Testing.', 'development');

  await test.step('a window fades in without moving', async () => {
    await titleOf(page, OTHER).click();
    const samples = [];
    for (let i = 0; i < 8; i += 1) {
      samples.push(
        await page.evaluate(() => {
          const panel = document.querySelector('[role="dialog"]');
          return panel ? getComputedStyle(panel).transform : 'none';
        }),
      );
      await page.waitForTimeout(25);
    }
    for (const value of samples) expect(value).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    await expect(page.getByRole('dialog', { name: OTHER })).toBeVisible();
    await page.keyboard.press('Escape');
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('nothing animates on load or on a server refresh', async ({ signInAs }) => {
  const page = await openBoard(signInAs);
  expect(await animationsNow(page), 'on load').toEqual([]);
  await page.evaluate(() => window.next.router.refresh());
  await page.waitForLoadState('networkidle');
  expect(await animationsNow(page), 'after a refresh').toEqual([]);
  expect(await runningAnimations(page, '[aria-label="Tasks"]')).toEqual([]);
});

test('closing a window and clicking a card at once opens that card', async ({ signInAs }) => {
  const page = await openBoard(signInAs);
  // Both cards (neighbours) in view first, so opening the one doesn't scroll the other away.
  await titleOf(page, OTHER).scrollIntoViewIfNeeded();
  await titleOf(page, DRAGGED).scrollIntoViewIfNeeded();
  const other = await pointOf(page, titleOf(page, OTHER));
  await titleOf(page, DRAGGED).click();
  await expect(page.getByRole('dialog', { name: DRAGGED })).toBeVisible();
  // The click lands while the window is still fading out (its exit takes 160 ms).
  await page.keyboard.press('Escape');
  await page.mouse.click(other.x, other.y);
  await expect(page.getByRole('dialog', { name: OTHER })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a tick waits in the open list, then goes under the fold', async ({ signInAs, baseURL }) => {
  const page = await openBoard(signInAs);
  const development = column(page, 'Development');
  // The band's progress (CONTRACT 28, Moments): the current part's fill grows and the percent's
  // aria-hidden copy counts up, once, after the viewer's own tick.
  await page.evaluate(() => {
    const started = (window.bandStarts = []);
    const animate = Element.prototype.animate;
    Element.prototype.animate = function record(frames, options) {
      if (options?.id === 'band-fill') {
        started.push({ part: this.dataset.fill, from: frames[0].transform, ms: options.duration });
      }
      return animate.call(this, frames, options);
    };
  });
  expect(await page.evaluate(() => window.bandStarts)).toEqual([]);
  const done = page.waitForResponse(
    (response) => response.url().endsWith('/status') && response.request().method() === 'POST',
  );
  await card(page, OTHER)
    .getByRole('checkbox', { name: `Done: ${OTHER}` })
    .click();
  const at300 = await page.evaluate(async (title) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const li = [
      ...document.querySelectorAll('[aria-label="Development"] ul[data-cards] > li'),
    ].find((item) => item.textContent.includes(title));
    return {
      inOpenList: Boolean(li),
      ticking: li?.hasAttribute('data-ticking') ?? false,
      checked: li?.querySelector('input[type="checkbox"]')?.checked ?? false,
    };
  }, OTHER);
  const taskId = (await done).url().match(/project-tasks\/(\d+)/)[1];
  try {
    expect(at300, 'at 300 ms it waits in the open list, ticked').toEqual({
      inOpenList: true,
      ticking: true,
      checked: true,
    });
    const ticked = development.locator('ul[data-cards] > li').filter({ hasText: OTHER });
    await page.waitForTimeout(1200);
    await expect(ticked).toHaveCount(0);
    await expect(development.getByRole('button', { name: '7 done' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.bandStarts.length)).toBe(1);
    const [grew] = await page.evaluate(() => window.bandStarts);
    expect(grew).toMatchObject({ part: 'development', ms: 500 });
    expect(grew.from).toMatch(/^scaleX\(0\.\d+\)$/);
    const pct = page.locator('[data-pct]');
    await expect(pct).toHaveText(await page.locator('[data-pct-final]').innerText());
  } finally {
    const back = await write(page, baseURL, 'post', `/api/project-tasks/${taskId}/status`, {
      status: 'open',
    });
    expect(back.status()).toBe(200);
  }
});

test('files dropped from the computer still attach to a card', async ({ signInAs, baseURL }) => {
  const page = await openBoard(signInAs);
  const target = card(page, INTO);
  const attached = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/files$/.test(response.url()),
    { timeout: 60_000 },
  );
  await dropFiles(page, target, [fileFixture('notes.txt')]);
  const response = await attached;
  expect(response.status()).toBe(201);
  await expect(toasts(page).getByText(`1 file added to ${INTO}.`)).toBeVisible();
  await expect(target.getByText('notes.txt', { exact: true })).toBeVisible();
  const [file] = (await response.json()).data.files;
  expect((await write(page, baseURL, 'delete', `/api/project-files/${file.id}`)).status()).toBe(
    200,
  );
});

test('touch never lifts a card; the board scrolls under the finger', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1024, height: 900 },
    hasTouch: true,
  });
  await signIn(context, PEOPLE.pm.email, baseURL);
  const page = await context.newPage();
  await stubAi(page);
  await open(page, `/projects/${ids.store}`);
  const board = page.locator('#project-board');
  const number = card(page, OTHER).getByText(/^#\d+$/);
  await number.scrollIntoViewIfNeeded();
  const start = await pointOf(page, number);
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  let lifted = false;
  await touch('touchStart', start.x, start.y);
  for (let step = 1; step <= 5; step += 1) {
    await touch('touchMove', start.x - step * 60, start.y);
    lifted ||= (await preview(page).count()) > 0;
  }
  await touch('touchEnd', 0, 0);
  expect(lifted, 'no preview under a finger').toBe(false);
  await expect.poll(() => board.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await context.close();
});

test('at 1280 px the board scrolls itself near its right edge during a drag', async ({
  signInAs,
}) => {
  const page = await signInAs(PEOPLE.pm);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubAi(page);
  await open(page, `/projects/${ids.store}`);
  const moves = watchMoves(page);
  const board = page.locator('#project-board');
  expect(await board.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const box = await board.boundingBox();
  const edge = { x: box.x + box.width - 20, y: box.y + Math.min(box.height, 600) / 2 };
  await pointerDrag(page, titleOf(page, DRAGGED), edge, { release: false });
  await page.waitForTimeout(1200);
  const left = await board.evaluate((element) => element.scrollLeft);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(left).toBeGreaterThan(0);
  await expect(preview(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(moves).toEqual([]);
});

test('Move to Testing: the ring and "Current" move, and Go back puts them back', async ({
  signInAs,
}) => {
  const page = await openBoard(signInAs, { path: `/projects/${ids.iwill}` });
  const band = page.getByRole('region', { name: 'Progress and phases' });
  const part = (text) =>
    band
      .getByRole('list', { name: 'Phases' })
      .getByRole('button', { name: new RegExp(`^${text}`) });
  /** The ring's left edge against a phase part's. */
  const ringOn = async (name) => {
    const ring = await band.locator('[data-ring]').boundingBox();
    const target = await part(`${name},`).boundingBox();
    return Math.abs(ring.x - target.x) < 4;
  };
  await expect.poll(() => ringOn('Development')).toBe(true);

  await band.getByRole('button', { name: 'Move to Testing' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move to Testing?' });
  await expect(dialog).toContainText(/\d+ open tasks? stays? in Development\./);
  await dialog.getByRole('button', { name: 'Move to Testing' }).click();
  await expect(toasts(page).getByText('Phase changed to Testing.')).toBeVisible();
  await expect(part('Testing, current phase')).toBeVisible();
  await expect.poll(() => ringOn('Testing')).toBe(true);
  await expect(column(page, 'Testing')).toContainText('Current');
  await expect(column(page, 'Development')).not.toContainText('Current');

  await band.getByRole('button', { name: 'More phase actions' }).click();
  await page.getByRole('menuitem', { name: 'Go back to Development' }).click();
  const back = page.getByRole('dialog', { name: 'Go back to Development?' });
  await back.getByRole('button', { name: 'Go back' }).click();
  await expect(part('Development, current phase')).toBeVisible();
  await expect.poll(() => ringOn('Development')).toBe(true);
  await expect(column(page, 'Development')).toContainText('Current');
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});
