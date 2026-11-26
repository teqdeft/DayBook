// CONTRACT 22, 27 and 28: project management. The PM reads every project's health on the Projects
// list, opens the off-track demo project (acme-store) on its Board (the Filter menu's "Critical (4)"
// and the Done phases rail) and goes through its tabs (Board, Summary, Files, Timeline, Hours), adds
// from the toolbar's Add task, edits, ticks and deletes a task (with Undo), uploads a
// real PDF and a real Word file in the Files tab and has their text read for the AI in the browser,
// writes a note, changes the deadline and moves the phase from the band. Another PM then sees the
// plan with no files, no summary text in the page and no controls.
//
// The demo data (db/demo/projectPlans.js) gives acme-store, internal-tool and iwilltillimwell a
// plan: off track, at risk and on track on any day of the week. Every /api/ai/** request is
// answered in the browser (support/projectPlan.js), so the server never asks Google. The AI states
// need the server to have a key: start the run with GEMINI_API_KEY set to any value (for example
// GEMINI_API_KEY=e2e-dummy-not-a-key npx playwright test); without one that test is skipped.
// project-board.spec.js, which runs first, puts back everything it changes on acme-store.
import { NORMAL_TEXT } from '../fixtures/docx/make-fixtures.mjs';
import { aiRequestCount, closeDemoData, projectIdByName } from './support/demoData.js';
import { chooseFiles, fileFixture } from './support/files.js';
import { PEOPLE, cellUnder, expect, open, problemsOf, test, toasts } from './support/fixtures.js';
import { savedText, setProjectSummaries, stubAi, write } from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const OFF = 'acme-store';
const NOTE = 'Weekly call with Acme Retail'; // the demo's note on acme-store
const SOW = 'Acme-store-SOW-v2.pdf'; // the demo's text-only document
const OVERVIEW = "An online store for Acme Retail's shops";
const TABS = ['Board', 'Summary', 'Files', 'Timeline', 'Hours'];

let projectId;
test.beforeAll(async () => {
  projectId = await projectIdByName(OFF);
});
test.afterAll(closeDemoData);

/** A day `days` from now, as a date field takes it. */
const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Signs in with every AI request stubbed, and opens a path. */
async function openAs(signInAs, person, path, answer) {
  const page = await signInAs(person);
  const asked = await stubAi(page, answer);
  await open(page, path);
  return { page, asked };
}

const tabsOf = (page) => page.getByRole('navigation', { name: 'Project sections' });
const band = (page) => page.getByRole('region', { name: 'Progress and phases' });
const column = (page, name) => page.getByRole('region', { name, exact: true });
/** The band's part of a phase: "Development, current phase, 6 of 12 tasks done. …". */
const part = (page, text) =>
  band(page)
    .getByRole('list', { name: 'Phases' })
    .getByRole('button', { name: new RegExp(`^${text}`) });

