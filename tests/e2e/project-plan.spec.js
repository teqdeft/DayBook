// CONTRACT 22: project management. The PM reads every project's health on the Projects list, opens
// the off-track demo project (acme-store) and goes through its tabs, adds, ticks, edits and deletes
// a task (with Undo), reads a real PDF and a real Word file in the browser, writes a note, changes
// the deadline and moves the phase. Another PM then sees the plan with no files, no summary text in
// the page and no controls.
//
// The demo data (db/demo/projectPlans.js) gives acme-store, internal-tool and iwilltillimwell a
// plan: off track, at risk and on track on any day of the week. Every /api/ai/** request is
// answered in the browser (support/projectPlan.js), so the server never asks Google. The AI states
// need the server to have a key: start the run with GEMINI_API_KEY set to any value (for example
// GEMINI_API_KEY=e2e-dummy-not-a-key npx playwright test); without one that test is skipped.
import { NORMAL_TEXT } from '../fixtures/docx/make-fixtures.mjs';
import { aiRequestCount, closeDemoData, projectIdByName } from './support/demoData.js';
import { PEOPLE, cellUnder, expect, open, problemsOf, test, toasts } from './support/fixtures.js';
import {
  fixture,
  pickFile,
  setProjectSummaries,
  stubAi,
  storedDocument,
  write,
} from './support/projectPlan.js';

test.describe.configure({ mode: 'serial' });

const OFF = 'acme-store';
const NOTE = 'Weekly call with Acme Retail'; // the demo's note on acme-store
const SOW = 'Acme-store-SOW-v2.pdf'; // the demo's file
const OVERVIEW = "An online store for Acme Retail's shops";

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

