// CONTRACT 28 (Daybook 1.13), Performance limits: the opt-in perf spec (only with PERF=1, the
// `perf` project in playwright.config.js; Chromium). acme-store gets 150 open cards over four
// phases (support/demoData.js addTasks; removed again after), the CPU runs 4× slower, and:
// - a 2 s pointer drag over three columns keeps the frames at 60 fps (p95 ≤ 20 ms) with no long
//   task over 50 ms except the drop commit (the frames of the drag only, not of the refresh after
//   the drop), and the board stays on a handful of layers: the sticky sidebar paints over the page,
//   so it doesn't put every card title on a layer of its own;
// - a bulk action on 100 rows of the Table has no long task over 50 ms;
// - with 151 open cards a menu move plays only the flash (no FLIP past 150 cards).
//
// The numbers are measured on the e2e server, which is `next dev`; a production build is faster.
// Every /api/ai/** request is answered in the browser (support/projectPlan.js).
import { pointOf } from './support/board.js';
import { addTasks, closeDemoData, projectIdByName, removeTasks } from './support/demoData.js';
import { PEOPLE, expect, open, test, toasts } from './support/fixtures.js';
import { stubAi } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const PREFIX = 'Perf card';
const PHASES = ['development', 'testing', 'launch', 'support'];

let projectId;
test.beforeAll(async () => {
  projectId = await projectIdByName('acme-store');
  // The demo has 10 open cards on acme-store: 140 more make 150.
  await addTasks(projectId, 140, { prefix: PREFIX, phases: PHASES });
});
test.afterAll(async () => {
  await removeTasks(projectId, PREFIX);
  await closeDemoData();
});

/** Opens the board as the PM with the CPU 4× slower; returns the page. */
async function slowBoard(signInAs, path) {
  const page = await signInAs(PEOPLE.pm);
  await stubAi(page);
  await open(page, path);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return page;
}

/** Starts recording frame times and long tasks in the page. */
const startRecording = (page) =>
  page.evaluate(() => {
    const record = { frames: [], longTasks: [], mark: null, running: true };
    window.__perf = record;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        record.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: false });
    let last = performance.now();
    const frame = (now) => {
      record.frames.push({ at: now, ms: now - last });
      last = now;
      if (record.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

/** How many layers the page is drawn on now (LayerTree of the DevTools protocol). */
async function layerCount(page) {
  const cdp = await page.context().newCDPSession(page);
  let layers = [];
  cdp.on('LayerTree.layerTreeDidChange', (event) => {
    if (event.layers) layers = event.layers;
  });
  await cdp.send('LayerTree.enable');
  await page.evaluate(() => (document.body.style.outlineWidth = '1px')); // one new frame
  await expect.poll(() => layers.length).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  await cdp.detach();
  return layers.length;
}

/** Stops recording; returns the frames before the mark and the long tasks before and after it. */
const stopRecording = (page) =>
  page.evaluate(() => {
    const record = window.__perf;
    record.running = false;
    const late = (task) => record.mark !== null && task.start >= record.mark;
    const frames = record.frames
      .filter(({ at }) => record.mark === null || at <= record.mark)
      .map(({ ms }) => ms)
      .sort((a, b) => a - b);
    const part = (share) => Math.round((frames[Math.floor(frames.length * share)] ?? 0) * 10) / 10;
    return {
      frames: frames.length,
      p50: part(0.5),
      p95: part(0.95),
      before: record.longTasks
        .filter((task) => !late(task))
        .map((task) => Math.round(task.duration)),
      after: record.longTasks.filter(late).map((task) => Math.round(task.duration)),
    };
  });

test('a 2 s drag over three columns keeps 60 fps on 150 cards', async ({ signInAs }) => {
  test.setTimeout(300_000);
  const page = await slowBoard(signInAs, `/projects/${projectId}?view=board`);
  await expect(page.locator('li[id^="board-card-"][data-open]')).toHaveCount(150);
  expect(await layerCount(page), 'layers of a board of 150 cards').toBeLessThanOrEqual(30);
  const title = page
    .getByRole('region', { name: 'Development', exact: true })
    .getByRole('button', { name: `${PREFIX} 1`, exact: true });
  await title.scrollIntoViewIfNeeded();
  const start = await pointOf(page, title);
  const columns = [];
  for (const name of ['Testing', 'Launch', 'Support']) {
    columns.push(await pointOf(page, page.getByRole('region', { name, exact: true })));
  }

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y);
  await expect(page.locator('[data-drag-preview]')).toHaveCount(1);
  await startRecording(page);
  const began = Date.now();
  let from = start;
  for (const to of columns) {
    for (let step = 1; step <= 20; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / 20;
      const y = from.y + ((to.y - from.y) * step) / 20;
      await page.mouse.move(x, y);
      await page.waitForTimeout(
        Math.max(0, (2000 / 60) * (columns.indexOf(to) * 20 + step) - (Date.now() - began)),
      );
    }
    from = to;
  }
  await page.evaluate(() => (window.__perf.mark = performance.now()));
  const moved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && /project-tasks\/\d+$/.test(response.url()),
    { timeout: 120_000 },
  );
  await page.mouse.up();
  const answer = await moved;
  await page.waitForTimeout(1000);
  const result = await stopRecording(page);
  console.log(`[perf] drag: ${JSON.stringify(result)}`);
  expect(answer.request().postDataJSON()).toEqual({ phase: 'support' });
  await expect(toasts(page).getByText('Moved to Support.')).toBeVisible();
  expect(result.p95, 'p95 frame during the drag').toBeLessThanOrEqual(20);
  expect(result.before, 'long tasks during the drag').toEqual([]);
  expect(result.after.length, 'only the drop commit may be long').toBeLessThanOrEqual(1);
});

