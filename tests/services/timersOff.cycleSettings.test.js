// The settings -> timers import (CONTRACT 15), loaded from the settings side: this file imports
// '@/modules/settings' and never '@/modules/timers' or '@/modules/attendance' itself (vitest runs
// each file in a fresh worker). Turning timers off loads timers inside settings.update and stops
// the running timer. A failed load would only be logged, so the row itself is checked.
import { beforeAll, expect, it, vi } from 'vitest';
import { settings } from '@/modules/settings';
import { logger } from '@/lib/logger';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';
import { checkIn, createProject } from './dashboardKit.js';
import { at, entriesOf, insertEntry, setClock, TODAY } from './timersKit.js';

let admin;
let emma;

beforeAll(async () => {
  await resetDatabase();
  const pm = await createUser({ name: 'Pat Manager', role: 'pm', tracksAttendance: false });
  admin = await createUser({ name: 'Ada Admin', role: 'admin', tracksAttendance: false });
  const acme = await createProject(pm, { name: 'acme-app' });
  emma = await createUser({ name: 'Emma Cycle' });
  await checkIn(emma, TODAY, { in: '09:00' });
  await insertEntry(emma, acme, { from: '09:30', note: 'Specs' });
  await setSettings({ timers_mode: 'optional' });
});

it('settings loaded first can stop running timers when they are turned off', async () => {
  setClock('10:30');
  const warn = vi.spyOn(logger, 'warn');

  const saved = await settings.update({ user: admin, values: { timersMode: 'off' } });

  expect(saved.timersMode).toBe('off');
  expect(warn).not.toHaveBeenCalled();
  expect(await entriesOf(emma)).toEqual([
    expect.objectContaining({ note: 'Specs', endedAt: at('10:30'), stopReason: 'stopped' }),
  ]);
});
