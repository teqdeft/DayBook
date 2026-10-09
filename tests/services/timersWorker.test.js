// The timer worker jobs (CONTRACT 15): close-open-timers ends timers forgotten overnight (end-time
// rules and the notification); timer-reminders reminds people with no timer in required mode.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { timers } from '@/modules/timers';
import { closeOpenTimersJob } from '@/worker/jobs/closeOpenTimers';
import { timerRemindersJob } from '@/worker/jobs/timerReminders';
import { forgetHandledKeysForTests } from '@/worker/runOnce';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { checkIn, createProject } from './dashboardKit.js';
import {
  addSegment,
  at,
  breakRow,
  entriesOf,
  insertEntry,
  setClock,
  TODAY,
  YESTERDAY,
} from './timersKit.js';

vi.mock('@/modules/reports', () => ({ reports: {} }));

let pm;
let acme;

const notes = (type, user) =>
  db('notifications')
    .where({ type, ...(user && { userId: user.id }) })
    .orderBy('id');

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
});

beforeEach(async () => {
  forgetHandledKeysForTests();
  await setSettings({ timers_mode: 'optional', timer_reminder_minutes: 20 });
  await db('timeEntries').del();
  await db('notifications').del();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('closeForgotten', () => {
  let byCheckout;
  let bySeen;
  let byStart;
  let earlyOut;
  let seenBefore;
  let lateOut;
  let stillToday;
  let older;
  let lockedAfter;

  beforeAll(async () => {
    const person = (name) => createUser({ name });
    byCheckout = await person('Cleo Checkout');
    bySeen = await person('Sam Seen');
    byStart = await person('Stan Start');
    earlyOut = await person('Eli Early');
    seenBefore = await person('Bea Before');
    lateOut = await person('Lou Late');
    stillToday = await person('Tia Today');
    older = await person('Otis Older');
    lockedAfter = await person('Lena Locked');
    await checkIn(byCheckout, YESTERDAY, { in: '09:30', out: '18:30' });
    await checkIn(bySeen, YESTERDAY, { in: '09:30' });
    await addSegment(bySeen, 'active', '17:00', '18:20', YESTERDAY);
    await addSegment(bySeen, 'idle', '18:20', '18:42', YESTERDAY);
    await checkIn(byStart, YESTERDAY, { in: '09:30', checkoutStatus: 'missing' });
    await checkIn(earlyOut, YESTERDAY, { in: '09:30', out: '16:00' });
    await addSegment(earlyOut, 'active', '16:30', '17:45', YESTERDAY);
    await checkIn(seenBefore, YESTERDAY, { in: '09:30' });
    await addSegment(seenBefore, 'active', '09:30', '15:00', YESTERDAY);
    // HR set a check-out after midnight: the timer still ends at the end of its day.
    await checkIn(lateOut, YESTERDAY, {
      in: '09:30',
      checkOutAt: at('00:30', TODAY),
      checkoutStatus: 'corrected',
    });
    // The screen stayed locked all evening: only active time counts as seen.
    await checkIn(lockedAfter, YESTERDAY, { in: '09:00', checkoutStatus: 'missing' });
    await addSegment(lockedAfter, 'active', '09:00', '18:00', YESTERDAY);
    await addSegment(lockedAfter, 'locked', '18:01', '23:59', YESTERDAY);
  });

  it('ends each timer by the midnight rules and tells its person', async () => {
    setClock('00:10');
    await insertEntry(byCheckout, acme, { date: YESTERDAY, from: '17:00' });
    await insertEntry(bySeen, acme, { date: YESTERDAY, from: '17:00' });
    await insertEntry(byStart, acme, { date: YESTERDAY, from: '16:00' });
    await insertEntry(earlyOut, acme, { date: YESTERDAY, from: '17:00' });
    await insertEntry(seenBefore, acme, { date: YESTERDAY, from: '16:00' });
    await insertEntry(lateOut, acme, { date: YESTERDAY, from: '23:00' });
    await insertEntry(stillToday, acme, { from: '00:05' });
    await insertEntry(older, acme, { date: '2026-09-25', from: '10:00' }); // days ago, no data
    await insertEntry(lockedAfter, acme, { date: YESTERDAY, from: '09:05' });

    expect(await timers.closeForgotten(TODAY)).toEqual({ closed: 8 });

    const endOf = async (user) => (await entriesOf(user))[0];
    expect(await endOf(byCheckout)).toMatchObject({
      endedAt: at('18:30', YESTERDAY),
      stopReason: 'midnight',
    });
    // Idle time after the last active moment doesn't count.
    expect((await endOf(bySeen)).endedAt).toEqual(at('18:20', YESTERDAY));
    expect((await endOf(lockedAfter)).endedAt).toEqual(at('18:00', YESTERDAY));
    expect((await endOf(byStart)).endedAt).toEqual(at('16:00', YESTERDAY));
    expect((await endOf(earlyOut)).endedAt).toEqual(at('17:45', YESTERDAY));
    expect((await endOf(seenBefore)).endedAt).toEqual(at('16:00', YESTERDAY));
    expect((await endOf(lateOut)).endedAt).toEqual(at('00:00', TODAY));
    expect((await endOf(stillToday)).endedAt).toBeNull();
    expect(await endOf(older)).toMatchObject({ endedAt: at('10:00', '2026-09-25') });

    const [seen] = await notes('timer.stopped_midnight', bySeen);
    expect(seen).toMatchObject({
      title: 'Your timer on acme-app was still running',
      body:
        'We stopped it at 6:20 PM, the last time Daybook saw you active. ' +
        'Check your report before it locks.',
      link: '/report?date=2026-09-29',
    });
    const [locked] = await notes('timer.stopped_midnight', lockedAfter);
    expect(locked.body).toContain(
      'We stopped it at 6:00 PM, the last time Daybook saw you active.',
    );
    const [out] = await notes('timer.stopped_midnight', byCheckout);
    expect(out.body).toBe(
      'We stopped it at 6:30 PM, when you checked out. Check your report before it locks.',
    );
    const [start] = await notes('timer.stopped_midnight', byStart);
    expect(start.body).toBe(
      "We couldn't tell when you stopped, so we stopped it at 4:00 PM, when it started. " +
        'Check your report before it locks.',
    );
    expect(await notes('timer.stopped_midnight', stillToday)).toHaveLength(0);
    expect(await notes('timer.stopped_midnight')).toHaveLength(8);

    expect(await timers.closeForgotten(TODAY)).toEqual({ closed: 0 });
  });

  it('runs once per date from 00:05 as the close-open-timers job', async () => {
    await insertEntry(bySeen, acme, { date: YESTERDAY, from: '17:00' });
    setClock('00:04');
    expect(await closeOpenTimersJob.tick()).toBeNull();
    setClock('00:10');
    const breaks = vi.spyOn(attendance, 'closeForgottenBreaks');
    expect(await closeOpenTimersJob.tick()).toEqual({
      status: 'done',
      result: { timers: 1, breaks: expect.any(Number) },
    });
    expect(breaks).toHaveBeenCalledWith(TODAY);
    expect(await closeOpenTimersJob.tick()).toEqual({ status: 'skipped' });
    const [row] = await db('jobRuns').where({ runKey: `close_open_timers:${TODAY}` });
    expect(row).toMatchObject({ job: 'close-open-timers', status: 'done' });
  });
});

describe('sendReminders', () => {
  const people = {};

  beforeAll(async () => {
    const names = ['idle', 'fresh', 'running', 'recent', 'stale', 'onBreak', 'backFromBreak'];
    for (const name of names) people[name] = await createUser({ name: `Rem ${name}` });
    people.left = await createUser({ name: 'Rem left' });
    people.untracked = await createUser({ name: 'Rem untracked', tracksAttendance: false });
    people.gone = await createUser({ name: 'Rem gone', status: 'deactivated' });
    for (const name of ['running', 'recent', 'stale', 'onBreak', 'backFromBreak', 'gone']) {
      await checkIn(people[name], TODAY, { in: '09:00' });
    }
    await checkIn(people.idle, TODAY, { in: '10:00' });
    await checkIn(people.fresh, TODAY, { in: '10:50' });
    await checkIn(people.left, TODAY, { in: '09:00', out: '10:00' });
    await checkIn(people.untracked, TODAY, { in: '09:00' });
  });

  beforeEach(async () => {
    await setSettings({ timers_mode: 'required' });
    vi.spyOn(attendance, 'listBreaksForDate').mockResolvedValue([
      breakRow(people.onBreak, '10:40'),
      breakRow(people.backFromBreak, '10:20', '10:50'),
    ]);
    await insertEntry(people.running, acme, { from: '10:00' });
    await insertEntry(people.recent, acme, { from: '10:00', to: '10:45' });
    await insertEntry(people.stale, acme, { from: '09:00', to: '10:30' });
  });

  const remindedIds = async () =>
    (await notes('timer.reminder')).map((row) => row.userId).sort((a, b) => a - b);
  const ids = (...names) => names.map((name) => people[name].id).sort((a, b) => a - b);

  it('reminds people with no timer for timerReminderMinutes, at most once an hour', async () => {
    setClock('11:00');
    expect(await timers.sendReminders(TODAY)).toEqual({ reminded: 2 });
    expect(await remindedIds()).toEqual(ids('idle', 'stale'));
    const [note] = await notes('timer.reminder', people.idle);
    expect(note).toMatchObject({
      title: 'No timer is running',
      body: "Start a timer for what you're working on.",
      link: '/today',
    });

    setClock('11:30');
    expect(await timers.sendReminders(TODAY)).toEqual({ reminded: 3 });
    expect(await remindedIds()).toEqual(ids('idle', 'stale', 'fresh', 'recent', 'backFromBreak'));

    setClock('12:01'); // an hour after the first reminders
    expect(await timers.sendReminders(TODAY)).toEqual({ reminded: 2 });
    expect((await notes('timer.reminder', people.idle)).length).toBe(2);
    expect(await notes('timer.reminder', people.onBreak)).toHaveLength(0);
    expect(await notes('timer.reminder', people.running)).toHaveLength(0);
  });

  it('only in required mode, with a reminder time, on working days', async () => {
    setClock('11:00');
    await setSettings({ timers_mode: 'optional' });
    expect(await timers.sendReminders(TODAY)).toEqual({ reminded: 0 });
    await setSettings({ timers_mode: 'required', timer_reminder_minutes: 0 });
    expect(await timers.sendReminders(TODAY)).toEqual({ reminded: 0 });
    await setSettings({ timer_reminder_minutes: 20 });
    expect(await timers.sendReminders('2026-10-03')).toEqual({ reminded: 0 }); // a Saturday
    expect(await notes('timer.reminder')).toHaveLength(0);
  });

  it('runs as the timer-reminders job only while the office is open', async () => {
    setClock('09:29');
    expect(await timerRemindersJob.tick()).toBeNull();
    setClock('18:30');
    expect(await timerRemindersJob.tick()).toBeNull();
    setClock('12:00', '2026-10-03');
    expect(await timerRemindersJob.tick()).toBeNull();
    await setSettings({ timers_mode: 'optional' });
    setClock('11:00');
    expect(await timerRemindersJob.tick()).toBeNull();
    await setSettings({ timers_mode: 'required' });
    expect(await timerRemindersJob.tick()).toEqual({ reminded: 2 });
    expect(await notes('timer.reminder')).toHaveLength(2);
  });
});
