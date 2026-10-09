// The attendance <-> timers import cycle (CONTRACT 15), loaded from the attendance side: this file
// imports '@/modules/attendance' and never '@/modules/timers' itself (vitest runs each file in a
// fresh worker), then calls across: a break stops the running timer, End break starts it again
// and check-out stops it.
import { beforeAll, expect, it } from 'vitest';
import { attendance } from '@/modules/attendance';
import { createUser, resetDatabase } from '../helpers/db.js';
import { checkIn, createProject } from './dashboardKit.js';
import { at, entriesOf, insertEntry, setClock, TODAY } from './timersKit.js';

let emma;
let acme;

beforeAll(async () => {
  await resetDatabase();
  const pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
  emma = await createUser({ name: 'Emma Cycle' });
  await checkIn(emma, TODAY, { in: '09:00' });
  await insertEntry(emma, acme, { from: '09:30', note: 'Specs' });
});

it('attendance loaded first can stop and resume timers', async () => {
  setClock('10:00');
  const started = await attendance.startBreak({ user: emma });
  setClock('10:15');
  await attendance.endBreak({ user: emma });
  setClock('11:00');
  await attendance.checkOut({ user: emma, ip: null });

  const [paused, resumed] = await entriesOf(emma);
  expect(started.pausedEntryId).toBe(paused.id);
  expect(paused).toMatchObject({ stopReason: 'break', endedAt: at('10:00') });
  expect(resumed).toMatchObject({
    note: 'Specs',
    startedAt: at('10:15'),
    stopReason: 'checkout',
    endedAt: at('11:00'),
  });
});
