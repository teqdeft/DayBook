// Shared pieces for the end-to-end specs: sign in as a demo person (each in their own browser
// context, through the development sign-in route), open a page and wait until React has hydrated
// it, collect console and page errors, and format dates the way the app shows them.
import { test as base, expect } from '@playwright/test';

export { expect };

/** Demo people (`npm run seed:demo`). */
export const PEOPLE = {
  vishal: { email: 'vishal@company.com', name: 'Vishal Saini' }, // employee, reports to the PM
  karan: { email: 'karan@company.com', name: 'Karan Mehta' }, // employee, not checked in today
  deepak: { email: 'deepak@company.com', name: 'Deepak Joshi' }, // employee, missing check-out
  pm: { email: 'pm@company.com', name: '[PM name]' }, // project manager
  neha: { email: 'neha@company.com', name: 'Neha Gupta' }, // HR
  ceo: { email: 'ceo@company.com', name: '[CEO name]' }, // Admin
};

/**
 * Signs a browser context in. The route checks the Origin header like every other POST.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} email
 * @param {string} baseURL
 */
export async function signIn(context, email, baseURL) {
  const response = await context.request.post('/api/auth/dev-login', {
    data: { email },
    headers: { Origin: new URL(baseURL).origin },
  });
  if (!response.ok()) {
    throw new Error(`Sign-in as ${email} failed: ${response.status()} ${await response.text()}`);
  }
}

const problemsByPage = new WeakMap();

/**
 * Starts collecting console errors and uncaught page errors on a page.
 * @param {import('@playwright/test').Page} page
 */
function collectProblems(page) {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  problemsByPage.set(page, problems);
}

/**
 * Console errors and page errors seen on a page opened with `signInAs`, so far.
 * @param {import('@playwright/test').Page} page
 * @returns {string[]}
 */
export function problemsOf(page) {
  return problemsByPage.get(page) ?? [];
}

/**
 * Opens a path and waits until React has hydrated the document (it marks the root it listens
 * on), so clicks reach the client components instead of the server-rendered HTML.
 * @param {import('@playwright/test').Page} page
 * @param {string} path
 */
export async function open(page, path) {
  const response = await page.goto(path);
  await page.waitForFunction(() =>
    Object.keys(document).some((key) => key.startsWith('_reactListening')),
  );
  return response;
}

/** The toast list ("Report submitted", "Edit approved", ...). */
export function toasts(page) {
  return page.getByRole('region', { name: 'Updates' });
}

/**
 * The cell of a table row under the column whose header starts with `header`.
 * @param {import('@playwright/test').Locator} table
 * @param {import('@playwright/test').Locator} row
 * @param {string} header
 */
export async function cellUnder(table, row, header) {
  const headers = await table.getByRole('columnheader').allTextContents();
  const index = headers.findIndex((text) => text.trim().startsWith(header));
  if (index < 0) throw new Error(`No "${header}" column in: ${headers.join(', ')}`);
  return row.getByRole('cell').nth(index);
}

/** The sidebar's links. */
export function sidebarLinks(page) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('link');
}

const parts = (date) => {
  const at = new Date(`${date}T00:00:00Z`);
  const format = (options) => at.toLocaleDateString('en-US', { timeZone: 'UTC', ...options });
  return {
    weekday: format({ weekday: 'short' }),
    day: format({ day: 'numeric' }),
    month: format({ month: 'short' }),
  };
};

/** '2026-09-30' -> 'Wed, 30 Sep' (formatDayShort in the app). */
export function dayShort(date) {
  const { weekday, day, month } = parts(date);
  return `${weekday}, ${day} ${month}`;
}

/** '2026-09-30' -> '30 Sep' (formatDayMonthShort in the app). */
export function dayMonthShort(date) {
  const { day, month } = parts(date);
  return `${day} ${month}`;
}

export const test = base.extend({
  /**
   * `signInAs(person)` -> a page signed in as that person, in a browser context of its own, so
   * one test can switch between people. `problemsOf(page)` has its console and page errors.
   * (Playwright's fixture callback is named `provide` here: ESLint's React hook rule reads a
   * function named `use` as React's `use()`.)
   */
  signInAs: async ({ browser, baseURL, viewport }, provide) => {
    const contexts = [];
    await provide(async (person) => {
      const context = await browser.newContext({ baseURL, viewport });
      contexts.push(context);
      await signIn(context, person.email, baseURL);
      const page = await context.newPage();
      collectProblems(page);
      return page;
    });
    for (const context of contexts) await context.close();
  },
});