test('a bulk action on 100 rows has no long task over 50 ms', async ({ signInAs }) => {
  test.setTimeout(300_000);
  const page = await slowBoard(signInAs, `/projects/${projectId}?view=table`);
  const table = page.getByRole('table', { name: 'Tasks of acme-store' });
  await page.getByRole('searchbox', { name: 'Search tasks or #number' }).fill(PREFIX);
  await table.getByRole('checkbox', { name: 'Select all shown tasks' }).check();
  await expect(toasts(page).getByText('You can pick up to 100 tasks at a time.')).toBeVisible();
  const bar = page.getByRole('region', { name: 'Selected tasks' });
  await expect(bar).toContainText('100 selected');

  await startRecording(page);
  const sent = page.waitForResponse((response) => response.url().endsWith('/tasks/bulk'), {
    timeout: 120_000,
  });
  await bar.getByRole('button', { name: 'Assign to me' }).click();
  expect((await sent).status()).toBe(200);
  await expect(toasts(page).getByText('100 tasks are now yours.')).toBeVisible();
  await page.waitForTimeout(1500);
  const result = await stopRecording(page);
  console.log(`[perf] bulk: ${JSON.stringify(result)}`);
  expect(result.before, 'long tasks during the bulk action').toEqual([]);
});

test('with 151 open cards a menu move plays only the flash', async ({ signInAs }) => {
  test.setTimeout(300_000);
  await addTasks(projectId, 1, { prefix: `${PREFIX} extra`, phases: ['development'] });
  const page = await signInAs(PEOPLE.pm);
  await stubAi(page);
  await open(page, `/projects/${projectId}?view=board`);
  await expect(page.locator('li[id^="board-card-"][data-open]')).toHaveCount(151);
  const moved = `${PREFIX} extra 1`;
  await page.getByRole('button', { name: `More for ${moved}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to phase…' }).click();
  await page
    .getByRole('dialog', { name: `Move ${moved}` })
    .getByRole('button', { name: /^Testing/ })
    .click();
  const seen = await page.evaluate(async () => {
    const kinds = new Set();
    const until = performance.now() + 800;
    while (performance.now() < until) {
      for (const animation of document.getAnimations()) {
        const frames = animation.effect?.getKeyframes() ?? [];
        const moves = animation.transitionProperty
          ? /transform|translate/.test(animation.transitionProperty)
          : frames.some((frame) => frame.transform && frame.transform !== 'none');
        if (animation.effect?.target?.closest?.('#project-board')) {
          kinds.add(moves ? 'moves' : 'other');
        }
      }
      await new Promise((done) => requestAnimationFrame(done));
    }
    return [...kinds];
  });
  await expect(toasts(page).getByText('Moved to Testing.')).toBeVisible();
  expect(seen, 'no card slides; the flash plays').toEqual(['other']);
});
