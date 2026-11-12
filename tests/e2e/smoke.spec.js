// Every main screen opens for the roles that can use it, without console or page errors, and the
// sidebar shows each role the right items (company rule: PMs have no Today or My log), with the
// screen's item marked as the current page. Screens are [path, page title, sidebar item]. A
// project page opens on each of its four tabs (CONTRACT 22), and the hours range works both on
// the projects table and on a project's Hours tab.
import { PEOPLE, expect, open, problemsOf, sidebarLinks, test } from './support/fixtures.js';

const GREETING = (name) => new RegExp(`^Good (morning|afternoon|evening), ${name}$`);

const ROLES = [
  {
    role: 'Employee',
    person: PEOPLE.vishal,
    home: '/today',
    nav: ['Today', 'My log', 'Projects', 'My settings'],
    screens: [
      ['/today', GREETING('Vishal'), 'Today'],
      ['/report', 'Daily report', 'Today'],
      ['/log', 'My log', 'My log'],
      ['/projects', 'Projects', 'Projects'],
      ['/my-settings', 'My settings', 'My settings'],
    ],
  },
  {
    role: 'PM',
    person: PEOPLE.pm,
    home: '/team',
    nav: ['Projects', 'Team', 'Screen time', 'Attendance', 'Requests', 'My settings'],
    screens: [
      ['/projects', 'Projects', 'Projects'],
      ['/team', 'Team dashboard', 'Team'],
      ['/screen-time', 'Screen time', 'Screen time'],
      ['/attendance', 'Attendance', 'Attendance'],
      ['/requests', 'Requests', 'Requests'],
      ['/my-settings', 'My settings', 'My settings'],
    ],
  },
  {
    role: 'HR',
    person: PEOPLE.neha,
    home: '/today',
    nav: ['Today', 'My log', 'Attendance', 'People', 'My settings'],
    screens: [
      ['/today', GREETING('Neha'), 'Today'],
      ['/report', 'Daily report', 'Today'],
      ['/log', 'My log', 'My log'],
      ['/attendance', 'Attendance', 'Attendance'],
      ['/people', 'People', 'People'],
      ['/my-settings', 'My settings', 'My settings'],
    ],
  },
  {
    role: 'Admin',
    person: PEOPLE.ceo,
    home: '/overview',
    nav: [
      'Overview',
      'Team',
      'Screen time',
      'Projects',
      'Attendance',
      'People',
      'Roles',
      'Settings',
      'My settings',
    ],
    screens: [
      ['/overview', 'Company overview', 'Overview'],
      ['/team', 'Team dashboard', 'Team'],
      ['/screen-time', 'Screen time', 'Screen time'],
      ['/projects', 'Projects', 'Projects'],
      ['/attendance', 'Attendance', 'Attendance'],
      ['/people', 'People', 'People'],
      ['/settings/roles', 'Roles and permissions', 'Roles'],
      ['/settings', 'Settings', 'Settings'],
      ['/my-settings', 'My settings', 'My settings'],
    ],
  },
];

/** A sidebar label, optionally followed by its badge ("Requests 3 waiting"). */
const navItem = (label) => new RegExp(`^${label}(\\s*\\d+\\+?\\s*waiting)?$`);

for (const { role, person, home, nav, screens } of ROLES) {
  test(`${role}: the sidebar and every main screen`, async ({ signInAs }) => {
    const page = await signInAs(person);

    // "/" sends each role to its start page.
    await open(page, '/');
    await expect(page).toHaveURL(new URL(home, page.url()).href);
    await expect(sidebarLinks(page)).toHaveText(nav.map(navItem));

    for (const [path, title, item] of screens) {
      await test.step(path, async () => {
        const response = await open(page, path);
        expect(response?.status(), `${path} answers 200`).toBe(200);
        await expect(page).toHaveURL(new URL(path, page.url()).href);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
        await expect(sidebarLinks(page)).toHaveText(nav.map(navItem));
        await expect(page.locator('nav[aria-label="Main"] [aria-current="page"]')).toHaveText(
          navItem(item),
        );
        // Errors logged after hydration (a mismatch, a failed request) count for this screen.
        await page.waitForLoadState('networkidle');
        expect(problemsOf(page), `console and page errors on ${path}`).toEqual([]);
      });
    }
  });
}

