// CONTRACT 21: My settings. An employee opens it from the sidebar, switches the theme (it applies
// at once and stays after a reload) and back, keeps only "Submit report" in the report's top bar
// and turns the Slack preview off; a PM's page has no Daily report section. Every change saves at
// once (no Save button).
//
// Ankit Rana is the person: the demo leaves him checked in today with a draft report, so the
// report offers "Submit and check out" until he turns it off, and no other spec uses him. The
// e2e server has no Gemini key, so the AI section and the sparkles are not part of this spec.
import { PEOPLE, expect, open, problemsOf, test } from './support/fixtures.js';

const ANKIT = { email: 'ankit@company.com', name: 'Ankit Rana' };

/**
 * Runs a change on My settings and waits until the server saved it: the PATCH answered and the
 * top bar says "Saved".
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<void>} change
 */
async function saveChange(page, change) {
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/me/preferences') && response.request().method() === 'PATCH',
  );
  await change();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
}

/** The `data-theme` on <html>, or null when the page follows the computer. */
function themeOf(page) {
  return page.evaluate(() => document.documentElement.dataset.theme ?? null);
}

test('an employee changes the theme, the submit buttons and the Slack preview', async ({
  signInAs,
}) => {
  const ankit = await signInAs(ANKIT);
  const checkOut = ankit.getByRole('button', { name: 'Submit and check out' });
  const preview = ankit.getByRole('region', { name: 'Slack preview' });

  await test.step('the report starts with both submit buttons and the Slack preview', async () => {
    await open(ankit, '/report');
    await expect(ankit.getByRole('heading', { level: 1 })).toHaveText('Daily report');
    await expect(checkOut).toBeVisible();
    await expect(ankit.getByRole('button', { name: 'Submit report' })).toBeVisible();
    await expect(preview).toBeVisible();
  });

  await test.step('My settings opens from the sidebar', async () => {
    await ankit
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'My settings' })
      .click();
    await expect(ankit).toHaveURL(/\/my-settings$/);
    await expect(ankit.getByRole('heading', { level: 1 })).toHaveText('My settings');
    await expect(ankit.getByText('How Daybook looks and works for you')).toBeVisible();
    await expect(
      ankit.getByRole('navigation', { name: 'My settings sections' }).getByRole('link'),
    ).toHaveText(['Daily report', 'Notifications', 'Appearance']);
  });

  await test.step('Dark applies at once and stays after a reload', async () => {
    const theme = ankit.getByRole('group', { name: 'Theme' });
    const dark = theme.getByRole('button', { name: 'Dark' });
    await expect(theme.getByRole('button', { name: 'Match my computer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await themeOf(ankit)).toBeNull();

    await saveChange(ankit, () => dark.click());
    expect(await themeOf(ankit)).toBe('dark');

    await open(ankit, '/my-settings');
    expect(await themeOf(ankit)).toBe('dark');
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('Match my computer takes the theme back off', async () => {
    const theme = ankit.getByRole('group', { name: 'Theme' });
    await saveChange(ankit, () => theme.getByRole('button', { name: 'Match my computer' }).click());
    expect(await themeOf(ankit)).toBeNull();

    await open(ankit, '/my-settings');
    expect(await themeOf(ankit)).toBeNull();
    expect(await ankit.evaluate(() => localStorage.getItem('daybook-theme'))).toBeNull();
  });

  await test.step('Submit report only, and no Slack preview', async () => {
    const buttons = ankit.getByRole('group', { name: 'Submit buttons' });
    await saveChange(ankit, () => buttons.getByRole('button', { name: 'Submit report' }).click());
    await expect(buttons.getByRole('button', { name: 'Submit report' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const slack = ankit.getByRole('switch', { name: 'Show the Slack preview' });
    await expect(slack).toBeChecked();
    await saveChange(ankit, () => slack.uncheck());
    await expect(slack).not.toBeChecked();
  });

  await test.step('the report follows both settings', async () => {
    await open(ankit, '/report');
    await expect(ankit.getByRole('heading', { level: 1 })).toHaveText('Daily report');
    // Still checked in with a draft: only "Submit and check out" is left out.
    await expect(ankit.getByRole('button', { name: 'Submit report' })).toBeVisible();
    await expect(checkOut).toHaveCount(0);
    await expect(preview).toHaveCount(0);
  });

  await ankit.waitForLoadState('networkidle');
  expect(problemsOf(ankit), 'console and page errors').toEqual([]);
});

test('a PM has My settings without the Daily report section', async ({ signInAs }) => {
  const pm = await signInAs(PEOPLE.pm);
  await open(pm, '/team');
  await pm
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My settings' })
    .click();
  await expect(pm).toHaveURL(/\/my-settings$/);
  await expect(pm.getByRole('heading', { level: 1 })).toHaveText('My settings');

  await expect(
    pm.getByRole('navigation', { name: 'My settings sections' }).getByRole('link'),
  ).toHaveText(['Notifications', 'Appearance']);
  await expect(pm.getByRole('region', { name: 'Notifications' })).toBeVisible();
  await expect(pm.getByRole('region', { name: 'Appearance' })).toBeVisible();
  await expect(pm.getByRole('region', { name: 'Daily report' })).toHaveCount(0);
  await expect(pm.getByRole('group', { name: 'Submit buttons' })).toHaveCount(0);
  await expect(pm.getByRole('switch', { name: 'Show the Slack preview' })).toHaveCount(0);
  expect(problemsOf(pm), 'console and page errors').toEqual([]);
});
