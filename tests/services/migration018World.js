// The people of tests/services/migration018.test.js: 1.09-shaped rows made while migration 018 is
// rolled back. The backfill cases (31 Oct and 2 Nov, each person named after what they show) and
// today's company (Thursday 19 Nov 2026), where the deploy-before-migrate checks run.
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { attendance } from '@/modules/attendance';
import { createUser, setSettings } from '../helpers/db.js';
import { addMembers, createProject, createReport } from './dashboardKit.js';
import { at, insertBreak, insertEntry, insertRow, moved109, split109 } from './migration018Kit.js';
import { addSegment } from './timersKit.js';

export const TODAY = '2026-11-19'; // Thursday
export const YESTERDAY = '2026-11-18';
export const OCT31 = '2026-10-31'; // before the backfill's 1 Nov
export const NOV2 = '2026-11-02'; // Monday
export const OFFICE_IP = '203.0.113.24';

export const SETTINGS = {
  timers_mode: 'optional',
  timer_away_minutes: 25,
  activity_tracking_enabled: true,
  activity_idle_minutes: 5,
  break_allowance_minutes: 30,
  auto_mark_missing_checkout: true,
  payroll_month_start_day: 1,
};

/** Pins now to a local clock today ('14:30'). */
export const setClock = (clock, date = TODAY) => setNowForTests(at(date, clock).toISOString());

let project;

async function person(name, extra = {}) {
  const user = await createUser({ name, ...extra });
  await addMembers(project, [user]);
  return user;
}

/** Rebuilt: a split on 2 Nov, kept with a later Stop; a self break and a report stay as they are. */
async function splitCases(world) {
  const old = await person('Asha Before');
  await insertRow(old, OCT31, { in: '09:00', out: '18:00' });
  await split109(old, project, OCT31, {
    from: '10:00',
    gap: ['11:00', '11:30'],
    to: '17:00',
    removedAt: '11:31:05',
  });
  const user = await person('Dev Split');
  const rowId = await insertRow(user, NOV2, { in: '09:30', out: '18:30' });
  const ids = await split109(user, project, NOV2, {
    from: '09:35',
    gap: ['13:00', '13:45'],
    to: '18:00',
    removedAt: '13:50:07',
  });
  await insertBreak(user, rowId, NOV2, '16:00', '16:15');
  await createReport(user, NOV2, {
    entries: [{ projectId: project.id, minutes: 435, tasks: [{ title: 'Login page' }] }],
  });
  world.split = { user, rowId, head: ids.head };
  world.old = { user: old };
}

/** Rebuilt: a moved start on an open row. Not found: a fresh and a resumed timer, Keep later. */
async function movedCases(world) {
  const user = await person('Gita Moved');
  const rowId = await insertRow(user, NOV2, { in: '09:30' });
  const entry = await moved109(user, project, NOV2, {
    created: '10:00',
    from: '10:20',
    to: '12:00',
    removedAt: '10:21:30',
  });
  await insertEntry(user, project, NOV2, { from: '13:00', to: '14:00' }); // fresh
  await insertEntry(user, project, NOV2, { from: '14:15', to: '15:00', created: '14:15' }); // resumed
  world.moved = { user, rowId, entry };
  const kept = await person('Hari Kept');
  await insertRow(kept, NOV2, { in: '09:30', out: '18:30' });
  await insertEntry(kept, project, NOV2, {
    from: '10:20',
    to: '12:00',
    created: '10:00',
    checked: '11:00', // answered Keep later: away_checked_until moved on
  });
}

/** Never found: a split head edited by hand since, a tail deleted, a hand-added entry in the gap. */
async function notFoundCases() {
  const edited = await person('Ira Edited');
  await insertRow(edited, NOV2, { in: '09:30', out: '18:30' });
  const { head } = await split109(edited, project, NOV2, {
    from: '09:35',
    gap: ['13:00', '13:45'],
    to: '18:00',
    removedAt: '13:50:07',
  });
  await db('timeEntries')
    .where({ id: head })
    .update({ updatedAt: at(NOV2, '15:00') });
  const gone = await person('Jai Gone');
  await insertRow(gone, NOV2, { in: '09:30', out: '18:30' });
  const tail = await split109(gone, project, NOV2, {
    from: '09:35',
    gap: ['11:00', '11:40'],
    to: '12:00',
    removedAt: '11:41:00',
  });
  await db('timeEntries').where({ id: tail.tail }).del();
  await insertEntry(gone, project, NOV2, { from: '12:30', to: '17:00' }); // fresh, same project
  const hand = await person('Uma Hand');
  await insertRow(hand, NOV2, { in: '09:30', out: '18:30' });
  await split109(hand, project, NOV2, {
    from: '09:35',
    gap: ['13:00', '13:45'],
    to: '18:00',
    removedAt: '13:50:07',
  });
  await insertEntry(hand, project, NOV2, { from: '13:10', to: '13:20', source: 'manual' });
}

