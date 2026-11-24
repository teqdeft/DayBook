// Shared steps for the file specs (CONTRACT 27): the plain fixtures in tests/fixtures/files, big
// files made at run time (never committed), the real file chooser, files dropped on an element,
// uploads through the API (Start, pieces, Finish) for the steps that only need a file to exist, and
// how a file route answers. The server, the setup's `seed:demo` and the teardown share one files
// folder (FILES_DIR in playwright.config.js); these steps only talk to the server.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = new URL('../../fixtures/', import.meta.url);

/**
 * The path of a fixture: a name in tests/fixtures/files ('logo.png'), or a path under
 * tests/fixtures ('pdf/two-pages.pdf').
 * @param {string} name
 */
export const fileFixture = (name) =>
  fileURLToPath(new URL(name.includes('/') ? name : `files/${name}`, FIXTURES));

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
  html: 'text/html',
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  exe: 'application/x-msdownload',
};

/** The type a browser gives a picked file, by its extension. */
const typeOf = (file) => TYPES[path.extname(file).slice(1).toLowerCase()] ?? '';

/** Big files are made here at run time and removed with removeBigFiles(). */
const BIG_DIR = path.join(os.tmpdir(), 'daybook-e2e-big', String(process.pid));

/**
 * Writes a file of `bytes` bytes (a repeating pattern, so no two pieces look alike) and returns its
 * path.
 * @param {string} name
 * @param {number} bytes
 */
export function bigFile(name, bytes) {
  mkdirSync(BIG_DIR, { recursive: true });
  const data = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) data[i] = (i * 31 + Math.floor(i / 4096)) & 255;
  const file = path.join(BIG_DIR, name);
  writeFileSync(file, data);
  return file;
}

/** Removes the big files of this run (call it in afterAll). */
export function removeBigFiles() {
  rmSync(BIG_DIR, { recursive: true, force: true });
}

/**
 * Picks files through the real file chooser that a control opens ("Choose files").
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} control
 * @param {string[]} files paths on disk
 */
export async function chooseFiles(page, control, files) {
  const chooser = page.waitForEvent('filechooser');
  await control.click();
  await (await chooser).setFiles(files);
}

/**
 * Drops files on an element as a desktop browser does: dragenter, dragover and drop with a
 * DataTransfer holding the files (Playwright's own drag carries no files).
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} target
 * @param {string[]} files paths on disk
 */
export async function dropFiles(page, target, files) {
  const items = files.map((file) => ({
    name: path.basename(file),
    type: typeOf(file),
    data: readFileSync(file).toString('base64'),
  }));
  const dataTransfer = await page.evaluateHandle((list) => {
    const transfer = new DataTransfer();
    for (const item of list) {
      const bytes = Uint8Array.from(atob(item.data), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], item.name, { type: item.type }));
    }
    return transfer;
  }, items);
  for (const type of ['dragenter', 'dragover', 'drop']) {
    await target.dispatchEvent(type, { dataTransfer });
  }
  await dataTransfer.dispose();
}

/**
 * Uploads a file through the upload routes as the signed-in person, the way the browser does:
 * Start, every piece at the size Start gives, then Finish.
 * @param {import('@playwright/test').Page} page
 * @param {string} baseURL
 * @param {{ projectId: number, target: 'project' | 'task', phase?: string | null,
 *   visibility?: 'everyone' | 'managers', taskId?: number | null }} input
 * @param {string} file a path on disk
 * @returns {Promise<{ key: string, file?: object, upload?: object }>} a project file's
 *   ProjectFile, or a task file's held upload
 */
export async function uploadByApi(page, baseURL, input, file) {
  const bytes = readFileSync(file);
  const headers = { Origin: new URL(baseURL).origin };
  const ok = async (response, step) => {
    if (!response.ok()) throw new Error(`${step}: ${response.status()} ${await response.text()}`);
    return (await response.json()).data;
  };
  const start = await ok(
    await page.request.post('/api/uploads', {
      data: { ...input, name: path.basename(file), size: bytes.length },
      headers,
    }),
    'Start',
  );
  for (let offset = 0; offset < bytes.length; offset += start.pieceSize) {
    const piece = bytes.subarray(offset, offset + start.pieceSize);
    await ok(
      await page.request.post(`/api/uploads/${start.key}/pieces?offset=${offset}`, {
        multipart: {
          piece: { name: 'piece', mimeType: 'application/octet-stream', buffer: piece },
        },
        headers,
      }),
      `Piece at ${offset}`,
    );
  }
  const finished = await ok(
    await page.request.post(`/api/uploads/${start.key}/finish`, { headers }),
    'Finish',
  );
  return { key: start.key, ...finished };
}

/**
 * An upload's Status, as the signed-in person.
 * @param {import('@playwright/test').Page} page
 * @param {string} key
 * @returns {Promise<{ key: string, offset: number, size: number, status: string }>}
 */
export async function uploadStatus(page, key) {
  const response = await page.request.get(`/api/uploads/${key}`);
  if (!response.ok()) throw new Error(`Status of ${key}: ${response.status()}`);
  return (await response.json()).data;
}

/**
 * How a file route answers the signed-in person: the status, the headers and the bytes, fetched
 * outside the page (no file is ever opened as a page).
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: Buffer }>}
 */
export async function answerOf(page, url) {
  const response = await page.request.get(url, { maxRedirects: 0 });
  return { status: response.status(), headers: response.headers(), body: await response.body() };
}

/** A file's id from its download link (`/api/project-files/12`). */
export function fileIdOf(href) {
  const id = Number(/\/api\/project-files\/(\d+)/.exec(href ?? '')?.[1]);
  if (!id) throw new Error(`Not a file link: ${href}`);
  return id;
}
