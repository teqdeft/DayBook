// CONTRACT 27 (Daybook 1.12): the Files tab. The PM uploads three files at once to Design for
// everyone on the project and one to Whole project for PM and Admins only, and each place counts
// them; Vishal Saini, a member, sees only the Everyone files and their counts. The PM renames a
// file and deletes one with Undo. A 2 MB file made at run time goes up in pieces of the size the
// Start answer gives (64 KB in these runs, read from the answer), its bar rising while the pieces
// are slowed down, while another upload is cancelled (its row goes and the server says
// cancelled). An HTML page and an SVG only ever download (attachment, application/octet-stream,
// no /view) and the PNG has a thumbnail. While a file uploads, a download (its link or the row
// menu) never asks "Leave site?" and the page stays; one that fails (the file was deleted
// meanwhile) asks the guard's question first, and No keeps the upload going. A piece answered 401
// stops the file with Retry in the Uploads card, and Retry brings it in. Cancelling the only
// upload puts focus on Upload files, not on the page.
//
// The spec works on internal-tool, which has no files in the demo, so the counts start at 0 and
// project-plan.spec.js (acme-store) is left as it is. Every /api/ai/** request is answered in the
// browser (support/projectPlan.js); none of these files is read for the AI summary.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { closeDemoData, companyToday, projectIdByName } from './support/demoData.js';
import {
  answerOf,
  bigFile,
  chooseFiles,
  fileFixture,
  fileIdOf,
  removeBigFiles,
  uploadByApi,
  uploadStatus,
} from './support/files.js';
import {
  PEOPLE,
  dayMonthShort,
  expect,
  open,
  problemsOf,
  test,
  toasts,
} from './support/fixtures.js';
import { stubAi } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const PROJECT = 'internal-tool';
const DESIGN_FILES = ['logo.png', 'drawing.svg', 'setup.exe'];
const MANAGERS_FILE = 'page.html';
const BIG = 2 * 1024 * 1024;

let projectId;
/** name -> its download link, from the PM's rows */
const links = {};

test.beforeAll(async () => {
  projectId = await projectIdByName(PROJECT);
});
test.afterAll(async () => {
  removeBigFiles();
  await closeDemoData();
});

/** Signs in with every AI request stubbed, and opens the Files tab at a place. */
async function openFiles(signInAs, person, place = 'all') {
  const page = await signInAs(person);
  await stubAi(page);
  await open(page, `/projects/${projectId}?tab=files&place=${place}`);
  return page;
}

const places = (page) => page.getByRole('navigation', { name: 'Places' });
/** A place link by its name and count: "Design 3", "Development Current 0". */
const placeLink = (page, name, count) =>
  places(page).getByRole('link', { name: new RegExp(`^${name}( Current)? ${count}$`) });
/** The list row of a file or note, found by its name. */
const row = (page, name) =>
  page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name, exact: true }) })
    .or(
      page
        .getByRole('main')
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name, exact: true }) }),
    );