test('the projects list shows each project’s health, phase, progress and deadline', async ({
  signInAs,
}) => {
  const { page } = await openAs(signInAs, PEOPLE.pm, '/projects');
  await expect(page.getByText(/^\d+ active projects: 1 off track, 1 at risk$/)).toBeVisible();
  const table = page.getByRole('table', { name: 'Active projects' });
  for (const name of ['Project', 'Health', 'Phase', 'Progress', 'Deadline', 'Manager']) {
    await expect(table.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  for (const gone of ['Team', 'Status']) {
    await expect(table.getByRole('columnheader', { name: gone, exact: true })).toHaveCount(0);
  }
  const row = (name) =>
    table.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
  const cell = (name, column) => cellUnder(table, row(name), column);

  // Off track first, then at risk, then on track.
  const names = await table.locator('tbody tr').getByRole('link').allInnerTexts();
  expect(names.slice(0, 3)).toEqual([OFF, 'internal-tool', 'iwilltillimwell']);
  await expect(await cell(OFF, 'Health')).toHaveText('Off track');
  await expect(await cell(OFF, 'Phase')).toHaveText('Development');
  await expect(await cell(OFF, 'Progress')).toHaveText('66%');
  await expect(await cell(OFF, 'Deadline')).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
  await expect(await cell(OFF, 'Manager')).toHaveText(PEOPLE.pm.name);
  await expect(row(OFF).getByText('Urgent', { exact: true })).toHaveAttribute(
    'title',
    'Checkout fix before client demo',
  );
  await expect(await cell('internal-tool', 'Health')).toHaveText('At risk');
  await expect(await cell('iwilltillimwell', 'Health')).toHaveText('On track');
  // Priority tasks but no plan, and nothing at all.
  await expect(await cell('acme-seo', 'Health')).toHaveText('No deadline');
  await expect(await cell('acme-seo', 'Phase')).toHaveText('Not set');
  await expect(await cell('Proposals', 'Health')).toHaveText('No plan yet');
  await expect(await cell('Proposals', 'Progress')).toHaveText('No tasks yet');
  await expect(await cell('Proposals', 'Deadline')).toHaveText('No deadline');

  // The row menu's old Phases link opens the Board.
  await page.getByRole('button', { name: `Actions for ${OFF}` }).click();
  await page.getByRole('menuitem', { name: 'Phases and tasks' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?tab=phases$`));
  await expect(tabsOf(page).getByRole('link', { name: 'Board' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(column(page, 'Development')).toBeVisible();
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('the board of an off-track project, its tabs, and the stored summary with AI off', async ({
  signInAs,
}) => {
  const { page } = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const tabs = tabsOf(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(OFF);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Off track');
  await expect(
    page.getByText(
      `Acme Retail · PM: ${PEOPLE.pm.name} · Active · Urgent: Checkout fix before client demo`,
    ),
  ).toBeVisible();
  await expect(tabs.getByRole('link')).toHaveText(TABS);
  await expect(tabs.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');

  await test.step('the band: progress, deadline, the next phase and the forecast', async () => {
    await expect(band(page)).toContainText('66%');
    await expect(band(page)).toContainText('19 of 29 tasks done');
    await expect(band(page)).toContainText(/\d{1,2} [A-Z][a-z]{2} \d{4}\s*\d+ days left/);
    await expect(band(page).getByRole('button', { name: 'Change deadline' })).toBeVisible();
    await expect(band(page).getByRole('button', { name: 'Move to Testing' })).toBeVisible();
    await expect(
      part(page, 'Development, current phase, 6 of 12 tasks done. Show its column.'),
    ).toBeVisible();
    await expect(part(page, 'Design, done, 7 of 7 tasks done.')).toBeVisible();
    await expect(band(page)).toContainText(
      /Off track: will miss the deadline by about \d+ days\. At the current speed \(2 tasks a week\) the work ends/,
    );
  });

  await test.step('the columns, the Filter menu and Done phases', async () => {
    const filter = page.getByRole('group', { name: 'Task tools' }).getByRole('button', {
      name: /^Filter/,
    });
    await filter.click();
    const critical = page.getByRole('menuitemcheckbox', { name: 'Critical (4)' });
    await expect(critical).toHaveAttribute('aria-checked', 'false');
    await critical.click();
    await expect(critical).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(filter).toHaveAccessibleName(/^Filter.*1 on$/);
    await expect(
      page.getByRole('status').filter({ hasText: '4 tasks match. The others are faded.' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByText('4 tasks match.')).toHaveCount(0);

    const development = column(page, 'Development');
    await expect(development).toContainText('Current');
    await expect(development).toContainText('Started 2 days late');
    await expect(development.getByRole('button', { name: '6 done' })).toBeVisible();
    const done = page.getByRole('region', { name: 'Done phases' });
    await done.getByRole('button', { name: /^Done phases 2/ }).click();
    await expect(done.getByRole('heading', { name: 'Done phases' })).toBeVisible();
    await expect(done).toContainText('Requirement gathering');
    await expect(done).toContainText('Ended 5 days late');
    await done.getByRole('button', { name: 'Show Design tasks' }).click();
    await expect(column(page, 'Design')).toContainText('Wireframes for the checkout');
    await column(page, 'Design').getByRole('button', { name: 'Hide Design tasks' }).click();
    await expect(column(page, 'Design')).toHaveCount(0);
    await done.getByRole('button', { name: 'Fold the done phases' }).click();
    await expect(done.getByRole('button', { name: /^Done phases 2/ })).toBeVisible();
  });

  await test.step('Summary: health, critical tasks and the stored summary, AI off', async () => {
    await tabs.getByRole('link', { name: 'Summary' }).click();
    await expect(page).toHaveURL(/\?tab=summary$/);
    const health = page.getByRole('status').filter({ hasText: 'Off track:' });
    await expect(health).toContainText(/Off track: will miss the deadline by about \d+ days/);
    const critical = page.getByRole('list', { name: 'Critical tasks' }).getByRole('listitem');
    await expect(critical).toHaveCount(4);
    await expect(critical.first()).toContainText('Get the payment gateway keys from Acme');
    await expect(critical.first()).toContainText(`Development · ${PEOPLE.pm.name}`);
    const card = page.getByRole('region', { name: 'AI summary' });
    await expect(card).toContainText(OVERVIEW);
    await expect(card).toContainText('Risk: Card payments still fail on the last step');
    await expect(
      card.getByRole('list', { name: 'Action items' }).getByRole('listitem'),
    ).toHaveCount(3);
    await expect(card).toContainText(
      'AI suggests moving on: “show the checkout working end to end, then start testing” · ' + NOTE,
    );
    await expect(card).toContainText(
      /From 1 file and \d+ notes?\. Written by AI, check anything important\./,
    );
    await expect(card).toContainText(
      'AI summary is off. An Admin can turn it on in Settings → AI.',
    );
    await card.getByRole('button', { name: 'Read full summary' }).click();
    await expect(card.getByText('Not in scope')).toBeVisible();
    await expect(card.getByText(`${SOW}, page 2`).first()).toBeVisible();
    await page.getByRole('link', { name: 'See all tasks' }).click();
    await expect(page).toHaveURL(/\?tab=board&show=critical$/);
    await expect(
      page.getByRole('status').filter({ hasText: '4 tasks match. The others are faded.' }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Filter/ }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Critical (4)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Escape');
  });

  await test.step('Files, Timeline and Hours are links with the tab in the address', async () => {
    await tabs.getByRole('link', { name: 'Files' }).click();
    await expect(page).toHaveURL(/\?tab=files$/);
    await expect(page.getByRole('navigation', { name: 'Places' })).toBeVisible();
    await expect(page.getByRole('button', { name: NOTE, exact: true })).toBeVisible();

    await tabs.getByRole('link', { name: 'Timeline' }).click();
    await expect(page).toHaveURL(/\?tab=timeline$/);
    await expect(page.getByRole('region', { name: 'Timeline chart' })).toBeVisible();

    await tabs.getByRole('link', { name: 'Hours' }).click();
    await expect(page).toHaveURL(/\?tab=hours$/);
    const range = page.getByRole('group', { name: 'Range' });
    await expect(range.getByRole('link', { name: 'This month' })).toHaveAttribute(
      'href',
      /tab=hours/,
    );
    // A link from before the tabs, with a range and no tab, opens Hours; old tabs open the Board.
    await open(page, `/projects/${projectId}?range=month`);
    await expect(tabs.getByRole('link', { name: 'Hours' })).toHaveAttribute('aria-current', 'page');
    for (const old of ['overview', 'phases']) {
      await open(page, `/projects/${projectId}?tab=${old}`);
      await expect(tabs.getByRole('link', { name: 'Board' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });
  await page.waitForLoadState('networkidle');
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('tasks: add, edit, tick and Undo, delete and Undo, then delete', async ({ signInAs }) => {
  const { page } = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const development = column(page, 'Development');
  const title = 'Coupon field at checkout';
  const titleButton = () => page.getByRole('button', { name: title, exact: true });
  const progress = (count) => part(page, `Development, current phase, 6 of ${count} tasks done`);

  const addTask = page
    .getByRole('group', { name: 'Task tools' })
    .getByRole('button', { name: 'Add task', exact: true });
  await test.step('add a task, with the title checked first', async () => {
    await addTask.click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await expect(dialog.getByLabel('Phase')).toHaveValue('development');
    await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(dialog.getByText('Write a title of at least 2 characters.')).toBeVisible();
    await dialog.getByLabel('Task title').fill(title);
    await dialog
      .getByRole('group', { name: 'Assign to' })
      .getByRole('radio', { name: 'Simran Kaur', exact: true })
      .check();
    await dialog.getByLabel('Due date').fill(daysFromNow(7));
    await dialog.getByText('P1 critical', { exact: true }).click();
    const posted = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/tasks'),
    );
    await dialog.getByRole('button', { name: 'Add task', exact: true }).click();
    expect((await posted).postDataJSON()).toMatchObject({
      title,
      priority: 'p1',
      phase: 'development',
      dueDate: daysFromNow(7),
      uploadKeys: [],
    });
    await expect(dialog).toHaveCount(0);
    await expect(toasts(page).getByText('Task added to Development.')).toBeVisible();
    await expect(toasts(page).getByText('Simran Kaur gets a notification.')).toBeVisible();
    await expect(development.getByRole('button', { name: title, exact: true })).toBeVisible();
    await expect(addTask).toBeFocused();
    await expect(progress(13)).toBeVisible();
  });

  await test.step('an edit sends only what changed', async () => {
    await page.getByRole('button', { name: `More for ${title}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit task' });
    await dialog.getByText('P2', { exact: true }).click();
    const patched = page.waitForRequest((request) => request.method() === 'PATCH');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    expect((await patched).postDataJSON()).toEqual({ priority: 'p2' });
    await expect(toasts(page).getByText('Changes saved.')).toBeVisible();
    await expect(titleButton()).toBeFocused();
  });

  await test.step('tick it, then Undo opens it again', async () => {
    const status = (value) =>
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/status') && response.request().postDataJSON()?.status === value,
      );
    const ticked = status('done');
    await page.getByRole('checkbox', { name: `Done: ${title}` }).click();
    expect((await ticked).status()).toBe(200);
    // After its 600 ms wait the card leaves for the closed "› 7 done" fold (CONTRACT 28).
    await expect(titleButton()).toBeHidden();
    await expect(progress(13)).toHaveCount(0);
    const undo = toasts(page).getByRole('status').filter({ hasText: 'Marked done.' });
    const reopened = status('open');
    await undo.getByRole('button', { name: 'Undo' }).click();
    expect((await reopened).status()).toBe(200);
    // Back at once: the board no longer holds it as done once Undo reopened it.
    await expect(progress(13)).toBeVisible({ timeout: 5000 });
    await expect(titleButton()).toBeVisible();
    await expect(page.getByRole('checkbox', { name: `Done: ${title}` })).not.toBeChecked();
  });

  const deletes = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deletes.push(request.url());
  });
  const deleteTask = async () => {
    await page.getByRole('button', { name: `More for ${title}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
  };

  await test.step('delete and Undo: the card comes back and nothing is sent', async () => {
    await deleteTask();
    await expect(titleButton()).toHaveCount(0);
    const undo = toasts(page).getByRole('status').filter({ hasText: 'Task deleted.' });
    await undo.getByRole('button', { name: 'Undo' }).click();
    await expect(titleButton()).toHaveCount(1);
    await page.waitForTimeout(1000);
    expect(deletes).toEqual([]);
  });

  await test.step('delete and let the toast end: sent once, gone after a reload', async () => {
    const sent = page.waitForResponse((response) => response.request().method() === 'DELETE', {
      timeout: 20_000,
    });
    await deleteTask();
    expect((await sent).status()).toBe(200);
    expect(deletes).toHaveLength(1);
    await open(page, `/projects/${projectId}`);
    await expect(progress(12)).toBeVisible();
    await expect(titleButton()).toHaveCount(0);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('files and notes: a real PDF and a real Word file read for the AI, and a note', async ({
  signInAs,
}) => {
  const { page } = await openAs(
    signInAs,
    PEOPLE.pm,
    `/projects/${projectId}?tab=files&place=development`,
  );
  const upload = async (file) => {
    await page.getByRole('button', { name: 'Upload files' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Upload files' });
    await expect(dialog.getByLabel('Add to')).toHaveValue('development');
    await chooseFiles(
      page,
      dialog.getByText('Choose files', { exact: true }).filter({ visible: true }),
      [fileFixture(file)],
    );
    await dialog.getByRole('button', { name: 'Upload 1 file' }).click();
    await expect(dialog).toHaveCount(0);
  };
  const menu = (name) => page.getByRole('button', { name: `More for ${name}`, exact: true });

  await test.step('a PDF: its pages of text, split by a form feed', async () => {
    const saved = savedText(page);
    await upload('pdf/two-pages.pdf');
    await expect(toasts(page).getByText('1 file added to Development.')).toBeVisible();
    const stored = await saved;
    expect(stored).toMatchObject({ kind: 'file', pages: 2, pagesTotal: 2 });
    expect(stored.visibility).toBe('managers');
    const pages = stored.body.split('\f');
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('Scope for Acme Clinics.');
    expect(pages[1]).toContain('Payment provider still to be decided.');
    await expect(page.getByRole('link', { name: 'two-pages.pdf', exact: true })).toBeVisible();
  });

  await test.step('a Word .docx: exactly its text, no pages', async () => {
    const saved = savedText(page);
    await upload('docx/normal.docx');
    const stored = await saved;
    expect(stored.body).toBe(NORMAL_TEXT);
    expect(stored).toMatchObject({ kind: 'file', pages: null, pagesTotal: null });
    await expect(page.getByRole('link', { name: 'normal.docx', exact: true })).toBeVisible();
  });

  await test.step('a file Daybook can’t read stays, and says why', async () => {
    await upload('pdf/scan.pdf');
    const failed = toasts(page)
      .getByRole('alert')
      .filter({ hasText: "The AI summary can't read scan.pdf." });
    await expect(failed).toContainText(
      'No readable text. Is it a scan? Paste the key parts as a note.',
    );
    await expect(page.getByRole('link', { name: 'scan.pdf', exact: true })).toBeVisible();
    await menu('scan.pdf').click();
    await expect(page.getByRole('menuitem', { name: 'Read text for AI' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  await test.step('View text opens the text, page by page', async () => {
    await menu('two-pages.pdf').click();
    await page.getByRole('menuitem', { name: 'View text' }).click();
    const box = page.getByRole('dialog', { name: 'two-pages.pdf' });
    await expect(box).toContainText('Scope for Acme Clinics.');
    await expect(box.getByRole('separator', { name: 'Page 2' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
  });

  await test.step('a note, for everyone on the project', async () => {
    await page.getByRole('button', { name: 'New note' }).click();
    const dialog = page.getByRole('dialog', { name: 'New note' });
    await expect(dialog.getByRole('radio', { name: /^Everyone on the project/ })).toBeChecked();
    await dialog.getByLabel('Title').fill('Checkout test with Acme');
    await dialog.getByLabel('Text').fill('Card payments work.\nCash on delivery next week.');
    const posted = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/documents'),
    );
    await dialog.getByRole('button', { name: 'Add note', exact: true }).click();
    expect((await posted).postDataJSON()).toMatchObject({
      kind: 'note',
      phase: 'development',
      visibility: 'everyone',
    });
    await expect(toasts(page).getByText('Note added.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Checkout test with Acme', exact: true }),
    ).toBeVisible();
  });
  // The scan's error toast is the only problem, and it isn't on the console.
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('AI summary with AI on: update, add an action, an error, and nothing reaches Google', async ({
  signInAs,
  baseURL,
}) => {
  test.skip(
    !process.env.GEMINI_API_KEY,
    'Start the run with GEMINI_API_KEY set (any value); every /api/ai request is stubbed',
  );
  const before = await aiRequestCount();
  const admin = await signInAs(PEOPLE.ceo);
  await stubAi(admin);
  await open(admin, '/settings');
  await setProjectSummaries(admin, baseURL, true);
  try {
    const OK = { status: 200, body: { data: {} } };
    let summaryAnswer = OK;
    const { page, asked } = await openAs(
      signInAs,
      PEOPLE.pm,
      `/projects/${projectId}?tab=summary`,
      (path) => (path.endsWith('/summary/tasks') ? OK : summaryAnswer),
    );
    const card = page.getByRole('region', { name: 'AI summary' });
    // The files and note added above changed the documents since the summary.
    await expect(card).toContainText('Files or notes changed since this summary.');
    await card.getByRole('button', { name: 'Update summary' }).click();
    await expect(toasts(page).getByText('Summary updated.')).toBeVisible();

    await card.getByRole('button', { name: 'Add to tasks: Send the product photos' }).click();
    await expect(toasts(page).getByText('Added to Development.')).toBeVisible();
    await expect(card.getByText('Added', { exact: true })).toBeVisible();

    summaryAnswer = null; // 503: AI is busy
    await card.getByRole('button', { name: 'Update summary' }).click();
    await expect(
      toasts(page).getByRole('alert').filter({ hasText: 'AI is busy. Try again in a minute.' }),
    ).toBeVisible();
    await expect(card).toContainText(OVERVIEW);
    summaryAnswer = OK;

    await test.step('a project with a note and no summary offers Write summary', async () => {
      const other = await projectIdByName('internal-tool');
      const note = { phase: 'development', kind: 'note', title: 'Demo prep', text: 'Show HR.' };
      const added = await write(page, baseURL, 'post', `/api/projects/${other}/documents`, note);
      expect(added.status()).toBe(201);
      await open(page, `/projects/${other}?tab=summary`);
      await expect(card).toContainText('1 note is ready.');
      await card.getByRole('button', { name: 'Write summary' }).click();
      await expect(toasts(page).getByText('Summary written.')).toBeVisible();
    });
    expect(asked).toEqual([
      `/api/ai/projects/${projectId}/summary`,
      `/api/ai/projects/${projectId}/summary/tasks`,
      `/api/ai/projects/${projectId}/summary`,
      expect.stringMatching(/^\/api\/ai\/projects\/\d+\/summary$/),
    ]);
    expect(await aiRequestCount(), 'requests the server sent to the AI').toBe(before);
    // Only the stubbed 503 reached the console.
    expect(problemsOf(page).filter((line) => !line.includes('503'))).toEqual([]);
  } finally {
    await setProjectSummaries(admin, baseURL, false);
  }
});

test('the deadline changes the health, and Move starts the next phase, from the band', async ({
  signInAs,
}) => {
  const { page } = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);

  await test.step('a later deadline puts the project on track', async () => {
    await band(page).getByRole('button', { name: 'Change deadline' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change deadline' });
    await expect(dialog.getByLabel('Deadline')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await dialog.getByLabel('Deadline').fill(daysFromNow(120));
    // `next dev` may compile the route on this first save, which can take longer than 15 s.
    const saved = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().endsWith('/deadline'),
      { timeout: 60_000 },
    );
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect((await saved).status()).toBe(200);
    await expect(toasts(page).getByText('Deadline saved.')).toBeVisible();
    await expect(band(page)).toContainText(/On track: will finish about \d+ days early/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('On track');
  });

  await test.step('Move to Testing', async () => {
    await band(page).getByRole('button', { name: 'Move to Testing' }).click();
    const dialog = page.getByRole('dialog', { name: 'Move to Testing?' });
    await expect(dialog).toContainText(/Development ends today, .+\. Testing starts today, .+\./);
    await dialog.getByRole('button', { name: 'Move to Testing' }).click();
    await expect(toasts(page).getByText('Phase changed to Testing.')).toBeVisible();
    await expect(part(page, 'Testing, current phase')).toBeVisible();
    await expect(band(page).getByRole('button', { name: 'Move to Launch' })).toBeVisible();
    await expect(column(page, 'Testing')).toContainText('Current');
    // Development still has open tasks, so it stays a column (it never folds them away).
    await expect(column(page, 'Development')).toBeVisible();
  });

  await test.step('the summary follows, and the AI line is gone', async () => {
    await open(page, `/projects/${projectId}?tab=summary`);
    await expect(page.getByRole('region', { name: 'AI summary' })).toBeVisible();
    await expect(page.getByText(/AI suggests/)).toHaveCount(0);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('another PM sees the plan, but no files, no summary and no controls', async ({
  signInAs,
  baseURL,
}) => {
  const { page } = await openAs(signInAs, PEOPLE.pm2, `/projects/${projectId}`);
  await expect(tabsOf(page).getByRole('link')).toHaveText(TABS);
  await expect(
    page.getByText(`Only ${PEOPLE.pm.name} and Admins can change tasks and phases.`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(band(page)).toContainText(/On track: will finish about \d+ days early/);
  await expect(column(page, 'Testing')).toBeVisible();
  for (const name of [/deadline$/, /^Move to /, 'More phase actions', 'New task', 'Add task']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /^More for / })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  await test.step('Summary: health and critical tasks only', async () => {
    await open(page, `/projects/${projectId}?tab=summary`);
    await expect(page.getByRole('status').filter({ hasText: 'On track:' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Critical tasks' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'AI summary' })).toHaveCount(0);
    await expect(page.getByText(/AI suggests/)).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });

  await test.step('Files: the lock line', async () => {
    await open(page, `/projects/${projectId}?tab=files`);
    await expect(
      page.getByText(`Files are only for ${PEOPLE.pm.name}, Admins and people on the project.`),
    ).toBeVisible();
  });

  await test.step('no file, note or summary text anywhere in the pages', async () => {
    const secrets = [NOTE, SOW, 'two-pages.pdf', 'normal.docx', 'scan.pdf'];
    secrets.push('Checkout test with Acme', OVERVIEW, 'Card payments still fail');
    secrets.push('Scope for Acme Clinics', '/api/project-files/');
    // The demo's files and its note for everyone on the project (db/demo/projectFiles.js).
    secrets.push('card-payment-error.png', 'zoom-notes.docx', 'acme-brand-guide.pdf');
    secrets.push('acme-store-contract-signed.pdf', 'Who to call at Acme Retail');
    for (const tab of ['board', 'board&view=table', 'summary', 'files', 'timeline']) {
      const html = await (await page.request.get(`/projects/${projectId}?tab=${tab}`)).text();
      for (const secret of secrets) expect(html, `${secret} on ${tab}`).not.toContain(secret);
    }
  });

  await test.step('the API refuses too', async () => {
    const document = await page.request.get(`/api/project-documents/1`);
    expect(document.status()).toBe(404);
    const path = `/api/projects/${projectId}/deadline`;
    expect((await write(page, baseURL, 'put', path, { deadline: null })).status()).toBe(403);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});
