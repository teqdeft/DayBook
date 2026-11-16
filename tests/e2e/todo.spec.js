// CONTRACT 24 (Daybook 1.09): today's to-do and unfinished-task suggestions. An employee pastes the
// owner's usual Slack list on Today (3 projects, 5 tasks), ticks a line, picks a project whose
// unfinished task from an earlier report is suggested and marks it "Done already", then finds
// every line in the daily report with its status, leaves the planned project (Dotado) at 0 hours
// and submits. The PM opens the to-do from the Team board and the employee's page; HR has no Team
// board.
//
// Deepak Joshi is the person: the demo leaves him without a report today and with a blocked line
// on acme-seo from earlier this week that nobody carried on (db/demo/todo.js). timers.spec.js,
// which runs first, checks him in; run on its own, this spec checks him in itself. The owner's
// three projects aren't in the demo data, so the PM adds them first (the teardown loads the demo
// data again).
//
// Slack: the e2e server has no Slack connection (no bot token) and the demo picks no to-do
// channel, so "Post to Slack" stays hidden and the route answers 409 "Slack posting is off.", and
// nothing can reach Slack. Posting, Posted at, Update post and Couldn't post are covered with a
// fake Slack transport by tests/services/reportsTodoSlack.test.js and slackTodo.test.js, and on
// the card by tests/unit/todoCardRender.test.js and todoCardActions.test.js.
import { PEOPLE, cellUnder, expect, open, problemsOf, test, toasts } from './support/fixtures.js';
import { closeDemoData, userIdByEmail } from './support/demoData.js';
import { stubAi, write } from './support/projectPlan.js';

/** The owner's own Slack post (12 Nov 2026), as tests/unit/todoText.test.js has it. */
const OWNER_TEXT = [
  'Name: Priya Sharma',
  'Date: 12-11-2026',
  'Project— Pine Tree lane',
  '* Monitoring google ads campaign and removing irrelevant search terms',
  'Project- Studioubique',
  '* 1 web blog publish',
  '* Analysing the gsc stats to improve web blog content',
  '* 1 listicle content post on linkedin',
  'Project: Dotado',
  '* 2 Web blog topic research',
].join('\n');

const PROJECTS = [
  {
    name: 'Pine Tree Lane',
    heading: 'Pine Tree lane',
    clientName: 'Pine Tree Lane',
    color: 'green',
  },
  { name: 'Studio Ubique', heading: 'Studioubique', clientName: 'Internal', color: 'violet' },
  { name: 'Dotado', heading: 'Dotado', clientName: 'Dotado', color: 'orange' },
];

/** Every line of the report afterwards, by project: [title, status]. */
const REPORT = {
  'Pine Tree Lane': [
    ['Monitoring google ads campaign and removing irrelevant search terms', 'in_progress'],
  ],
  'Studio Ubique': [
    ['1 web blog publish', 'done'],
    ['Analysing the gsc stats to improve web blog content', 'in_progress'],
    ['1 listicle content post on linkedin', 'in_progress'],
  ],
  Dotado: [['2 Web blog topic research', 'in_progress']],
};
const TICKED = '1 web blog publish';
const HOURS = { 'Pine Tree Lane': '1.5', 'Studio Ubique': '4' };

// db/demo/todo.js: Deepak's blocked line, left open on purpose.
const SUGGESTED = { project: 'acme-seo', title: 'Redirect map for old URLs' };

const PLANNED_NOTE = 'Not worked on today. Its tasks stay open.';
const NOTICE =
  'Add the hours for each project and check each status. Tasks you ticked on Today are Done.';

test.afterAll(closeDemoData);

/**
 * A person's row on the Team board, in the "In office" group (which shows its first few people
 * and the rest behind "Show N more").
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} board
 * @param {string} name
 */
async function boardRow(page, board, name) {
  const inOffice = board
    .getByRole('rowgroup')
    .filter({ has: page.getByRole('button', { name: /^In office/ }) });
  const row = inOffice
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name, exact: true }) });
  const more = inOffice.getByRole('button', { name: /^Show \d+ more$/ });
  if ((await row.count()) === 0 && (await more.count()) > 0) await more.click();
  await expect(row).toBeVisible();
  return row;
}