/** Opens Upload files, sets who can see them, picks the files and uploads them. */
async function uploadFiles(page, files, { visibility = 'Everyone on the project' } = {}) {
  // The header's button (an empty tab has a second one in its empty state).
  await page.getByRole('button', { name: 'Upload files' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await expect(dialog.getByRole('radio', { name: /^Everyone on the project/ })).toBeChecked();
  await dialog.getByRole('radio', { name: new RegExp(`^${visibility}`) }).check();
  await chooseFiles(
    page,
    dialog.getByText('Choose files', { exact: true }).filter({ visible: true }),
    files.map((name) => (path.isAbsolute(name) ? name : fileFixture(name))),
  );
  return dialog;
}

test('the PM uploads to Design for everyone and to Whole project for PM and Admins', async ({
  signInAs,
}) => {
  const page = await openFiles(signInAs, PEOPLE.pm);
  await expect(
    page.getByText(
      'No files yet. Upload briefs, designs and contracts so the team has them in one place.',
    ),
  ).toBeVisible();
  await expect(placeLink(page, 'All files', 0)).toHaveAttribute('aria-current', 'page');

  await test.step('three files at once to Design, for everyone on the project', async () => {
    await placeLink(page, 'Design', 0).click();
    await expect(page).toHaveURL(/\?tab=files&place=design$/);
    await expect(page.getByRole('heading', { name: 'Design', level: 2 })).toBeVisible();
    // With nothing in the whole tab, every place shows the whole tab's empty state.
    await expect(page.getByText(/^No files yet\./)).toBeVisible();
    // An empty file is stopped before anything is sent, and its chip can go.
    const dialog = await uploadFiles(page, [...DESIGN_FILES, 'empty.txt']);
    await expect(dialog.getByLabel('Add to')).toHaveValue('design');
    await expect(dialog.getByText('empty.txt is empty.')).toBeVisible();
    const upload = dialog.getByRole('button', { name: 'Upload 3 files' });
    await expect(upload).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove empty.txt' }).click();
    await expect(dialog.getByText('empty.txt is empty.')).toHaveCount(0);
    const starts = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/uploads')) {
        starts.push(request.postDataJSON());
      }
    });
    await upload.click();
    await expect(dialog).toHaveCount(0);
    await expect(toasts(page).getByText('3 files added to Design.')).toBeVisible({
      timeout: 60_000,
    });
    expect(
      starts.map(({ name, phase, visibility, target }) => [name, phase, visibility, target]),
    ).toEqual(DESIGN_FILES.map((name) => [name, 'design', 'everyone', 'project']));
    for (const name of DESIGN_FILES) await expect(row(page, name)).toBeVisible();
  });

  await test.step('one to Whole project, for PM and Admins only', async () => {
    await placeLink(page, 'Whole project', 0).click();
    await expect(page).toHaveURL(/\?tab=files&place=project$/);
    const dialog = await uploadFiles(page, [MANAGERS_FILE], { visibility: 'Only PM and Admins' });
    await expect(dialog.getByLabel('Add to')).toHaveValue('project');
    await dialog.getByRole('button', { name: 'Upload 1 file' }).click();
    await expect(toasts(page).getByText('1 file added to Whole project.')).toBeVisible({
      timeout: 60_000,
    });
    await expect(row(page, MANAGERS_FILE)).toContainText('Only PM and Admins');
  });

  await test.step('each place counts what is in it', async () => {
    await expect(placeLink(page, 'All files', 4)).toBeVisible();
    await expect(placeLink(page, 'Whole project', 1)).toBeVisible();
    await expect(placeLink(page, 'Design', 3)).toBeVisible();
    await expect(placeLink(page, 'Development', 0)).toBeVisible();
    await expect(placeLink(page, 'On tasks', 0)).toBeVisible();
    await placeLink(page, 'All files', 4).click();
    for (const name of [...DESIGN_FILES, MANAGERS_FILE]) {
      links[name] = await page
        .getByRole('link', { name: `Download ${name}`, exact: true })
        .getAttribute('href');
    }
    await expect(row(page, 'setup.exe')).toContainText(
      'Program file. Open it only if you trust where it came from.',
    );
    const today = dayMonthShort(await companyToday());
    await expect(row(page, 'logo.png')).toContainText(
      `Picture · 1 KB · ${PEOPLE.pm.name}, ${today} · Design`,
    );
  });

  await test.step('the PNG shows as a thumbnail and opens in the viewer', async () => {
    const thumb = row(page, 'logo.png').locator('img');
    await expect(thumb).toHaveAttribute('src', /^\/api\/project-files\/\d+\/(thumb|view)$/);
    await expect.poll(() => thumb.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'logo.png', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: 'logo.png' });
    await expect(viewer.getByRole('img')).toHaveAttribute('src', /\/view$/);
    await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'logo.png', exact: true })).toBeFocused();
  });

  await test.step('HTML and SVG only download, and only the PNG is shown', async () => {
    for (const name of [MANAGERS_FILE, 'drawing.svg']) {
      const download = await answerOf(page, links[name]);
      expect(download.status, name).toBe(200);
      expect(download.headers['content-type'], name).toBe('application/octet-stream');
      expect(download.headers['content-disposition'], name).toMatch(/^attachment; filename="/);
      expect(download.headers['content-disposition'], name).toContain(name);
      expect(download.headers['x-content-type-options'], name).toBe('nosniff');
      expect(download.body.equals(readFileSync(fileFixture(name))), name).toBe(true);
      expect((await answerOf(page, `${links[name]}/view`)).status, `${name} /view`).toBe(404);
    }
    const picture = await answerOf(page, `${links['logo.png']}/view`);
    expect(picture.status).toBe(200);
    expect(picture.headers['content-type']).toBe('image/png');
    expect(picture.body.equals(readFileSync(fileFixture('logo.png')))).toBe(true);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('Vishal, on the project, sees only the files for everyone, with their counts', async ({
  signInAs,
}) => {
  const page = await openFiles(signInAs, PEOPLE.vishal);
  const tabs = page.getByRole('navigation', { name: 'Project sections' });
  await expect(tabs.getByRole('link')).toHaveText(['Board', 'Files']);
  await expect(placeLink(page, 'All files', 3)).toBeVisible();
  await expect(placeLink(page, 'Whole project', 0)).toBeVisible();
  await expect(placeLink(page, 'Design', 3)).toBeVisible();
  for (const name of DESIGN_FILES) {
    await expect(page.getByRole('link', { name: `Download ${name}`, exact: true })).toBeVisible();
  }
  await expect(page.getByText(MANAGERS_FILE)).toHaveCount(0);
  for (const name of ['Upload files', 'New note', /^More for /]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await placeLink(page, 'Whole project', 0).click();
  await expect(page.getByText('Nothing in Whole project yet.')).toBeVisible();

  expect((await answerOf(page, links[MANAGERS_FILE])).status).toBe(404);
  const shared = await answerOf(page, links['setup.exe']);
  expect(shared.status).toBe(200);
  expect(shared.headers['content-type']).toBe('application/octet-stream');
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('the PM renames a file and deletes one with Undo', async ({ signInAs }) => {
  const page = await openFiles(signInAs, PEOPLE.pm, 'design');

  await test.step('rename: the extension stays', async () => {
    await page.getByRole('button', { name: 'More for drawing.svg' }).click();
    await page.getByRole('menuitem', { name: 'Edit details' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit details' });
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('drawing');
    await expect(dialog.getByText('.svg', { exact: true })).toBeVisible();
    const patched = page.waitForRequest((request) => request.method() === 'PATCH');
    await dialog.getByRole('textbox', { name: 'Name' }).fill('site-drawing');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    expect((await patched).postDataJSON()).toEqual({ name: 'site-drawing' });
    await expect(toasts(page).getByText('Changes saved.')).toBeVisible();
    await expect(row(page, 'site-drawing.svg')).toBeVisible();
    await expect(row(page, 'drawing.svg')).toHaveCount(0);
  });

  const deletes = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deletes.push(request.url());
  });
  const undo = () =>
    toasts(page).getByRole('status').filter({ hasText: 'File deleted.' }).getByRole('button', {
      name: 'Undo',
    });

  await test.step('delete and Undo: the row comes back and nothing is sent', async () => {
    await page.getByRole('button', { name: 'More for setup.exe' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(row(page, 'setup.exe')).toHaveCount(0);
    await undo().click();
    await expect(row(page, 'setup.exe')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(deletes).toEqual([]);
  });

  await test.step('delete and let the toast end: sent once, gone after a reload', async () => {
    const sent = page.waitForResponse((response) => response.request().method() === 'DELETE', {
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'More for setup.exe' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    expect((await sent).status()).toBe(200);
    expect(deletes).toHaveLength(1);
    await open(page, `/projects/${projectId}?tab=files&place=design`);
    await expect(row(page, 'site-drawing.svg')).toBeVisible();
    await expect(row(page, 'setup.exe')).toHaveCount(0);
    await expect(placeLink(page, 'Design', 2)).toBeVisible();
    expect((await answerOf(page, links['setup.exe'])).status).toBe(404);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('a 2 MB file goes up in pieces with a rising bar while another is cancelled', async ({
  signInAs,
}) => {
  const page = await openFiles(signInAs, PEOPLE.pm, 'design');
  const kept = bigFile('site-video.bin', BIG);
  const stopped = bigFile('old-video.bin', BIG);
  const starts = {};
  const offsets = [];
  page.on('response', async (response) => {
    const request = response.request();
    if (request.method() === 'POST' && response.url().endsWith('/api/uploads')) {
      starts[request.postDataJSON().name] = (await response.json()).data;
    }
  });
  await page.route('**/api/uploads/*/pieces*', async (route) => {
    offsets.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });

  try {
    const dialog = await uploadFiles(page, [kept, stopped]);
    await dialog.getByRole('button', { name: 'Upload 2 files' }).click();
    const card = page.getByRole('region', { name: 'Uploads' });
    await expect(card.getByRole('heading', { name: 'Uploading 2 files' })).toBeVisible();

    await test.step('the other one is cancelled: its row goes, the server says so', async () => {
      await expect.poll(() => starts['old-video.bin']?.key ?? null).not.toBeNull();
      await card.getByRole('button', { name: 'Cancel uploading old-video.bin' }).click();
      await expect(card.getByText('old-video.bin')).toHaveCount(0);
      await expect
        .poll(async () => (await uploadStatus(page, starts['old-video.bin'].key)).status)
        .toBe('cancelled');
    });

    await test.step('the bar rises', async () => {
      const bar = card.getByRole('progressbar', { name: 'Uploading site-video.bin' });
      const value = async () => Number((await bar.getAttribute('aria-valuenow')) ?? 0);
      await expect.poll(value).toBeGreaterThan(0);
      const first = await value();
      await expect.poll(value).toBeGreaterThan(first);
    });

    await expect(toasts(page).getByText('1 file added to Design.')).toBeVisible({
      timeout: 60_000,
    });
    await expect(card).toHaveCount(0);
  } finally {
    await page.unroute('**/api/uploads/*/pieces*');
  }

  await test.step('in pieces of the size Start gave, and the bytes arrived whole', async () => {
    const { key, pieceSize } = starts['site-video.bin'];
    expect(pieceSize).toBeGreaterThan(0);
    const sent = offsets
      .filter((url) => url.includes(`/api/uploads/${key}/pieces`))
      .map((url) => Number(new URL(url).searchParams.get('offset')));
    const expected = Array.from({ length: Math.ceil(BIG / pieceSize) }, (_, i) => i * pieceSize);
    expect([...new Set(sent)]).toEqual(expected);
    const link = await page
      .getByRole('link', { name: 'Download site-video.bin', exact: true })
      .getAttribute('href');
    const download = await answerOf(page, link);
    expect(download.status).toBe(200);
    expect(download.body.equals(readFileSync(kept))).toBe(true);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('while a file uploads, downloads never ask, a signed-out file has Retry, and focus stays', async ({
  signInAs,
  baseURL,
}) => {
  const page = await openFiles(signInAs, PEOPLE.pm, 'design');
  for (const name of ['notes.txt', 'photo.jpg']) {
    const input = { projectId, target: 'project', phase: 'design', visibility: 'everyone' };
    await uploadByApi(page, baseURL, input, fileFixture(name));
  }
  await open(page, `/projects/${projectId}?tab=files&place=design`);
  const here = page.url();
  const asked = [];
  page.on('dialog', async (dialog) => {
    asked.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
  // Pieces wait here while a step needs a file on its way; one can be answered 401 (signed out).
  const held = [];
  let mode = 'hold';
  await page.route('**/api/uploads/*/pieces*', async (route) => {
    if (mode === 'signedOut') {
      mode = 'pass';
      const error = { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' };
      await route.fulfill({ status: 401, json: { error } });
    } else if (mode === 'hold') held.push(route);
    else await route.continue();
  });
  const letGo = async () => {
    mode = 'pass';
    await Promise.all(held.splice(0).map((route) => route.continue().catch(() => undefined)));
  };
  const card = page.getByRole('region', { name: 'Uploads' });
  const startUpload = async (file) => {
    const dialog = await uploadFiles(page, [file]);
    await dialog.getByRole('button', { name: 'Upload 1 file' }).click();
  };

  try {
    await test.step('a download while a file uploads: no "Leave site?", the page stays', async () => {
      await startUpload(bigFile('during-download.bin', BIG));
      await expect(card.getByRole('heading', { name: 'Uploading 1 file' })).toBeVisible();
      let got = page.waitForEvent('download', { timeout: 15_000 });
      await page.getByRole('link', { name: 'Download notes.txt', exact: true }).click();
      expect((await got).suggestedFilename()).toBe('notes.txt');
      got = page.waitForEvent('download', { timeout: 15_000 });
      await page.getByRole('button', { name: 'More for notes.txt' }).click();
      await page.getByRole('menuitem', { name: 'Download' }).click();
      expect((await got).suggestedFilename()).toBe('notes.txt');
      expect(asked).toEqual([]);
      expect(page.url()).toBe(here);
      await expect(card.getByRole('heading', { name: 'Uploading 1 file' })).toBeVisible();
    });

    await test.step('a download that fails asks first, and No keeps the upload going', async () => {
      const link = page.getByRole('link', { name: 'Download photo.jpg', exact: true });
      const id = fileIdOf(await link.getAttribute('href'));
      const deleted = await page.evaluate(
        async (fileId) =>
          (await fetch(`/api/project-files/${fileId}`, { method: 'DELETE' })).status,
        id,
      );
      expect(deleted).toBe(200);
      await link.click();
      await expect
        .poll(() => asked)
        .toEqual(['confirm: Leave this page? 1 file is still uploading and will stop.']);
      expect(page.url()).toBe(here);
      await letGo();
      await expect(
        page.getByRole('link', { name: 'Download during-download.bin', exact: true }),
      ).toBeVisible({ timeout: 60_000 });
    });

    await test.step('a piece answered 401 stops the file with Retry, and Retry brings it in', async () => {
      mode = 'signedOut';
      await startUpload(bigFile('signed-out.bin', 256 * 1024));
      await expect(
        card.getByRole('heading', { name: "1 file couldn't be uploaded" }),
      ).toBeVisible();
      await expect(card).toContainText('You were signed out. Sign in again, then press Retry.');
      await card.getByRole('button', { name: 'Retry signed-out.bin' }).click();
      await expect(
        page.getByRole('link', { name: 'Download signed-out.bin', exact: true }),
      ).toBeVisible({ timeout: 60_000 });
      await expect(card).toHaveCount(0);
    });

    await test.step('cancelling the only upload puts focus on Upload files', async () => {
      mode = 'hold';
      await startUpload(bigFile('cancel-me.bin', BIG));
      const cancel = card.getByRole('button', { name: 'Cancel uploading cancel-me.bin' });
      await cancel.focus();
      await page.keyboard.press('Enter');
      await expect(card).toHaveCount(0);
      await expect(page.locator('#files-upload')).toBeFocused();
    });
  } finally {
    await letGo();
    await page.unroute('**/api/uploads/*/pieces*');
  }
  expect(asked).toHaveLength(1);
});

test('from the keyboard: Delete gives Undo the focus, Edit details keeps the place in the list', async ({
  signInAs,
}) => {
  const page = await openFiles(signInAs, PEOPLE.pm, 'design');
  const deletes = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deletes.push(request.url());
  });
  /** The row names in the order shown. */
  const shownNames = () =>
    page
      .locator('main [id^="files-row-"]')
      .evaluateAll((names) => names.map((name) => name.getAttribute('aria-label')));
  /** Opens a row's "⋯" from the keyboard and chooses an item counted from the end. */
  const chooseFromEnd = async (name, label, ups) => {
    await page.getByRole('button', { name: `More for ${name}` }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('End');
    for (let step = 0; step < ups; step += 1) await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menuitem', { name: label })).toBeFocused();
    await page.keyboard.press('Enter');
  };

  await test.step("a row's Delete chosen with Enter puts focus on Undo", async () => {
    await chooseFromEnd('site-drawing.svg', 'Delete', 0);
    await expect(row(page, 'site-drawing.svg')).toHaveCount(0);
    const undo = toasts(page)
      .getByRole('status')
      .filter({ hasText: 'File deleted.' })
      .getByRole('button', { name: 'Undo' });
    await expect(undo).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(row(page, 'site-drawing.svg')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(deletes).toEqual([]);
  });

  await test.step('a file moved out of the place: focus on the next row, Save kept it meanwhile', async () => {
    const before = await shownNames();
    const at = before.indexOf('notes.txt');
    expect(at).toBeGreaterThan(-1);
    const next = before[at + 1] ?? before[at - 1];
    // The save waits a moment, so where focus is while it works can be read.
    await page.route('**/api/project-files/*', async (route) => {
      if (route.request().method() === 'PATCH') await new Promise((done) => setTimeout(done, 800));
      await route.continue();
    });
    try {
      await chooseFromEnd('notes.txt', 'Edit details', 1);
      const dialog = page.getByRole('dialog', { name: 'Edit details' });
      await dialog.getByLabel('Place').selectOption('project');
      const save = dialog.getByRole('button', { name: 'Save changes' });
      await save.focus();
      const patched = page.waitForResponse((answer) => answer.request().method() === 'PATCH');
      await page.keyboard.press('Enter');
      await expect(save).toHaveAttribute('aria-disabled', 'true');
      await expect(save).toBeFocused();
      expect((await patched).status()).toBe(200);
      await expect(dialog).toHaveCount(0);
      await expect(row(page, 'notes.txt')).toHaveCount(0);
      await expect(page.locator(`main [id^="files-row-"][aria-label="${next}"]`)).toBeFocused();
    } finally {
      await page.unroute('**/api/project-files/*');
    }
  });

  await test.step("a rename: focus back on the row's ⋯", async () => {
    await chooseFromEnd('logo.png', 'Edit details', 1);
    const dialog = page.getByRole('dialog', { name: 'Edit details' });
    const name = dialog.getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    await name.fill('logo-mark');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More for logo-mark.png' })).toBeFocused();
  });

  await test.step('a name cut in the middle is read whole', async () => {
    await page.getByRole('button', { name: 'Upload files' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Upload files' });
    const long = bigFile('checkout-error-steps.txt', 64);
    await chooseFiles(
      page,
      dialog.getByText('Choose files', { exact: true }).filter({ visible: true }),
      [long],
    );
    const remove = page.getByRole('button', { name: 'Remove checkout-error-steps.txt' });
    const chip = dialog.getByRole('list', { name: 'Files' }).getByRole('listitem');
    await expect(chip.filter({ has: remove })).toBeVisible();
    // The name is cut as "checkout-error-" and "steps.txt", but read as one word.
    const read = await chip.ariaSnapshot();
    expect(read).toContain('text: checkout-error-steps.txt');
    expect(read).not.toContain('checkout-error- steps.txt');
    // Selected and copied, it is there once (the whole name read out is never selected).
    const copied = await chip.locator('[class*="fileName"]').evaluate((name) => {
      const range = document.createRange();
      range.selectNodeContents(name);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return getSelection().toString();
    });
    expect(copied.replace(/\s/g, '')).toBe('checkout-error-steps.txt');
    await remove.click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step('on a phone Upload files fills the screen', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Upload files' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Upload files' });
    await expect(dialog).toBeVisible();
    // Once its opening animation is over.
    const box = async () => {
      const { x, y, width, height } = await dialog.boundingBox();
      return [x, y, width, height].map(Math.round);
    };
    await expect.poll(box).toEqual([0, 0, 390, 844]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});
