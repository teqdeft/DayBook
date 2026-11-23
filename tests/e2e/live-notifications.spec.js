// CONTRACT 26 (Daybook 1.11): the live bell, its preview cards and its sound. Vishal Saini keeps
// Daybook open while new notifications arrive (written straight into the e2e database, as
// `notifications.notify` writes them); the page's live check runs at once through
// `window.__daybookLive.checkNow()` instead of every 30 s, and the sound is recorded by the test
// hook instead of played:
// - the first load is quiet; an important one shows one card, is announced and chimes once, and
//   the bell's count follows; Mark as read, Dismiss, a normal one (no chime with Important only),
//   three at once (one summary card), Open, the place under My log's top bar (no bell there), the
//   pause under the pointer and the open bell list (no card, the row joins the list);
// - two tabs both show the card and only one of them chimes;
// - on a phone the card comes from the top, is 44 px to tap, and two at most show;
// - My settings: Play sound, picking Ding (it stays and the next chime uses it), a save that
//   refreshes the page never skips a new one, Sound Off, All with the preview off; then the
//   defaults go back.
// The e2e server has no push keys, so desktop push never takes the sound (unit tests cover it).
// Every new notification is dated after Vishal's newest one, so it is the top of the bell.
import { PEOPLE, expect, expectTapSize, open, problemsOf, test } from './support/fixtures.js';
import { closeDemoData } from './support/demoData.js';
import {
  addNotification,
  bell,
  bellUnread,
  checkNow,
  chimes,
  expectAnnounced,
  notificationById,
  preview,
  previewCard,
  recordChimes,
  waitChimeGap,
  watchProblems,
} from './support/live.js';

const VISHAL = PEOPLE.vishal.email;
const REMIND = {
  type: 'attendance.remind_check_in',
  title: 'Neha Kapoor reminded you to check in',
  body: "You haven't checked in today. Check in on Today when you start work.",
  link: '/today',
};

test.afterAll(closeDemoData);

/** An important notification (a report reminder) with its own title. */
const important = (title, link = '/report') => ({ type: 'report.reminder', title, link });

/** A normal notification (added to a project) with its own title and body. */
const normal = (title, link = '/today') => ({
  type: 'project.member_added',
  title,
  body: 'You can log time on it from today.',
  link,
});

/** The bell button's name for a count. */
const bellName = (count) => (count > 0 ? `Notifications, ${count} unread` : 'Notifications');

/** Moves the pointer off the cards' corner, so a new card never appears under it (a pause). */
async function pointerAway(page) {
  const { height } = page.viewportSize();
  await page.mouse.move(320, height - 24);
}

/** Escape closes every card (focus isn't in one); they stay unread. */
async function closeCards(page) {
  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);
}

/** The read time of one notification, from the API. */
async function readAtOf(page, id) {
  return (await notificationById(page, id)).readAt;
}