/** Skipped and counted: under a minute, no row, outside the row, over a break, over an entry. */
async function skippedCases() {
  const short = await person('Kiran Short');
  await insertRow(short, NOV2, { in: '09:30', out: '18:30' });
  await split109(short, project, NOV2, {
    from: '09:35',
    gap: ['11:00:00', '11:00:40'],
    to: '18:00',
    removedAt: '11:01:00',
  });
  const noRow = await person('Leela No Row');
  await split109(noRow, project, NOV2, {
    from: '09:35',
    gap: ['11:00', '11:30'],
    to: '17:00',
    removedAt: '11:31:00',
  });
  const outside = await person('Mohan Outside');
  await insertRow(outside, NOV2, { in: '09:30', out: '12:00' });
  await split109(outside, project, NOV2, {
    from: '09:35',
    gap: ['12:30', '13:00'],
    to: '14:00',
    removedAt: '13:01:00',
  });
  const overBreak = await person('Nina Over Break');
  const rowId = await insertRow(overBreak, NOV2, { in: '09:30' });
  await split109(overBreak, project, NOV2, {
    from: '09:35',
    gap: ['13:00', '13:45'],
    to: '18:00',
    removedAt: '13:50:07',
  });
  await insertBreak(overBreak, rowId, NOV2, '13:30', '13:40');
  const overEntry = await person('Om Over Entry');
  await insertRow(overEntry, NOV2, { in: '09:30' });
  await moved109(overEntry, project, NOV2, { created: '10:00', from: '10:20', to: '12:00' });
  await insertEntry(overEntry, project, NOV2, { from: '10:05', to: '10:15', source: 'manual' });
}

/** Four late days this month for the late alert (CONTRACT 25, item 10). */
async function lateDays(user) {
  for (const date of ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) {
    await insertRow(user, date, { in: '09:50', out: '18:30', lateMinutes: 20 });
  }
}

/**
 * Today's company. Priya: a finished timer with 30 minutes locked (10:30 to 11:00) and a break by
 * Start and End break. Vishal: a running timer and a lunch (13:00 to 13:45). Karan, Meera and
 * Rohan: yesterday's missing check-outs. Ravi checks in later; Tara never does. Sana: four late
 * days this month.
 */
async function today(world) {
  const priya = await person('Priya Sharma');
  const priyaRow = await insertRow(priya, TODAY, { in: '09:30' });
  const priyaEntry = await insertEntry(priya, project, TODAY, { from: '09:35', to: '12:00' });
  await addSegment(priya, 'active', '09:35', '10:30', TODAY);
  await addSegment(priya, 'locked', '10:30', '11:00', TODAY);
  await addSegment(priya, 'active', '11:00', '12:00', TODAY);
  setClock('12:30');
  await attendance.startBreak({ user: priya });
  setClock('12:45');
  await attendance.endBreak({ user: priya });
  const vishal = await person('Vishal Saini');
  await insertRow(vishal, TODAY, { in: '09:30' });
  await insertEntry(vishal, project, TODAY, { from: '09:35' });
  await addSegment(vishal, 'active', '09:35', '13:05', TODAY);
  await addSegment(vishal, 'idle', '13:05', '13:10', TODAY);
  await addSegment(vishal, 'locked', '13:10', '13:45', TODAY);
  await addSegment(vishal, 'active', '13:46', '14:30', TODAY);
  const missing = {};
  for (const name of ['Karan Mehta', 'Meera Iyer', 'Rohan Das']) {
    const user = await person(name);
    missing[name.split(' ')[0].toLowerCase()] = {
      user,
      rowId: await insertRow(user, YESTERDAY, { in: '09:30', checkoutStatus: 'missing' }),
    };
  }
  const sana = await person('Sana Khan');
  await lateDays(sana);
  Object.assign(world, { priya, priyaRow, priyaEntry, vishal, sana, ...missing });
  world.ravi = await person('Ravi Verma');
  world.tara = await person('Tara Joshi');
}

/** Builds everything on a database at 017; returns the people and ids the checks use. */
export async function createWorld() {
  await setSettings(SETTINGS);
  await db('officeNetworks').insert({ name: 'Main office', ipAddress: OFFICE_IP });
  const hr = await createUser({ name: 'Neha Kapoor', role: 'hr' });
  const pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  project = await createProject(pm, { name: 'acme-app' });
  const world = { hr, pm, project };
  await splitCases(world);
  await movedCases(world);
  await notFoundCases();
  await skippedCases();
  await today(world);
  return world;
}
