// Helpers for the live bell specs (CONTRACT 26): add a notification while a page is open, run the
// page's live check at once instead of waiting up to 30 s for it, read the sounds the pages would
// have played and find the preview cards. No sound is ever played: `recordChimes` defines Daybook's
// test hook before any page script runs, so the player calls it instead (and needs no click to
// unlock the audio). Every page of the context shares the hook, so a second tab records too.
import { expect } from './fixtures.js';

export { addNotification } from './demoData.js';

/** A batch closes 1.5 s after its first new notification (BATCH_WINDOW_MS), plus a little. */
const BATCH_WAIT_MS = 1600;
/** At most one chime every 10 s per browser (CHIME_MIN_GAP_MS), plus a little. */
const CHIME_GAP_MS = 10_250;
/** Where the hook keeps the time of the last chime: shared by the context's tabs, kept on reload. */
const LAST_CHIME_KEY = 'e2e.lastChimeAt';

/**
 * Records every chime of every page of a context in `window.__daybookChimes` (`{ reason, ids,
 * tone }`, from the page's last load) instead of playing it. Call it before the first page opens.
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function recordChimes(context) {
  await context.addInitScript((key) => {
    window.__daybookChimes = [];
    window.__daybookChime = (info) => {
      window.__daybookChimes.push(info);
      try {
        localStorage.setItem(key, String(Date.now()));
      } catch {
        // waitChimeGap then waits from the start of the page
      }
    };
  }, LAST_CHIME_KEY);
}

/**
 * The chimes a page recorded since it loaded, oldest first.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{ reason: 'batch' | 'test', ids: number[], tone: string }>>}
 */
export function chimes(page) {
  return page.evaluate(() =>
    (window.__daybookChimes ?? []).map(({ reason, ids, tone }) => ({ reason, ids, tone })),
  );
}

/**
 * Waits until 10 s after the last chime any tab of the context recorded, so a step that expects a
 * chime never meets the 10 s gap between two chimes (and one that expects none isn't quiet only
 * because of it).
 * @param {import('@playwright/test').Page} page
 */
export async function waitChimeGap(page) {
  await page.waitForFunction(
    ({ key, gap }) => Date.now() - Number(localStorage.getItem(key) ?? 0) >= gap,
    { key: LAST_CHIME_KEY, gap: CHIME_GAP_MS },
    { polling: 250, timeout: CHIME_GAP_MS + 5000 },
  );
}

/**
 * Runs the page's live check now (`window.__daybookLive.checkNow()`, once the live bell has
 * started) and waits until the batch it found has closed, so its cards and chime are out.
 * @param {import('@playwright/test').Page} page
 */
export async function checkNow(page) {
  await page.waitForFunction(() => typeof window.__daybookLive?.checkNow === 'function');
  await page.evaluate(() => window.__daybookLive.checkNow());
  await page.waitForTimeout(BATCH_WAIT_MS);
}

/** The preview cards' region; it is in the page only while a card shows. */
export function preview(page) {
  return page.getByRole('region', { name: 'New notifications' });
}

/**
 * One preview card, by its title (a summary's is "3 new notifications").
 * @param {import('@playwright/test').Page} page
 * @param {string} title
 */
export function previewCard(page, title) {
  return preview(page).getByRole('article', { name: title, exact: true });
}

/** The top bar's bell button ("Notifications, 3 unread"). */
export function bell(page) {
  return page.getByRole('button', { name: /^Notifications(, \d+ unread)?$/ });
}

/**
 * The person's unread count, from the bell button's name.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
export async function bellUnread(page) {
  const name = await bell(page).getAttribute('aria-label');
  return Number(/, (\d+) unread$/.exec(name ?? '')?.[1] ?? 0);
}

/**
 * Checks the live bell's announcement (its status region; the text is cleared 5 s later).
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
export async function expectAnnounced(page, text) {
  await expect(page.getByRole('status').filter({ hasText: text })).toHaveText(text);
}

/**
 * One of the person's notifications as the API has it now (`?after=` returns read ones too).
 * @param {import('@playwright/test').Page} page
 * @param {number} id
 * @returns {Promise<{ id: number, readAt: string | null, title: string }>}
 */
export async function notificationById(page, id) {
  const response = await page.request.get(`/api/notifications?after=${id - 1}`);
  expect(response.status()).toBe(200);
  const { data } = await response.json();
  const item = data.items.find((row) => row.id === id);
  if (!item) throw new Error(`Notification ${id} is not in the person's list.`);
  return item;
}

/**
 * Console errors and page errors of a page opened outside `signInAs` (a second tab).
 * @param {import('@playwright/test').Page} page
 * @returns {string[]} filled as they happen
 */
export function watchProblems(page) {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  return problems;
}