test('PM: an employee detail opens from the team board', async ({ signInAs }) => {
  const page = await signInAs(PEOPLE.pm);
  await open(page, '/team');
  await page.getByRole('link', { name: PEOPLE.vishal.name, exact: true }).click();
  await expect(page).toHaveURL(/\/team\/\d+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PEOPLE.vishal.name);
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('PM: the hours range on the projects table stays with the tabs and the search', async ({
  signInAs,
}) => {
  const page = await signInAs(PEOPLE.pm);
  await open(page, '/projects');
  const range = page.getByRole('group', { name: 'Hours range' });
  const hoursHeader = (name) => page.getByRole('columnheader', { name, exact: true });

  await test.step('it opens on this week', async () => {
    await expect(range.getByRole('link', { name: 'This week' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(hoursHeader('Hours this week')).toBeVisible();
  });

  await test.step('a range follows the status tab and the search', async () => {
    await range.getByRole('link', { name: 'This month' }).click();
    await expect(page).toHaveURL(/\/projects\?range=month$/);
    await expect(hoursHeader('Hours this month')).toBeVisible();
    await page.getByRole('link', { name: /^On hold \(\d+\)$/ }).click();
    await expect(page).toHaveURL(/\/projects\?status=on_hold&range=month$/);
    await expect(
      hoursHeader('Hours this month').or(page.getByText('No on hold projects')),
    ).toBeVisible();
    await page.getByRole('link', { name: /^Active \(\d+\)$/ }).click();
    await expect(page).toHaveURL(/\/projects\?range=month$/);
    await page.getByRole('searchbox', { name: 'Search projects' }).fill('acme');
    await expect(page).toHaveURL(/\/projects\?range=month&q=acme$/);
    await expect(page.getByRole('link', { name: /^Completed \(\d+\)$/ })).toHaveAttribute(
      'href',
      '/projects?status=completed&q=acme&range=month',
    );
  });

  await test.step('all time shows one total', async () => {
    await range.getByRole('link', { name: 'All time' }).click();
    await expect(page).toHaveURL(/range=all/);
    await expect(hoursHeader('Total hours')).toBeVisible();
    await expect(page.getByText(/^\d+h( \d+m)? total$/)).toHaveCount(0);
  });

  await test.step('a custom range keeps the search, and a wrong one says so', async () => {
    await range.getByRole('link', { name: 'Custom' }).click();
    await expect(page).toHaveURL(
      /q=acme&range=custom&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/,
    );
    await expect(hoursHeader('Hours in range')).toBeVisible();
    await page.getByLabel('From').fill('2026-10-31');
    await page.getByLabel('To', { exact: true }).fill('2026-10-01');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByText('The start date must be on or before the end date.')).toBeVisible();
    await expect(page).toHaveURL(/q=acme/);
    await expect(hoursHeader('Hours this week')).toBeVisible();
    await page.getByLabel('To', { exact: true }).fill('2026-11-15');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page).toHaveURL(/q=acme&range=custom&from=2026-10-31&to=2026-11-15$/);
    await expect(hoursHeader('Hours in range')).toBeVisible();
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

const PROJECT_TABS = ['Overview', 'Phases', 'Timeline', 'Hours'];

for (const [role, person] of [
  ['PM', PEOPLE.pm],
  ['Admin', PEOPLE.ceo],
]) {
  test(`${role}: a project page opens on each of its tabs`, async ({ signInAs }) => {
    const page = await signInAs(person);
    await open(page, '/projects');
    await page.getByRole('link', { name: 'acme-store', exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/\d+$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('acme-store');
    await expect(page.locator('nav[aria-label="Main"] [aria-current="page"]')).toHaveText(
      'Projects',
    );
    const tabs = page.getByRole('navigation', { name: 'Project sections' });
    await expect(tabs.getByRole('link')).toHaveText(PROJECT_TABS);
    for (const tab of PROJECT_TABS) {
      await test.step(tab, async () => {
        await tabs.getByRole('link', { name: tab }).click();
        await expect(page).toHaveURL(new RegExp(`\\?tab=${tab.toLowerCase()}$`));
        await expect(tabs.getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
        await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
        await page.waitForLoadState('networkidle');
        expect(problemsOf(page), `console and page errors on ${tab}`).toEqual([]);
      });
    }
  });
}

test('PM: a team board bar opens a project’s Hours tab, and its range keeps the tab', async ({
  signInAs,
}) => {
  const page = await signInAs(PEOPLE.pm);
  await open(page, '/team');
  const bar = page.locator('a[href*="?tab=hours&range=week"]').first();
  const href = await bar.getAttribute('href');
  await bar.click();
  await expect(page).toHaveURL(new URL(href, page.url()).href);
  const tabs = page.getByRole('navigation', { name: 'Project sections' });
  await expect(tabs.getByRole('link', { name: 'Hours' })).toHaveAttribute('aria-current', 'page');
  const range = page.getByRole('group', { name: 'Range' });
  await expect(range.getByRole('link', { name: 'This week' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await range.getByRole('link', { name: 'This month' }).click();
  await expect(page).toHaveURL(/\?tab=hours&range=month$/);
  await expect(range.getByRole('link', { name: 'This month' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await range.getByRole('link', { name: 'Custom' }).click();
  await expect(page).toHaveURL(/\?tab=hours&range=custom&from=\d{4}-\d{2}-\d{2}&to=/);
  await page.getByLabel('From').fill('2026-10-01');
  await page.getByLabel('To', { exact: true }).fill('2026-10-31');
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(page).toHaveURL(/\?tab=hours&range=custom&from=2026-10-01&to=2026-10-31$/);
  await expect(tabs.getByRole('link', { name: 'Hours' })).toHaveAttribute('aria-current', 'page');
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});

test('Employee: the project search filters the cards by name', async ({ signInAs }) => {
  const page = await signInAs(PEOPLE.vishal);
  await open(page, '/projects');
  const cards = page.getByRole('article');
  const box = page.getByRole('searchbox', { name: 'Search projects' });
  const all = await cards.count();
  expect(all).toBeGreaterThan(1);

  await test.step('typing keeps the cards whose name matches, in the address too', async () => {
    await box.fill('ACME');
    await expect(page).toHaveURL(/\/projects\?q=ACME$/);
    await expect(page.getByText(/^\d+ active projects? match(es)?$/)).toBeAttached();
    const names = await cards.getByRole('heading', { level: 2 }).allInnerTexts();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.toLowerCase()).toContain('acme');
    await expect(page.getByRole('link', { name: /^Completed \(\d+\)$/ })).toHaveAttribute(
      'href',
      '/projects?status=completed&q=ACME',
    );
  });

  await test.step('no match says so, and Clear search brings every card back', async () => {
    await box.fill('no-such-project');
    await expect(cards).toHaveCount(0);
    await expect(page.getByText('No projects match “no-such-project”')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('');
    await expect(cards).toHaveCount(all);
    await expect(page).toHaveURL(/\/projects$/);
  });
  expect(problemsOf(page), 'console and page errors').toEqual([]);
});
