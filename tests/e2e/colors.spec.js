// CONTRACT 23 (Daybook 1.08). The Admin follows the Company overview's "Pending requests" card to
// Requests, and both count the same. A PM picks Yellow, then Plum from More colours, closes the
// panel with Escape while the drawer stays open (focus shows the primary ring on the chosen colour
// too), saves and sees the colour on the projects list; a colour from "Any colour" that is too
// light or too dark to see is refused in the drawer.
//
// The demo data gives greenleaf-shop the yellow preset; the PM's Proposals is teal. Every
// /api/ai/** request is answered in the browser (support/projectPlan.js), so nothing reaches
// Google.
import { PEOPLE, expect, open, problemsOf, test, toasts } from './support/fixtures.js';
import { stubAi } from './support/projectPlan.js';

const EDITED = 'Proposals';
const YELLOW = 'greenleaf-shop';
const PLUM = '#9c3fb8';
const PRESETS = ['Blue', 'Green', 'Violet', 'Orange', 'Teal', 'Pink', 'Yellow'];
const MORE = ['Coral', 'Brown', 'Olive', 'Lime', 'Sky', 'Plum', 'Magenta', 'Slate'];
const TOO_LIGHT = 'This colour is too light to see. Pick a darker one.';
const TOO_DARK = 'This colour is too dark to see in the dark theme. Pick a lighter one.';
/** A focused dot in the light theme: a 2 px --surface gap, then 2 px of --primary. */
const FOCUS_RING = 'rgb(255, 255, 255) 0px 0px 0px 2px, rgb(56, 72, 214) 0px 0px 0px 4px';

/** Signs in with every AI request stubbed, and opens a path. */
async function openAs(signInAs, person, path) {
  const page = await signInAs(person);
  await stubAi(page);
  await open(page, path);
  return page;
}

/** The project's letter square (aria-hidden) in its row of the projects table. */
function squareOf(page, name) {
  const row = page
    .getByRole('table', { name: 'Active projects' })
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name, exact: true }) });
  return row.getByRole('cell').first().locator('span[aria-hidden="true"]').first();
}

/** Opens the Edit project drawer from a row's "⋯" menu; returns the drawer and its colour parts. */
async function openEdit(page, name) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Edit project' });
  await expect(drawer).toBeVisible();
  const colours = drawer.getByRole('group', { name: 'Colour label' });
  return {
    drawer,
    colours,
    more: colours.getByRole('button', { name: /^More colours/ }),
    panel: colours.getByRole('group', { name: 'More colours' }),
  };
}

/** The accessible names of the elements a locator finds, in order. */
const labels = (locator) =>
  locator.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')));

const WAITING = {
  edit: 'edits',
  edits: 'edits',
  'new project': 'projects',
  'new projects': 'projects',
  fix: 'corrections',
  fixes: 'corrections',
};

/**
 * The card's sub text back into counts: '2 edits, 1 new project, 1 fix' or 'Nothing waiting'.
 * @param {string} sub
 */
function waitingCounts(sub) {
  const counts = { edits: 0, projects: 0, corrections: 0 };
  if (sub === 'Nothing waiting') return counts;
  for (const part of sub.split(', ')) {
    const [, count, what] = /^(\d+) (.+)$/.exec(part) ?? [];
    if (!WAITING[what]) throw new Error(`Unexpected part "${part}" in the sub text "${sub}"`);
    counts[WAITING[what]] = Number(count);
  }
  return counts;
}

