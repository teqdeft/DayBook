// Shared steps for project-plan.spec.js (CONTRACT 22): every AI request answered in the browser, the
// real file picker, a document's stored text, and the AI switches in Settings.
import { fileURLToPath } from 'node:url';

const FIXTURES = new URL('../../fixtures/', import.meta.url);

/** The path of a file in tests/fixtures, for example 'pdf/two-pages.pdf'. */
export const fixture = (relative) => fileURLToPath(new URL(relative, FIXTURES));

const BUSY = {
  status: 503,
  body: { error: { code: 'AI_BUSY', message: 'AI is busy. Try again in a minute.' } },
};

/**
 * Answers every /api/ai/** request in the browser, so none ever reaches the server, let alone
 * Google. Call it right after signing in, before the first page opens.
 * @param {import('@playwright/test').Page} page
 * @param {(path: string) => ({ status: number, body: object } | null)} [answer] by URL path;
 *   null (the default) answers 503 "AI is busy"
 * @returns {Promise<string[]>} the paths asked so far, in order (the array fills as they come)
 */
export async function stubAi(page, answer = () => null) {
  const asked = [];
  await page.context().route('**/api/ai/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    asked.push(path);
    const { status, body } = answer(path) ?? BUSY;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return asked;
}

/**
 * Picks a file through the real file picker that a button opens.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} button
 * @param {string} file a path on disk
 */
export async function pickFile(page, button, file) {
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles(file);
}

/**
 * A file's or note's stored text, through the API as the signed-in person.
 * @param {import('@playwright/test').Page} page on the Phases tab, with the document's row shown
 * @param {string} title
 * @returns {Promise<{ id: number, kind: string, title: string, body: string,
 *   pages: number | null, pagesTotal: number | null }>}
 */
export async function storedDocument(page, title) {
  const id = await page.getByRole('button', { name: title, exact: true }).getAttribute('id');
  const documentId = Number(/^phases-doc-(\d+)-name$/.exec(id)?.[1]);
  const response = await page.request.get(`/api/project-documents/${documentId}`);
  if (!response.ok()) throw new Error(`GET document ${documentId}: ${response.status()}`);
  return (await response.json()).data;
}

/**
 * Turns "Use AI" and "Project summaries" on or off through Settings' API.
 * @param {import('@playwright/test').Page} page signed in as an Admin
 * @param {string} baseURL
 * @param {boolean} on
 */
export async function setProjectSummaries(page, baseURL, on) {
  const response = await page.request.put('/api/settings', {
    data: { aiEnabled: on, aiProjectSummaryEnabled: on },
    headers: { Origin: new URL(baseURL).origin },
  });
  if (!response.ok()) {
    throw new Error(`Settings: ${response.status()} ${await response.text()}`);
  }
}

/**
 * Sends a write as the signed-in person, with the Origin header every POST, PUT and DELETE needs.
 * @param {import('@playwright/test').Page} page
 * @param {string} baseURL
 * @param {'post'|'put'|'patch'|'delete'} method
 * @param {string} path
 * @param {object} [data]
 * @returns {Promise<import('@playwright/test').APIResponse>}
 */
export function write(page, baseURL, method, path, data) {
  return page.request[method](path, { data, headers: { Origin: new URL(baseURL).origin } });
}