const header = (page, key) => page.locator(`div:has(> h2 > #phases-${key}-toggle)`);

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

  await page.getByRole('button', { name: `Actions for ${OFF}` }).click();
  await page.getByRole('menuitem', { name: 'Phases and tasks' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?tab=phases$`));
  await expect(page.locator('#phases-development-toggle')).toHaveAttribute('aria-expanded', 'true');
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('the overview of an off-track project, its tabs, and the stored summary with AI off', async ({
  signInAs,
}) => {
  const { page } = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const tabs = page.getByRole('navigation', { name: 'Project sections' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(OFF);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Off track');
  await expect(page.getByText(`Acme Retail · PM: ${PEOPLE.pm.name} · Active`)).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await test.step('health, progress, deadline, phase and critical tasks', async () => {
    const health = page.getByRole('status').filter({ hasText: 'Off track:' });
    await expect(health).toContainText(/Off track: will miss the deadline by about \d+ days/);
    await expect(health).toContainText(/At the current speed \(2 tasks a week\) the work ends/);
    await expect(
      page.getByRole('img', { name: '66% done out of 100%, 19 of 29 tasks' }),
    ).toBeVisible();
    const deadline = page.getByRole('region', { name: 'Deadline' });
    await expect(deadline).toContainText(/\d+ days left/);
    await expect(deadline.getByRole('button', { name: 'Change deadline' })).toBeVisible();
    const phase = page.getByRole('region', { name: 'Phase' });
    await expect(phase.locator('li[aria-current="step"]')).toHaveText('Development');
    await expect(phase).toContainText(
      'AI suggests moving on: “show the checkout working end to end, then start testing” · ' + NOTE,
    );
    await expect(phase.getByRole('button', { name: 'Move to Testing' })).toBeVisible();
    const critical = page.getByRole('list', { name: 'Critical tasks' }).getByRole('listitem');
    await expect(critical).toHaveCount(4);
    await expect(critical.first()).toContainText('Get the payment gateway keys from Acme');
    await expect(critical.first()).toContainText(`Development · ${PEOPLE.pm.name}`);
  });

  await test.step('the stored summary reads, is up to date, and AI is off', async () => {
    const card = page.getByRole('region', { name: 'AI summary' });
    await expect(card).toContainText(OVERVIEW);
    await expect(card).toContainText('Risk: Card payments still fail on the last step');
    await expect(
      card.getByRole('list', { name: 'Action items' }).getByRole('listitem'),
    ).toHaveCount(3);
    await expect(card).toContainText(
      'From 1 file and 1 note. Written by AI, check anything important.',
    );
    await expect(card).toContainText(
      'AI summary is off. An Admin can turn it on in Settings → AI.',
    );
    await card.getByRole('button', { name: 'Read full summary' }).click();
    await expect(card.getByText('Not in scope')).toBeVisible();
    await expect(card.getByText(`${SOW}, page 2`).first()).toBeVisible();
  });

  await test.step('Phases, Timeline and Hours are links with the tab in the address', async () => {
    await tabs.getByRole('link', { name: 'Phases' }).click();
    await expect(page).toHaveURL(/\?tab=phases$/);
    await expect(tabs.getByRole('link', { name: 'Phases' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(header(page, 'development')).toContainText('Current');
    await expect(header(page, 'development')).toContainText('6 of 12 tasks');
    await expect(header(page, 'requirement_gathering')).toContainText('Ended 5 days late');
    await expect(page.locator('#phases-development').getByText(NOTE)).toBeVisible();

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
    // A link from before the tabs, with a range and no tab, opens Hours.
    await open(page, `/projects/${projectId}?range=month`);
    await expect(tabs.getByRole('link', { name: 'Hours' })).toHaveAttribute('aria-current', 'page');
  });
  await page.waitForLoadState('networkidle');
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('tasks: add, edit, tick and Undo, delete and Undo, then delete', async ({ signInAs }) => {
  const { page } = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}?tab=phases`);
  const tasks = page.getByRole('list', { name: 'Tasks in Development' });
  const add = page.locator('#phases-development-add');
  const title = 'Coupon field at checkout';
  const rowOf = () => tasks.getByRole('listitem').filter({ hasText: title });

  await test.step('add a task, with the title checked first', async () => {
    await add.click();
    await tasks.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(tasks.getByRole('alert')).toHaveText('Add a task title.');
    await tasks.getByLabel('Task title').fill(title);
    await tasks.getByLabel('Owner').selectOption({ label: 'Simran Kaur' });
    await tasks.getByLabel('Due date').fill(daysFromNow(7));
    await tasks.getByLabel('Priority').selectOption({ label: 'P1 critical' });
    const posted = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/tasks'),
    );
    await tasks.getByRole('button', { name: 'Add', exact: true }).click();
    expect((await posted).postDataJSON()).toMatchObject({
      title,
      priority: 'p1',
      phase: 'development',
      dueDate: daysFromNow(7),
    });
    await expect(rowOf()).toContainText('Simran Kaur');
    await expect(add).toBeFocused();
    await expect(header(page, 'development')).toContainText('6 of 13 tasks');
  });

  await test.step('an edit sends only what changed', async () => {
    await page.getByRole('button', { name: `Edit task: ${title}` }).click();
    await tasks.getByLabel('Priority').selectOption({ label: 'P2' });
    const patched = page.waitForRequest((request) => request.method() === 'PATCH');
    await tasks.getByRole('button', { name: 'Save' }).click();
    expect((await patched).postDataJSON()).toEqual({ priority: 'p2' });
    await expect(page.getByRole('button', { name: `Edit task: ${title}` })).toBeFocused();
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
    const undo = toasts(page).getByRole('status').filter({ hasText: 'Marked done.' });
    const reopened = status('open');
    await undo.getByRole('button', { name: 'Undo' }).click();
    expect((await reopened).status()).toBe(200);
    await expect(header(page, 'development')).toContainText('6 of 13 tasks');
    await expect(page.getByRole('checkbox', { name: `Done: ${title}` })).not.toBeChecked();
  });

  const deletes = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deletes.push(request.url());
  });

  await test.step('delete and Undo: the row comes back and nothing is sent', async () => {
    await page.getByRole('button', { name: `Delete task: ${title}` }).click();
    await expect(rowOf()).toHaveCount(0);
    const undo = toasts(page).getByRole('status').filter({ hasText: 'Task deleted.' });
    await undo.getByRole('button', { name: 'Undo' }).click();
    await expect(rowOf()).toHaveCount(1);
    await page.waitForTimeout(1000);
    expect(deletes).toEqual([]);
  });

  await test.step('delete and let the toast end: sent once, gone after a reload', async () => {
    const sent = page.waitForResponse((response) => response.request().method() === 'DELETE', {
      timeout: 20_000,
    });
    await page.getByRole('button', { name: `Delete task: ${title}` }).click();
    expect((await sent).status()).toBe(200);
    expect(deletes).toHaveLength(1);
    await open(page, `/projects/${projectId}?tab=phases`);
    await expect(header(page, 'development')).toContainText('6 of 12 tasks');
    await expect(rowOf()).toHaveCount(0);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('files and notes: a real PDF and a real Word file read in the browser, and a note', async ({
  signInAs,
}) => {
  const { page } = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}?tab=phases`);
  const addFile = page.locator('#phases-development-add-file');
  const list = page.locator('#phases-development').getByRole('list', { name: 'Files and notes' });
  const row = (title) => page.getByRole('button', { name: title, exact: true });

  await test.step('a PDF: its pages of text, split by a form feed', async () => {
    await pickFile(page, addFile, fixture('pdf/two-pages.pdf'));
    await expect(toasts(page).getByText('two-pages.pdf added.')).toBeVisible();
    await expect(row('two-pages.pdf')).toBeVisible();
    await expect(addFile).toHaveText('Add file');
    const stored = await storedDocument(page, 'two-pages.pdf');
    expect(stored).toMatchObject({ kind: 'file', pages: 2, pagesTotal: 2 });
    const pages = stored.body.split('\f');
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('Scope for Acme Clinics.');
    expect(pages[1]).toContain('Payment provider still to be decided.');
    await expect(list.getByText(/^2 pages · \d{1,2} [A-Z][a-z]{2}$/)).toBeVisible();
  });

  await test.step('a Word .docx: exactly its text, no pages', async () => {
    await pickFile(page, addFile, fixture('docx/normal.docx'));
    await expect(toasts(page).getByText('normal.docx added.')).toBeVisible();
    const stored = await storedDocument(page, 'normal.docx');
    expect(stored.body).toBe(NORMAL_TEXT);
    expect(stored).toMatchObject({ kind: 'file', pages: null, pagesTotal: null });
    await expect(list.getByText(/^Word file · /)).toBeVisible();
  });

  await test.step('a file Daybook can’t read says so and adds nothing', async () => {
    await pickFile(page, addFile, fixture('pdf/scan.pdf'));
    await expect(
      toasts(page)
        .getByRole('alert')
        .filter({ hasText: 'No readable text. Is it a scan? Paste the key parts as a note.' }),
    ).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(3);
  });

  await test.step('the name opens the text, page by page', async () => {
    await row('two-pages.pdf').click();
    const box = page.getByRole('region', { name: 'Text of two-pages.pdf' });
    await expect(box).toContainText('Scope for Acme Clinics.');
    await expect(box.getByRole('separator', { name: 'Page 2' })).toBeVisible();
    await row('two-pages.pdf').click();
    await expect(box).toHaveCount(0);
  });

  await test.step('a note', async () => {
    const addNote = page.locator('#phases-development-add-note');
    await addNote.click();
    await page.getByLabel('Note title').fill('Checkout test with Acme');
    await page.getByLabel('Note text').fill('Card payments work.\nCash on delivery next week.');
    await page.getByRole('button', { name: 'Add note', exact: true }).last().click();
    await expect(row('Checkout test with Acme')).toBeVisible();
    await expect(addNote).toBeFocused();
    const names = await list.locator('button[id$="-name"]').allInnerTexts();
    expect(names).toEqual(['Checkout test with Acme', 'normal.docx', 'two-pages.pdf', NOTE]);
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
    const { page, asked } = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`, (path) =>
      path.endsWith('/summary/tasks') ? OK : summaryAnswer,
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
      await open(page, `/projects/${other}`);
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

test('the deadline changes the health, and Move starts the next phase', async ({ signInAs }) => {
  const { page } = await openAs(signInAs, PEOPLE.pm, `/projects/${projectId}`);
  const health = page.getByRole('status').filter({ hasText: /^(Off track|On track)/ });

  await test.step('a later deadline puts the project on track', async () => {
    await page.getByRole('button', { name: 'Change deadline' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change deadline' });
    await expect(dialog.getByLabel('Deadline')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await dialog.getByLabel('Deadline').fill(daysFromNow(120));
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(toasts(page).getByText('Deadline saved.')).toBeVisible();
    await expect(health).toContainText(/^On track: will finish about \d+ days early/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('On track');
  });

  await test.step('Move to Testing, from the Phases tab', async () => {
    await open(page, `/projects/${projectId}?tab=phases`);
    await page
      .locator('#phases-development')
      .getByRole('button', { name: 'Move to Testing' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Move to Testing?' });
    await expect(dialog).toContainText(/Development ends today, .+\. Testing starts today, .+\./);
    await dialog.getByRole('button', { name: 'Move to Testing' }).click();
    await expect(toasts(page).getByText('Phase changed to Testing.')).toBeVisible();
    await expect(header(page, 'testing')).toContainText('Current');
    await expect(header(page, 'development')).toContainText('Done');
    await expect(page.locator('#phases-testing-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.locator('#phases-testing').getByRole('button', { name: 'Move to Launch' }),
    ).toBeVisible();
  });

  await test.step('the overview follows, and the AI line is gone', async () => {
    await open(page, `/projects/${projectId}`);
    const phase = page.getByRole('region', { name: 'Phase' });
    await expect(phase.locator('li[aria-current="step"]')).toHaveText('Testing');
    await expect(phase.getByText(/AI suggests/)).toHaveCount(0);
    await expect(phase.getByRole('button', { name: 'Move to Launch' })).toBeVisible();
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('another PM sees the plan, but no files, no summary and no controls', async ({
  signInAs,
  baseURL,
}) => {
  const { page } = await openAs(signInAs, PEOPLE.pm2, `/projects/${projectId}`);
  await expect(page.getByRole('status').filter({ hasText: 'On track:' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Critical tasks' })).toBeVisible();
  for (const name of [/deadline$/, /^Move to /, /Add to tasks/]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('region', { name: 'AI summary' })).toHaveCount(0);
  await expect(page.getByText(/AI suggests/)).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);

  await open(page, `/projects/${projectId}?tab=phases`);
  await expect(
    page.getByText(`Only ${PEOPLE.pm.name} and Admins can edit phases.`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`Files and notes are only for ${PEOPLE.pm.name} and Admins.`),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Tasks in Testing' })).toBeVisible();
  for (const name of [
    /^Add (task|file|note)$/,
    'Edit dates',
    /^(Edit|Delete) task: /,
    /current phase/,
  ]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  await test.step('no file, note or summary text anywhere in the pages', async () => {
    const secrets = [NOTE, SOW, 'two-pages.pdf', 'normal.docx', 'Checkout test with Acme'];
    secrets.push(OVERVIEW, 'Card payments still fail', 'Scope for Acme Clinics');
    for (const tab of ['overview', 'phases', 'timeline']) {
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
