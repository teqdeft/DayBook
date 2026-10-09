// The attendance <-> timers import cycle (CONTRACT 15), loaded from the timers side: this file
// imports '@/modules/timers' and never '@/modules/attendance' itself (vitest runs each file in a
// fresh worker), then calls across: the state reads the attendance row and the open break, and
// starting a timer ends the break.
import { beforeAll, expect, it } from 'vitest';
import { timers } from '@/modules/timers';
import { db } from '@/lib/db';
import { createUser, resetDatabase } from '../helpers/db.js';
import { checkIn, createProject } from './dashboardKit.js';
import { at, entriesOf, setClock, TODAY } from './timersKit.js';

let emma;
let acme;

beforeAll(async () => {
  await resetDatabase();
  const pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  acme = await createProject(pm, { name: 'acme-app' });
  emma = await createUser({ name: 'Emma Cycle' });
  const attendanceId = await checkIn(emma, TODAY, { in: '09:00' });
  await db('attendanceBreaks').insert({
    userId: emma.id,
    attendanceId,
    workDate: TODAY,
    startedAt: at('10:00'),
  });
});

it('timers loaded first can read and end breaks', async () => {
  setClock('10:10');
  expect(await timers.getState({ user: emma })).toMatchObject({
    blocked: null,
    onBreak: true,
    breakStartedAt: at('10:00').toISOString(),
  });

  setClock('10:20');
  const state = await timers.start({ user: emma, projectId: acme.id });

  expect(state).toMatchObject({ onBreak: false, running: { projectId: acme.id } });
  const [item] = await db('attendanceBreaks').where({ userId: emma.id });
  expect(item).toMatchObject({ endReason: 'timer', endedAt: at('10:20') });
  expect(await entriesOf(emma)).toEqual([
    expect.objectContaining({ startedAt: at('10:20'), endedAt: null }),
  ]);
});
