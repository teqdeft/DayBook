// Auto check-out when inactive (CONTRACT 19) on the real modules: the 20:00 check (working =
// active screen time or a project timer after office end and in the hour before), the check-out
// time rule, the break and timer closed with it, the notification and audit (the person only),
// rows left alone, the job's run key and the setting. People who leave just after office end,
// the signs of work and screen time off are in attendance.autoCheckoutSigns.test.js; the
// office-end reminder and what happens to an auto row afterwards in
// attendance.autoCheckoutAfter.test.js.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { attendance } from '@/modules/attendance';
import { autoCheckoutJob } from '@/worker/jobs/autoCheckout';
import { forgetHandledKeysForTests } from '@/worker/runOnce';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { checkIn, createProject } from './dashboardKit.js';
import { addSegment, at, entriesOf, insertEntry, setClock, TODAY, YESTERDAY } from './timersKit.js';

let pm;
let acme;

beforeAll(async () => {
  await resetDatabase();
  pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  await createUser({ name: 'Neha Gupta', role: 'hr' });
  acme = await createProject(pm, { name: 'acme-app' });
});

beforeEach(async () => {
  forgetHandledKeysForTests();
  for (const table of ['jobRuns', 'notifications', 'timeEntries', 'activitySegments']) {
    await db(table).del();
  }
  await db('auditLogs').where({ action: 'attendance.auto_checkout' }).del();
  await db('attendanceCorrections').del();
  await db('attendance').del();
  await setSettings({
    auto_checkout_enabled: true,
    auto_checkout_at: '20:00',
    office_end: '18:30',
    timers_mode: 'optional',
  });
  setClock('20:00');
});

/** A new employee checked in today at `inAt` (local clock). */
async function person(name, inAt = '09:30', overrides = {}) {
  const user = await createUser({ name, ...overrides });
  await checkIn(user, TODAY, { in: inAt });
  return user;
}

const rowOf = (user, date = TODAY) =>
  db('attendance').where({ userId: user.id, workDate: date }).first();
const notesOf = (type) => db('notifications').where({ type }).orderBy('id');
const autoAudits = () =>
  db('auditLogs').where({ action: 'attendance.auto_checkout' }).orderBy('id');

