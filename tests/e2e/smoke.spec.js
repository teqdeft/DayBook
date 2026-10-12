// Every main screen opens for the roles that can use it, without console or page errors, and the
// sidebar shows each role the right items (company rule: PMs have no Today or My log), with the
// screen's item marked as the current page. Screens are [path, page title, sidebar item].
import { PEOPLE, expect, open, problemsOf, sidebarLinks, test } from './support/fixtures.js';

const GREETING = (name) => new RegExp(`^Good (morning|afternoon|evening), ${name}$`);

const ROLES = [
  {
    role: 'Employee',
    person: PEOPLE.vishal,
    home: '/today',
    nav: ['Today', 'My log', 'Projects'],
    screens: [
      ['/today', GREETING('Vishal'), 'Today'],
      ['/report', 'Daily report', 'Today'],
      ['/log', 'My log', 'My log'],
      ['/projects', 'Projects', 'Projects'],
    ],
  },
  {
    role: 'PM',
    person: PEOPLE.pm,
    home: '/team',
    nav: ['Projects', 'Team', 'Screen time', 'Attendance', 'Requests'],
    screens: [
      ['/projects', 'Projects', 'Projects'],
      ['/team', 'Team dashboard', 'Team'],
      ['/screen-time', 'Screen time', 'Screen time'],
      ['/attendance', 'Attendance', 'Attendance'],
      ['/requests', 'Requests', 'Requests'],
    ],
  },
  {
    role: 'HR',
    person: PEOPLE.neha,
    home: '/today',
    nav: ['Today', 'My log', 'Attendance', 'People'],
    screens: [
      ['/today', GREETING('Neha'), 'Today'],
      ['/report', 'Daily report', 'Today'],
      ['/log', 'My log', 'My log'],
      ['/attendance', 'Attendance', 'Attendance'],
      ['/people', 'People', 'People'],
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