test('new notifications show a card, chime once and follow the bell', async ({ signInAs }) => {
  test.setTimeout(240_000);
  const vishal = await signInAs(PEOPLE.vishal);
  await recordChimes(vishal.context());
  let unread = 0;

  await test.step('1. the first load is quiet', async () => {
    await open(vishal, '/today');
    await expect(bell(vishal)).toHaveAccessibleName(/^Notifications, \d+ unread$/);
    await vishal.waitForTimeout(3000);
    await checkNow(vishal);
    await expect(preview(vishal)).toHaveCount(0);
    expect(await chimes(vishal)).toEqual([]);
    unread = await bellUnread(vishal);
  });

  const remindCard = previewCard(vishal, REMIND.title);
  let remindId = 0;
  await test.step('2. an important one: one card, announced, one chime, one more unread', async () => {
    remindId = await addNotification(VISHAL, REMIND);
    await checkNow(vishal);
    await expect(preview(vishal).getByRole('listitem')).toHaveCount(1);
    await expect(remindCard).toContainText(REMIND.body);
    await expect(remindCard.locator('time')).toHaveText(/^Today at \d{1,2}:\d{2}\s[AP]M$/);
    await expect(remindCard.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      REMIND.link,
    );
    await expect(remindCard.getByRole('button', { name: 'Mark as read' })).toBeVisible();
    await expect(remindCard.getByRole('button', { name: 'Dismiss' })).toBeVisible();
    await expectAnnounced(vishal, `New notification: ${REMIND.title}`);
    await expect
      .poll(() => chimes(vishal))
      .toEqual([{ reason: 'batch', ids: [remindId], tone: 'chime' }]);
    await expect(bell(vishal)).toHaveAccessibleName(bellName(unread + 1));
  });

  await test.step('3. Mark as read: the card goes and the count goes back down', async () => {
    await remindCard.getByRole('button', { name: 'Mark as read' }).click();
    await pointerAway(vishal);
    await expect(remindCard).toHaveCount(0);
    await expect(bell(vishal)).toHaveAccessibleName(bellName(unread));
    await expect.poll(() => readAtOf(vishal, remindId)).not.toBeNull();
  });

  await test.step('4. a normal one: a card and no chime; Dismiss leaves it unread', async () => {
    await waitChimeGap(vishal);
    const leave = {
      type: 'leave.marked',
      title: 'Neha Kapoor marked leave for you: Fri, 27 Nov',
      body: 'Casual leave, paid.',
      link: '/today',
    };
    const id = await addNotification(VISHAL, leave);
    await checkNow(vishal);
    const card = previewCard(vishal, leave.title);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Dismiss' }).click();
    await pointerAway(vishal);
    await expect(card).toHaveCount(0);
    expect(await chimes(vishal), 'Important only').toHaveLength(1);
    expect(await readAtOf(vishal, id)).toBeNull();
    unread += 1;
    await expect(bell(vishal)).toHaveAccessibleName(bellName(unread));
  });

  await test.step('5. three at once: one summary card, one chime; See them opens the bell', async () => {
    await waitChimeGap(vishal);
    const three = [
      normal('Karan Mehta added you to acme-store'),
      important("Your report for Fri, 20 Nov isn't in yet."),
      normal('Karan Mehta added you to iwilltillimwell'),
    ];
    const ids = [];
    for (const item of three) ids.push(await addNotification(VISHAL, item));
    await checkNow(vishal);
    const newest = three.at(-1).title;
    const summary = previewCard(vishal, '3 new notifications');
    await expect(preview(vishal).getByRole('listitem')).toHaveCount(1);
    await expect(summary).toContainText(newest);
    await expect(summary).toContainText('and 2 more');
    await expectAnnounced(vishal, `3 new notifications. The newest: ${newest}`);
    await expect.poll(async () => (await chimes(vishal)).length).toBe(2);
    const chime = (await chimes(vishal))[1];
    expect(chime).toMatchObject({ reason: 'batch', tone: 'chime' });
    expect([...chime.ids].sort((a, b) => a - b)).toEqual(ids);
    unread += 3;
    await expect(bell(vishal)).toHaveAccessibleName(bellName(unread));

    await summary.getByRole('button', { name: 'See them' }).click();
    await pointerAway(vishal);
    const list = vishal.getByRole('dialog', { name: 'Notifications' });
    await expect(list).toBeVisible();
    await expect(bell(vishal)).toBeFocused();
    await expect(preview(vishal)).toHaveCount(0);
    const rows = list.getByRole('listitem');
    for (const [index, item] of [...three].reverse().entries()) {
      await expect(rows.nth(index)).toContainText(item.title);
    }
    await vishal.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
  });

  let shownAt = 0;
  const onLog = normal('Karan Mehta added you to Mobile app', '/log');
  await test.step('6. Open follows the link and marks it read; My log puts the card under its top bar', async () => {
    const approved = {
      type: 'report_edit.approved',
      title: 'Your edit request for Fri, 20 Nov was approved',
      body: 'You have 24 hours to change the report.',
      link: '/log',
    };
    const id = await addNotification(VISHAL, approved);
    await checkNow(vishal);
    const card = previewCard(vishal, approved.title);
    await card.getByRole('link', { name: 'Open' }).click();
    await pointerAway(vishal);
    await expect(vishal).toHaveURL(/\/log$/);
    await expect(vishal.getByRole('heading', { level: 1 })).toHaveText('My log');
    await expect(card).toHaveCount(0);
    await expect.poll(() => readAtOf(vishal, id)).not.toBeNull();

    await addNotification(VISHAL, onLog);
    await checkNow(vishal);
    shownAt = Date.now();
    const next = previewCard(vishal, onLog.title);
    await expect(next).toBeVisible();
    const header = await vishal.locator('#main header').boundingBox();
    const width = await vishal.evaluate(() => document.documentElement.clientWidth);
    const box = async () => (await next.boundingBox()) ?? { x: 0, y: 0, width: 0 };
    await expect
      .poll(async () => Math.round((await box()).y - (header.y + header.height)), {
        message: 'the card is 8 px under the top bar',
      })
      .toBe(8);
    await expect
      .poll(async () => Math.round(width - (await box()).x - (await box()).width), {
        message: "the card's right edge is 32 px from the window's",
      })
      .toBe(32);
  });

  await test.step('7. the card stays under the pointer and goes soon after it leaves', async () => {
    const card = previewCard(vishal, onLog.title);
    // Hover with about 2 s of its 6 s left: once the pointer leaves it gets at least 2 s again.
    await vishal.waitForTimeout(Math.max(0, shownAt + 4000 - Date.now()));
    await card.getByText(onLog.title).hover();
    await vishal.waitForTimeout(8000);
    await expect(card).toBeVisible();
    await pointerAway(vishal);
    await expect(card).toHaveCount(0, { timeout: 3000 });
  });

  await test.step('8. with the bell list open a new one joins the list, without a card', async () => {
    await open(vishal, '/today');
    await bell(vishal).click();
    const list = vishal.getByRole('dialog', { name: 'Notifications' });
    const rows = list.getByRole('listitem');
    await expect(rows.first()).toContainText(onLog.title);
    const item = normal('Karan Mehta added you to the website redesign');
    await addNotification(VISHAL, item);
    await checkNow(vishal);
    await expect(rows.first()).toContainText(item.title);
    await expectAnnounced(vishal, `New notification: ${item.title}`);
    await expect(preview(vishal)).toHaveCount(0);
    await vishal.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
  });

  expect(problemsOf(vishal), 'console and page errors').toEqual([]);
});