describe('the check at auto_checkout_at', () => {
  it('checks out people idle, locked or unseen since office end, at their last active moment', async () => {
    const idle = await person('Ida Idle');
    await addSegment(idle, 'active', '09:30', '17:45');
    await addSegment(idle, 'idle', '17:45', '20:00');
    const locked = await person('Lou Locked');
    await addSegment(locked, 'active', '09:30', '18:00');
    await addSegment(locked, 'locked', '18:00', '20:00');
    const unseen = await person('Nora Nodata');
    const early = await person('Eli Early', '10:00'); // active only before checking in
    await addSegment(early, 'active', '08:00', '09:00');
    const edge = await person('Edie Edge'); // active until office end exactly
    await addSegment(edge, 'active', '17:00', '18:30');
    await addSegment(edge, 'idle', '18:30', '20:00');

    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 5, kept: 0 });

    for (const [user, out] of [
      [idle, '17:45'],
      [locked, '18:00'],
      [unseen, '18:30'],
      [early, '18:30'],
      [edge, '18:30'],
    ]) {
      expect(await rowOf(user), user.name).toMatchObject({
        checkOutAt: at(out),
        checkoutStatus: 'auto',
        checkOutIp: null,
      });
    }
  });

  it('tells only the person and audits the change without an actor', async () => {
    const idle = await person('Ida Notice');
    await addSegment(idle, 'active', '09:30', '18:12');
    await attendance.autoCheckOut(TODAY);

    const notes = await notesOf('attendance.auto_checkout');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      userId: idle.id,
      title: 'You were checked out at 6:12 PM',
      body:
        'There was no activity on your computer after 6:30 PM. ' +
        'If you were working, request a correction.',
      link: '/today',
    });
    const row = await rowOf(idle);
    const [log] = await autoAudits();
    expect(log).toMatchObject({ actorId: null, entityType: 'attendance', entityId: row.id });
    expect(parseJson(log.before)).toMatchObject({ checkoutStatus: 'open', checkOutAt: null });
    expect(parseJson(log.after)).toMatchObject({ checkoutStatus: 'auto' });
    expect(new Date(parseJson(log.after).checkOutAt)).toEqual(at('18:12'));
  });

  it('leaves anyone working in the hour before the check alone: screen time or a timer', async () => {
    const active = await person('Ann Active');
    await addSegment(active, 'idle', '18:00', '19:10');
    await addSegment(active, 'active', '19:10', '19:40');
    const windowOnly = await person('Wes Window'); // no Idle Detection: any source counts
    await addSegment(windowOnly, 'active', '18:45', '19:05', TODAY, 'window');
    const stayedLate = await person('Sid Stayed'); // dinner since 19:20
    await addSegment(stayedLate, 'active', '17:00', '19:20');
    await addSegment(stayedLate, 'idle', '19:20', '20:00');
    const running = await person('Rae Running');
    await insertEntry(running, acme, { from: '17:00' });
    const ranLate = await person('Tim Timer');
    await insertEntry(ranLate, acme, { from: '18:00', to: '19:15' });
    const stoppedEarly = await person('Sam Stopped'); // no screen time: the timer says 18:00
    await insertEntry(stoppedEarly, acme, { from: '16:00', to: '18:00' });

    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 1, kept: 5 });

    for (const user of [active, windowOnly, stayedLate, running, ranLate]) {
      expect(await rowOf(user), user.name).toMatchObject({
        checkoutStatus: 'open',
        checkOutAt: null,
      });
    }
    expect((await entriesOf(running))[0]).toMatchObject({ endedAt: null });
    expect(await rowOf(stoppedEarly)).toMatchObject({
      checkoutStatus: 'auto',
      checkOutAt: at('18:00'),
    });
    expect((await entriesOf(stoppedEarly))[0]).toMatchObject({ endedAt: at('18:00') });
    expect(await notesOf('attendance.auto_checkout')).toHaveLength(1);
  });

  it('counts everything up to now as the window when the worker runs late', async () => {
    setClock('21:00');
    const lateWorker = await person('Lena Late');
    await addSegment(lateWorker, 'active', '20:30', '20:50');
    const gone = await person('Gus Gone');
    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 1, kept: 1 });
    expect((await rowOf(lateWorker)).checkoutStatus).toBe('open');
    expect((await rowOf(gone)).checkOutAt).toEqual(at('18:30'));
  });

  it('leaves late check-ins, later shifts, closed rows and earlier days alone', async () => {
    const evening = await person('Eve Evening', '19:00');
    const nightShift = await person('Nia Night', '12:00', {
      shiftStart: '12:00',
      shiftEnd: '21:00',
    });
    const done = await createUser({ name: 'Dan Done' });
    await checkIn(done, TODAY, { in: '09:30', out: '17:00' });
    const forgot = await createUser({ name: 'Fay Forgot' });
    await checkIn(forgot, YESTERDAY, { in: '09:30' });

    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 0, kept: 1 });
    expect((await rowOf(evening)).checkoutStatus).toBe('open');
    expect((await rowOf(nightShift)).checkoutStatus).toBe('open');
    expect(await rowOf(done)).toMatchObject({
      checkoutStatus: 'checked_out',
      checkOutAt: at('17:00'),
    });
    expect((await rowOf(forgot, YESTERDAY)).checkoutStatus).toBe('open');
    expect(await notesOf('attendance.auto_checkout')).toHaveLength(0);
  });

  it('ends an open break and closes a forgotten timer in the same transaction', async () => {
    const resting = await person('Bea Break');
    await addSegment(resting, 'active', '09:30', '17:50');
    const paused = await insertEntry(resting, acme, {
      from: '16:00',
      to: '17:30',
      stopReason: 'break',
    });
    await db('attendanceBreaks').insert({
      userId: resting.id,
      attendanceId: (await rowOf(resting)).id,
      workDate: TODAY,
      startedAt: at('17:30'),
      pausedEntryId: paused,
    });
    const forgot = await createUser({ name: 'Fred Forgotten' });
    await checkIn(forgot, YESTERDAY, { in: '09:30', out: '18:30' });
    await checkIn(forgot, TODAY, { in: '09:30' });
    await insertEntry(forgot, acme, { date: YESTERDAY, from: '17:00' }); // still running

    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 2, kept: 0 });

    expect((await rowOf(resting)).checkOutAt).toEqual(at('17:50'));
    const [ended] = await db('attendanceBreaks').where({ userId: resting.id });
    expect(ended).toMatchObject({ endedAt: at('17:50'), endReason: 'checkout' });
    expect(await entriesOf(resting)).toHaveLength(1); // the paused timer doesn't start again
    expect((await entriesOf(forgot))[0]).toMatchObject({
      endedAt: at('18:30', YESTERDAY),
      stopReason: 'midnight',
    });
    expect((await rowOf(forgot)).checkOutAt).toEqual(at('18:30'));
  });
});

describe('the auto-checkout job', () => {
  it('runs once per date from auto_checkout_at and a second run changes nothing', async () => {
    const unseen = await person('Uma Unseen');
    setClock('19:59');
    expect(await autoCheckoutJob.tick()).toBeNull();
    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 0, kept: 0 });
    expect((await rowOf(unseen)).checkoutStatus).toBe('open');

    setClock('20:00');
    expect(await autoCheckoutJob.tick()).toEqual({
      status: 'done',
      result: { checkedOut: 1, kept: 0 },
    });
    expect(await autoCheckoutJob.tick()).toEqual({ status: 'skipped' });
    const [run] = await db('jobRuns').where({ runKey: `auto_checkout:${TODAY}` });
    expect(run).toMatchObject({ job: 'auto-checkout', status: 'done' });

    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 0, kept: 0 });
    expect(await notesOf('attendance.auto_checkout')).toHaveLength(1);
    expect(await autoAudits()).toHaveLength(1);
  });

  it('follows auto_checkout_at and does nothing while auto check-out is off', async () => {
    const unseen = await person('Otto Off');
    await setSettings({ auto_checkout_enabled: false });
    expect(await autoCheckoutJob.tick()).toBeNull();
    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 0, kept: 0 });
    expect((await rowOf(unseen)).checkoutStatus).toBe('open');

    await setSettings({ auto_checkout_enabled: true, auto_checkout_at: '20:30' });
    expect(await autoCheckoutJob.tick()).toBeNull();
    setClock('20:30');
    expect(await autoCheckoutJob.tick()).toMatchObject({ result: { checkedOut: 1 } });
  });

  it('does nothing when the stored check time is not after office end', async () => {
    const unseen = await person('Ivy Invalid');
    await setSettings({ auto_checkout_at: '18:00' });
    expect(await attendance.autoCheckOut(TODAY)).toEqual({ checkedOut: 0, kept: 0 });
    expect((await rowOf(unseen)).checkoutStatus).toBe('open');
  });
});