test('an employee plans the day on Today, it becomes the report, and the PM sees it', async ({
  signInAs,
  baseURL,
}) => {
  const pm = await signInAs(PEOPLE.pm);
  await stubAi(pm);
  const deepakId = await userIdByEmail(PEOPLE.deepak.email);

  await test.step("the PM adds the owner's three projects", async () => {
    const pmId = await userIdByEmail(PEOPLE.pm.email);
    for (const { name, clientName, color } of PROJECTS) {
      const response = await write(pm, baseURL, 'post', '/api/projects', {
        name,
        clientName,
        color,
        pmId,
        memberIds: [deepakId],
      });
      expect(response.status(), await response.text()).toBe(201);
    }
  });

  const deepak = await signInAs(PEOPLE.deepak);
  await stubAi(deepak);
  const todo = deepak.getByRole('region', { name: "Today's to-do" });
  const group = (name) => todo.getByRole('group', { name, exact: true });

  await test.step('Today starts with an empty to-do', async () => {
    await open(deepak, '/today');
    const day = deepak.getByRole('region', { name: 'Your day' });
    const checkIn = day.getByRole('button', { name: 'Check in' });
    if ((await checkIn.count()) > 0) {
      await checkIn.click();
      await expect(toasts(deepak)).toContainText(/Checked in/);
    }
    await expect(todo.getByRole('heading', { name: "Today's to-do" })).toBeVisible();
    await expect(
      todo.getByText("What you'll work on today. It becomes your report."),
    ).toBeVisible();
    await expect(todo.getByRole('heading', { name: 'Plan your day' })).toBeVisible();
    // The open line from earlier this week is waiting in the reminder line.
    await expect(todo.getByText('Still open from past reports:')).toBeVisible();
    await expect(
      todo.getByRole('button', { name: new RegExp(`^${SUGGESTED.project} \\(\\d+\\)$`) }),
    ).toBeVisible();
    // "My tasks this week" left Today: its lines are the to-do or suggestions now.
    await expect(deepak.getByText('My tasks this week')).toHaveCount(0);
  });

  await test.step('paste the usual Slack list', async () => {
    await todo.getByRole('button', { name: 'Paste a list' }).click();
    const paste = deepak.getByRole('dialog', { name: 'Paste your to-do' });
    await paste.getByLabel('Your list').fill(OWNER_TEXT);
    await expect(paste.getByRole('status')).toHaveText('We found 3 projects and 5 tasks.');
    // Each heading matched its project exactly: its label, with "Change".
    for (const { heading } of PROJECTS) {
      await expect(
        paste.getByRole('button', { name: `Change the project for ${heading}` }),
      ).toBeVisible();
    }
    await paste.getByRole('button', { name: 'Add 5 tasks' }).click();
    await expect(toasts(deepak)).toContainText('Added 5 tasks.');
    await expect(paste).toHaveCount(0);

    for (const [name, lines] of Object.entries(REPORT)) {
      const list = group(name).getByRole('list', { name: `Tasks on ${name}` });
      await expect(list.getByRole('listitem')).toHaveCount(lines.length);
      for (const [title] of lines) {
        await expect(list.getByRole('checkbox', { name: `Done: ${title}` })).not.toBeChecked();
      }
    }
    await expect(todo.getByText('0 of 5 done', { exact: true })).toBeVisible();
  });

  await test.step('tick a line', async () => {
    const tick = group('Studio Ubique').getByRole('checkbox', { name: `Done: ${TICKED}` });
    const saved = deepak.waitForResponse(
      (response) =>
        /^\/api\/me\/todo\/lines\/\d+$/.test(new URL(response.url()).pathname) &&
        response.request().method() === 'PATCH',
    );
    await tick.check();
    expect((await saved).status()).toBe(200);
    await expect(tick).toBeChecked();
    await expect(todo.getByText('1 of 5 done', { exact: true })).toBeVisible();
  });

  await test.step('without a Slack connection there is no Post to Slack', async () => {
    await expect(todo.getByRole('button', { name: 'Post to Slack' })).toHaveCount(0);
    const post = await write(deepak, baseURL, 'post', '/api/me/todo/slack');
    expect(post.status()).toBe(409);
    expect((await post.json()).error).toMatchObject({
      code: 'CONFLICT',
      message: 'Slack posting is off.',
    });
  });

  await test.step('a project with an unfinished task suggests it: Done already', async () => {
    await todo.getByRole('button', { name: 'Add project' }).click();
    const picker = deepak.getByRole('dialog', { name: 'Pick a project' });
    await picker.getByRole('combobox', { name: 'Find a project' }).fill(SUGGESTED.project);
    const option = picker.getByRole('option', { name: new RegExp(`^${SUGGESTED.project}`) });
    await expect(option).toContainText(/\d+ still open/);
    await option.click();

    const box = group(SUGGESTED.project).getByRole('region', {
      name: 'Still open from past reports',
    });
    const row = box.getByRole('listitem').filter({ hasText: SUGGESTED.title });
    await expect(row).toContainText('Blocked');
    await expect(row).toContainText(/From \w+/);
    await box.getByRole('button', { name: `Done already: ${SUGGESTED.title}` }).click();
    await expect(toasts(deepak)).toContainText('Marked done.');
    await expect(todo.getByText(SUGGESTED.title)).toHaveCount(0);
    // Only the old line was closed: nothing was added to today.
    await expect(todo.getByText('1 of 5 done', { exact: true })).toBeVisible();

    // It is no longer suggested, after a reload too.
    const answer = await deepak.request.get('/api/me/todo');
    expect(answer.status()).toBe(200);
    const { suggestions } = (await answer.json()).data;
    const titles = Object.values(suggestions)
      .flat()
      .map((item) => item.title);
    expect(titles).not.toContain(SUGGESTED.title);
  });

  await test.step('the report has every line with its status', async () => {
    await open(deepak, '/report');
    await expect(deepak.getByRole('heading', { level: 1 })).toHaveText('Daily report');
    await expect(deepak.getByText(NOTICE)).toBeVisible();
    for (const [name, lines] of Object.entries(REPORT)) {
      const card = deepak.getByRole('region', { name, exact: true });
      for (const [index, [title, status]] of lines.entries()) {
        await expect(card.getByLabel(`Task ${index + 1} for ${name}`, { exact: true })).toHaveValue(
          title,
        );
        await expect(
          card.getByRole('combobox', { name: `Status of task ${index + 1} for ${name}` }),
        ).toHaveValue(status);
      }
      await expect(card.getByRole('combobox', { name: /^Status of task \d+ for / })).toHaveCount(
        lines.length,
      );
    }
    // The project picked only for its suggestion has no line, so it isn't in the report.
    await expect(deepak.getByRole('region', { name: SUGGESTED.project, exact: true })).toHaveCount(
      0,
    );
    await expect(
      deepak.getByRole('region', { name: 'Dotado', exact: true }).getByText(PLANNED_NOTE),
    ).toBeVisible();
  });

  await test.step('leave Dotado at 0 hours and submit', async () => {
    for (const [name, hours] of Object.entries(HOURS)) {
      const field = deepak
        .getByRole('region', { name, exact: true })
        .getByRole('textbox', { name: `Hours for ${name}` });
      await field.fill(hours);
      await field.blur();
    }
    await expect(deepak.getByText('5h 30m logged')).toBeVisible();
    await expect(
      deepak.getByRole('region', { name: 'Pine Tree Lane', exact: true }).getByText(PLANNED_NOTE),
    ).toHaveCount(0);

    await deepak.getByRole('button', { name: 'Submit report' }).click();
    await expect(toasts(deepak)).toContainText('Report submitted');
    await expect(deepak.getByRole('button', { name: 'Update report' })).toBeVisible();
    // Dotado stays in the report at 0 hours, so its task stays open, but Slack leaves it out.
    const dotado = deepak.getByRole('region', { name: 'Dotado', exact: true });
    await expect(dotado.getByLabel('Task 1 for Dotado', { exact: true })).toHaveValue(
      REPORT.Dotado[0][0],
    );
    const preview = deepak.getByRole('region', { name: 'Slack preview' });
    await expect(preview).toContainText('Project: Pine Tree Lane');
    await expect(preview).toContainText('Project: Studio Ubique');
    await expect(preview).not.toContainText('Dotado');
  });

  await test.step('Today shows the to-do as part of the report', async () => {
    await open(deepak, '/today');
    await expect(todo.getByText('1 of 5 done. Your report is in.')).toBeVisible();
    await expect(todo.getByRole('checkbox')).toHaveCount(0);
    await expect(todo.getByRole('button', { name: 'Paste a list' })).toHaveCount(0);
  });

  await test.step('the PM opens the to-do from the Team board', async () => {
    await open(pm, '/team');
    const board = pm.getByRole('table', { name: 'Team board' });
    const row = await boardRow(pm, board, PEOPLE.deepak.name);
    const projects = await cellUnder(board, row, 'Projects today');
    await expect(projects.getByText('Pine Tree Lane', { exact: true })).toBeVisible();
    await expect(projects.getByText('Studio Ubique', { exact: true })).toBeVisible();
    // A planned project doesn't read as worked.
    await expect(projects.getByText('Dotado', { exact: true })).toHaveCount(0);

    const button = projects.getByRole('button', { name: 'To-do: 1 of 5 done' });
    await button.click();
    const popover = pm.getByRole('dialog', { name: "Deepak's to-do" });
    await expect(popover).toBeVisible();
    for (const lines of Object.values(REPORT)) {
      for (const [title] of lines) await expect(popover).toContainText(title);
    }
    await expect(popover).toContainText('Dotado');
    // Posting is off, so the popover says nothing about Slack.
    await expect(popover).not.toContainText('Slack');
    await pm.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(button).toBeFocused();

    await button.click();
    await popover.getByRole('link', { name: `Open ${PEOPLE.deepak.name}'s page` }).click();
    await expect(pm).toHaveURL(new RegExp(`/team/${deepakId}$`));
    await expect(pm.getByRole('heading', { name: "Today's to-do" })).toBeVisible();
    await expect(pm.getByText('1 of 5 done', { exact: true })).toBeVisible();
  });

  await test.step('HR has no Team board', async () => {
    const neha = await signInAs(PEOPLE.neha);
    await stubAi(neha);
    await open(neha, '/team');
    await expect(neha).toHaveURL(/\/no-access$/);
    await expect(neha.getByRole('heading', { level: 1 })).toHaveText('No access');
    expect((await neha.request.get('/api/team/today')).status()).toBe(403);
    expect((await neha.request.get(`/api/team/${deepakId}`)).status()).toBe(403);
  });

  for (const page of [deepak, pm]) {
    await page.waitForLoadState('networkidle');
    expect(problemsOf(page), 'console and page errors').toEqual([]);
  }
});