test('two tabs both show the card and only one chimes', async ({ signInAs }) => {
  test.setTimeout(120_000);
  const vishal = await signInAs(PEOPLE.vishal);
  await recordChimes(vishal.context());
  await open(vishal, '/today');
  const second = await vishal.context().newPage();
  const secondProblems = watchProblems(second);
  await open(second, '/log');
  await checkNow(second);
  await checkNow(vishal);
  await expect(preview(vishal)).toHaveCount(0);
  await expect(preview(second)).toHaveCount(0);

  const item = important("Your report for Thu, 19 Nov isn't in yet.");
  const id = await addNotification(VISHAL, item);
  await checkNow(vishal);
  await expect(previewCard(vishal, item.title)).toBeVisible();
  await expect(previewCard(second, item.title)).toBeVisible();
  const all = async () => [...(await chimes(vishal)), ...(await chimes(second))];
  await expect.poll(all).toEqual([{ reason: 'batch', ids: [id], tone: 'chime' }]);
  await vishal.waitForTimeout(1000);
  expect(await all(), 'one chime in all').toHaveLength(1);

  // A read in one tab closes the card in the other, even one held under the pointer.
  await previewCard(vishal, item.title).getByText(item.title).hover();
  await previewCard(second, item.title).getByRole('button', { name: 'Mark as read' }).click();
  await expect(previewCard(second, item.title)).toHaveCount(0);
  await expect(previewCard(vishal, item.title)).toHaveCount(0);

  await second.close();
  expect(problemsOf(vishal), 'console and page errors').toEqual([]);
  expect(secondProblems, 'console and page errors in the second tab').toEqual([]);
});

test('on a phone the card comes from the top, 44 px to tap, two at most', async ({ signInAs }) => {
  test.setTimeout(120_000);
  const vishal = await signInAs(PEOPLE.vishal);
  await recordChimes(vishal.context());
  await vishal.setViewportSize({ width: 390, height: 844 });
  await open(vishal, '/today');
  await checkNow(vishal);
  await expect(preview(vishal)).toHaveCount(0);

  await test.step('11. one card: 16 px from each side, at the top, 44 px buttons', async () => {
    await addNotification(VISHAL, REMIND);
    await checkNow(vishal);
    const card = previewCard(vishal, REMIND.title);
    await expect(card).toBeVisible();
    const box = async () => (await card.boundingBox()) ?? { x: 0, y: 0, width: 0 };
    await expect.poll(async () => Math.round((await box()).x)).toBe(16);
    await expect.poll(async () => Math.round((await box()).width)).toBe(358);
    await expect.poll(async () => Math.round((await box()).y)).toBeLessThanOrEqual(16);
    await expectTapSize(card.getByRole('link', { name: 'Open' }), 'Open');
    await expectTapSize(card.getByRole('button', { name: 'Mark as read' }), 'Mark as read');
    await expectTapSize(card.getByRole('button', { name: 'Dismiss' }), 'Dismiss');
    await card.getByRole('button', { name: 'Dismiss' }).click();
    await pointerAway(vishal);
    await expect(card).toHaveCount(0);
  });

  await test.step('three one after another: two cards at most, the newest on top', async () => {
    const titles = [
      "Your report for Wed, 18 Nov isn't in yet.",
      "Your report for Tue, 17 Nov isn't in yet.",
      "Your report for Mon, 16 Nov isn't in yet.",
    ];
    const cards = preview(vishal).getByRole('listitem');
    for (const [index, title] of titles.entries()) {
      await addNotification(VISHAL, important(title));
      await checkNow(vishal);
      await expect(cards).toHaveCount(Math.min(index + 1, 2));
      await expect(cards.first()).toContainText(title);
    }
    await expect(cards.nth(1)).toContainText(titles[1]);
  });

  expect(problemsOf(vishal), 'console and page errors').toEqual([]);
});