test('the Admin follows Pending requests to Requests, and both count the same', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.ceo, '/overview');
  const card = page.getByRole('link', { name: /^Pending requests / });
  let counts;

  await test.step('the card is one link, named by its text', async () => {
    await expect(card).toHaveAttribute('href', '/requests');
    const text = (await card.innerText()).replace(/\s+/g, ' ').trim();
    const [, value, sub] = /^Pending requests (\d+) (.+)$/.exec(text) ?? [];
    expect(sub, `card text "${text}"`).toBeTruthy();
    counts = waitingCounts(sub);
    expect(Number(value)).toBe(counts.edits + counts.projects + counts.corrections);
    // The demo has report edits and a project request waiting (so the card goes to Requests),
    // and attendance fixes from employees.
    expect(counts.edits + counts.projects).toBeGreaterThan(0);
    expect(counts.corrections).toBeGreaterThan(0);
    // The chevron is hidden, so the name is the card's text.
    await expect(card).toHaveAccessibleName(text);
    await card.hover();
    await expect(card).toHaveCSS('text-decoration-line', 'none');
  });

  await test.step('Requests shows the same counts', async () => {
    await card.click();
    await expect(page).toHaveURL(/\/requests$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Requests');
    const pills = page.getByRole('group', { name: 'Request type' });
    await expect(
      pills.getByRole('link', { name: `Report edits (${counts.edits})`, exact: true }),
    ).toBeVisible();
    await expect(
      pills.getByRole('link', { name: `New projects (${counts.projects})`, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(`${counts.edits + counts.projects} waiting for you`)).toBeVisible();
  });

  await test.step('the fixes line counts the attendance fixes and opens Attendance', async () => {
    const n = counts.corrections;
    const line = page.getByText(
      `${n} attendance ${n === 1 ? 'fix is' : 'fixes are'} waiting on Attendance.`,
    );
    await expect(line).toBeVisible();
    await line.getByRole('link', { name: 'Open attendance' }).click();
    await expect(page).toHaveURL(/\/attendance$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Attendance');
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('a PM picks Yellow, then Plum from More colours, and the list shows it', async ({
  signInAs,
}) => {
  const page = await openAs(signInAs, PEOPLE.pm, '/projects');

  await test.step('the demo’s yellow project shows the yellow label', async () => {
    const square = squareOf(page, YELLOW);
    await expect(square).toHaveClass(/yellow/);
    // --label-yellow-bg and --label-yellow-text in the light theme.
    await expect(square).toHaveCSS('background-color', 'rgb(246, 242, 192)');
    await expect(square).toHaveCSS('color', 'rgb(86, 80, 0)');
  });

  const { drawer, colours, more, panel } = await openEdit(page, EDITED);
  const plum = panel.getByRole('button', { name: 'Plum', exact: true });

  await test.step('seven presets, then More colours; Yellow is picked', async () => {
    expect(await labels(colours.getByRole('radio'))).toEqual(PRESETS);
    await expect(colours.getByRole('radio', { name: 'Teal' })).toBeChecked();
    await expect(more).toHaveAccessibleName('More colours');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await colours.getByRole('radio', { name: 'Yellow' }).check();
    await expect(colours.getByRole('radio', { name: 'Yellow' })).toBeChecked();
  });

  await test.step('Plum from More colours replaces it and closes the panel', async () => {
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    expect(await labels(panel.getByRole('button'))).toEqual(MORE);
    await expect(plum).toHaveAttribute('aria-pressed', 'false');
    await plum.click();
    await expect(panel).toBeHidden();
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toHaveAccessibleName('More colours, custom colour chosen');
    await expect(colours.getByRole('radio', { checked: true })).toHaveCount(0);
  });

  await test.step('Escape in the panel closes the panel, not the drawer', async () => {
    await more.click();
    await expect(plum).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByLabel('Any colour')).toHaveValue(PLUM);
    // By keyboard from the button: Coral, Brown, Olive, Lime, Sky, Plum.
    for (let step = 0; step <= MORE.indexOf('Plum'); step += 1) await page.keyboard.press('Tab');
    await expect(plum).toBeFocused();
    await expect(plum.locator('span')).toHaveCSS('box-shadow', FOCUS_RING);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    // Focus shows the primary ring on the custom-filled button too, not its colour ring.
    await expect(more.locator('span')).toHaveCSS('box-shadow', FOCUS_RING);
  });

  await test.step('saved, the list shows Plum', async () => {
    await drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(toasts(page)).toContainText('Changes saved');
    await expect(drawer).toBeHidden();
    const square = squareOf(page, EDITED);
    await expect(square).toHaveClass(/custom/);
    await expect(square).toHaveAttribute('style', new RegExp(`--project:\\s*${PLUM}`));
  });

  await test.step('a preset replaces the custom colour again', async () => {
    const again = await openEdit(page, EDITED);
    await expect(again.more).toHaveAccessibleName('More colours, custom colour chosen');
    const teal = again.colours.getByRole('radio', { name: 'Teal' });
    await teal.check();
    await expect(again.more).toHaveAccessibleName('More colours');
    // By keyboard to Pink and back: the checked dot shows the primary ring, not its colour ring.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(teal).toBeChecked();
    await expect(teal).toBeFocused();
    await expect(teal.locator('xpath=following-sibling::span')).toHaveCSS('box-shadow', FOCUS_RING);
    await again.drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(again.drawer).toBeHidden();
    const square = squareOf(page, EDITED);
    await expect(square).toHaveClass(/teal/);
    await expect(square).not.toHaveAttribute('style', /--project/);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('a colour too light or too dark to see is refused in the drawer', async ({ signInAs }) => {
  const page = await openAs(signInAs, PEOPLE.pm, '/projects');
  const { drawer, colours, more, panel } = await openEdit(page, EDITED);
  const input = panel.getByLabel('Any colour');
  const error = colours.getByRole('alert');

  await test.step('too light, then too dark: the message shows and nothing changes', async () => {
    await more.click();
    // Playwright sets the colour input's value and sends input and change, like closing the picker.
    await input.fill('#f4f4f4');
    await expect(error).toHaveText(TOO_LIGHT);
    await expect(input).toHaveAccessibleDescription(TOO_LIGHT);
    await expect(panel).toBeVisible();
    await expect(more).toHaveAccessibleName('More colours');
    await expect(colours.getByRole('radio', { name: 'Teal' })).toBeChecked();

    await input.fill('#1c1c1c');
    await expect(error).toHaveText(TOO_DARK);
    await expect(colours.getByRole('radio', { name: 'Teal' })).toBeChecked();
  });

  await test.step('a colour that can be seen applies and clears the message', async () => {
    await input.fill('#2e7d5b');
    await expect(error).toHaveCount(0);
    await expect(more).toHaveAccessibleName('More colours, custom colour chosen');
    await expect(colours.getByRole('radio', { checked: true })).toHaveCount(0);
  });

  await test.step('Escape closes the panel, then the drawer; nothing was saved', async () => {
    await input.focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(more).toBeFocused();
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(squareOf(page, EDITED)).toHaveClass(/teal/);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});
