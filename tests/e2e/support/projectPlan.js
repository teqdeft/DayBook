// Shared steps for project-plan.spec.js (CONTRACT 22 and 27): every AI request answered in the
// browser, a file's text as the Files tab saves it for the AI summary, and the AI switches in
// Settings. Picking files and the file fixtures are in support/files.js.

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
 * Waits until the browser saves a file's text for the AI summary (the Files tab reads a PDF, Word
 * or text file after its upload, or on "Read text for AI") and returns the stored text, through
 * the API as the signed-in person. Start waiting before the upload.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ id: number, kind: string, title: string, body: string, fileId: number,
 *   visibility: string, pages: number | null, pagesTotal: number | null }>}
 */
export async function savedText(page) {
  const saved = await page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/projects\/\d+\/documents$/.test(new URL(response.url()).pathname),
    { timeout: 60_000 },
  );
  if (saved.status() !== 201) throw new Error(`Saving the text: ${saved.status()}`);
  const { id } = (await saved.json()).data;
  const response = await page.request.get(`/api/project-documents/${id}`);
  if (!response.ok()) throw new Error(`GET document ${id}: ${response.status()}`);
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