test('My settings: the sound, the sound choice and the preview change what new ones do', async ({
  signInAs,
}) => {
  test.setTimeout(240_000);
  const vishal = await signInAs(PEOPLE.vishal);
  await recordChimes(vishal.context());
  const section = vishal.getByRole('region', { name: 'Notifications' });
  const sound = section.getByRole('group', { name: 'Sound', exact: true });
  const tone = section.getByRole('group', { name: 'Choose a sound' });
  const showPreview = section.getByRole('switch', { name: 'Show a preview' });
  const ring = section.getByRole('switch', { name: 'Ring the bell for unread notifications' });
  const pressed = (group, name) =>
    expect(group.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

  /**
   * Runs a change and waits until it is saved and the page has been refreshed from the server
   * (that refresh brings the new value to this tab's live bell).
   */
  async function saveChange(change) {
    const saved = vishal.waitForResponse(
      (response) =>
        response.url().endsWith('/api/me/preferences') && response.request().method() === 'PATCH',
    );
    const refreshed = vishal.waitForResponse((response) => {
      const headers = response.request().headers();
      return (
        headers.rsc === '1' &&
        !headers['next-router-prefetch'] &&
        new URL(response.url()).pathname === '/my-settings'
      );
    });
    await change();
    expect((await saved).status()).toBe(200);
    await expect(vishal.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await (await refreshed).finished();
  }

  await test.step('10. the defaults, and Play sound plays the chosen one', async () => {
    await open(vishal, '/my-settings');
    await pressed(sound, 'Important only');
    await pressed(tone, 'Chime');
    await expect(showPreview).toBeChecked();
    await section.getByRole('button', { name: 'Play sound' }).click();
    await expect.poll(() => chimes(vishal)).toEqual([{ reason: 'test', ids: [], tone: 'chime' }]);
  });

  await test.step('picking Ding plays it, keeps it, and the next chime is Ding', async () => {
    await saveChange(() => tone.getByRole('button', { name: 'Ding' }).click());
    await expect
      .poll(() => chimes(vishal))
      .toEqual([
        { reason: 'test', ids: [], tone: 'chime' },
        { reason: 'test', ids: [], tone: 'ding' },
      ]);
    await open(vishal, '/my-settings');
    await pressed(tone, 'Ding');

    await waitChimeGap(vishal);
    const item = important("Your report for Fri, 13 Nov isn't in yet.");
    const id = await addNotification(VISHAL, item);
    await checkNow(vishal);
    await expect(previewCard(vishal, item.title)).toBeVisible();
    await expect.poll(() => chimes(vishal)).toEqual([{ reason: 'batch', ids: [id], tone: 'ding' }]);
    await closeCards(vishal);
  });

  await test.step('a save refreshes the page, and a new one still shows its card', async () => {
    const item = normal('Karan Mehta added you to the support desk');
    await addNotification(VISHAL, item);
    await saveChange(() => ring.uncheck());
    await saveChange(() => ring.check());
    await checkNow(vishal);
    await expect(previewCard(vishal, item.title)).toBeVisible();
    await closeCards(vishal);
  });

  await test.step('Sound Off: a card and no chime', async () => {
    await saveChange(() => sound.getByRole('button', { name: 'Off' }).click());
    await waitChimeGap(vishal);
    const before = await chimes(vishal);
    const item = important("Your report for Thu, 12 Nov isn't in yet.");
    await addNotification(VISHAL, item);
    await checkNow(vishal);
    await expect(previewCard(vishal, item.title)).toBeVisible();
    await vishal.waitForTimeout(500);
    expect(await chimes(vishal), 'no chime with Off').toEqual(before);
    await closeCards(vishal);
  });

  await test.step('All with the preview off: a normal one chimes and shows no card', async () => {
    await saveChange(() => sound.getByRole('button', { name: 'All' }).click());
    await saveChange(() => showPreview.uncheck());
    await waitChimeGap(vishal);
    const before = await chimes(vishal);
    const item = normal('Karan Mehta added you to the brand refresh');
    const id = await addNotification(VISHAL, item);
    await checkNow(vishal);
    await expect
      .poll(() => chimes(vishal))
      .toEqual([...before, { reason: 'batch', ids: [id], tone: 'ding' }]);
    await expect(preview(vishal)).toHaveCount(0);
  });

  await test.step('the defaults go back', async () => {
    await saveChange(() => sound.getByRole('button', { name: 'Important only' }).click());
    await saveChange(() => showPreview.check());
    await saveChange(() => tone.getByRole('button', { name: 'Chime' }).click());
    await open(vishal, '/my-settings');
    await pressed(sound, 'Important only');
    await pressed(tone, 'Chime');
    await expect(showPreview).toBeChecked();
    await expect(ring).toBeChecked();
  });

  expect(problemsOf(vishal), 'console and page errors').toEqual([]);
});
