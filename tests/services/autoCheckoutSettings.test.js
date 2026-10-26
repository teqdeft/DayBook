// Auto check-out settings (CONTRACT 19, Settings -> Check-in): autoCheckoutEnabled and
// autoCheckoutAt — defaults, saving with an audit row, on/off only, clock text, and hand-edited or
// missing rows; the reminder default is now 25 minutes; and the Settings form's clock words match
// the API's messages.
import { beforeAll, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { settings } from '@/modules/settings';
import {
  AUTO_CHECKOUT_TOO_EARLY,
  CLOCKS,
  toForm,
  toValues,
} from '@/app/(app)/settings/settingsValues';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

let admin;

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-10-26T04:00:00Z');
  admin = await createUser({ name: 'Admin Person', role: 'admin', email: 'admin@example.com' });
});

const pick = (values) => ({
  autoCheckoutEnabled: values.autoCheckoutEnabled,
  autoCheckoutAt: values.autoCheckoutAt,
});

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
  return error;
}

describe('auto check-out settings', () => {
  it('are seeded on, checking at 8:00 PM; the timer reminder waits 25 minutes', async () => {
    const rows = await db('settings')
      .whereIn('key', ['auto_checkout_enabled', 'auto_checkout_at', 'timer_reminder_minutes'])
      .orderBy('key');
    expect(rows.map((row) => [row.key, parseJson(row.value)])).toEqual([
      ['auto_checkout_at', '20:00'],
      ['auto_checkout_enabled', true],
      ['timer_reminder_minutes', 25],
    ]);
    const all = await settings.getAll();
    expect(pick(all)).toEqual({ autoCheckoutEnabled: true, autoCheckoutAt: '20:00' });
    expect(all.timerReminderMinutes).toBe(25);
    // What the Settings form shows for them.
    const form = toForm(all);
    expect(form.autoCheckoutEnabled).toBe(true);
    expect(form.autoCheckoutAt).toBe('8:00 PM');
    expect(form.timerReminderMinutes).toBe('25');
  });

  it('save with Save changes, with one audit row naming both', async () => {
    const saved = await settings.update({
      user: admin,
      ip: '203.0.113.9',
      values: { autoCheckoutEnabled: false, autoCheckoutAt: '21:15' },
    });
    expect(pick(saved)).toEqual({ autoCheckoutEnabled: false, autoCheckoutAt: '21:15' });
    expect(pick(await settings.getAll())).toEqual(pick(saved));

    const row = await db('settings').where({ key: 'auto_checkout_at' }).first();
    expect(parseJson(row.value)).toBe('21:15');
    expect(row.updatedBy).toBe(admin.id);
    const log = await db('auditLogs')
      .where({ action: 'settings.update' })
      .orderBy('id', 'desc')
      .first();
    expect(log).toMatchObject({ actorId: admin.id, ip: '203.0.113.9' });
    expect(parseJson(log.before)).toEqual({ autoCheckoutEnabled: true, autoCheckoutAt: '20:00' });
    expect(parseJson(log.after)).toEqual({ autoCheckoutEnabled: false, autoCheckoutAt: '21:15' });

    const back = await settings.update({
      user: admin,
      values: { autoCheckoutEnabled: true, autoCheckoutAt: '20:00' },
    });
    expect(pick(back)).toEqual({ autoCheckoutEnabled: true, autoCheckoutAt: '20:00' });
  });

  it('take the time as HH:mm (seconds and spaces dropped)', async () => {
    for (const [text, clock] of [
      ['19:45:00', '19:45'],
      [' 21:00 ', '21:00'],
    ]) {
      const saved = await settings.update({ user: admin, values: { autoCheckoutAt: text } });
      expect(saved.autoCheckoutAt, text).toBe(clock);
    }
    await settings.update({ user: admin, values: { autoCheckoutAt: '20:00' } });
  });

  it('accept only on or off and a real time, saving nothing otherwise', async () => {
    const error = await expectAppError(
      settings.update({
        user: admin,
        values: { autoCheckoutEnabled: 'yes', autoCheckoutAt: '8 PM' },
      }),
      'VALIDATION_FAILED',
    );
    expect(error.fields).toEqual({
      autoCheckoutEnabled: 'Choose on or off.',
      autoCheckoutAt: 'Enter the auto check-out time as a time like 09:30.',
    });
    for (const value of ['24:00', '20:60', '', null, 2000]) {
      const bad = await expectAppError(
        settings.update({ user: admin, values: { autoCheckoutAt: value } }),
        'VALIDATION_FAILED',
      );
      expect(bad.fields, JSON.stringify(value)).toHaveProperty('autoCheckoutAt');
    }
    expect(pick(await settings.getAll())).toEqual({
      autoCheckoutEnabled: true,
      autoCheckoutAt: '20:00',
    });
  });

  it('read a hand-edited row as on or off and HH:mm, and a missing row as the default', async () => {
    await setSettings({ auto_checkout_enabled: 0, auto_checkout_at: '9:5' });
    expect(pick(await settings.getAll())).toEqual({
      autoCheckoutEnabled: false,
      autoCheckoutAt: '09:05',
    });
    const keys = ['auto_checkout_enabled', 'auto_checkout_at'];
    await db('settings').whereIn('key', keys).delete();
    expect(pick(await settings.getAll())).toEqual({
      autoCheckoutEnabled: true,
      autoCheckoutAt: '20:00',
    });
    await db('settings').insert([
      { key: 'auto_checkout_enabled', value: 'true' },
      { key: 'auto_checkout_at', value: '"20:00"' },
    ]);
  });
});

describe('the Settings form', () => {
  it('names every clock the way the API does', async () => {
    expect(Object.keys(CLOCKS)).toEqual([
      'officeStart',
      'officeEnd',
      'reportReminderAt',
      'lateAfter',
      'autoCheckoutAt',
    ]);
    for (const [key, label] of Object.entries(CLOCKS)) {
      const error = await expectAppError(
        settings.update({ user: admin, values: { [key]: 'soon' } }),
        'VALIDATION_FAILED',
      );
      expect(error.fields[key]).toBe(`Enter ${label} as a time like 09:30.`);
    }
  });

  it('refuses a check time not after office end the way the API does, only while it is on', async () => {
    const saved = await settings.getAll();
    const form = { ...toForm(saved), autoCheckoutAt: '6:30 PM' };
    expect(toValues(form, saved).errors).toEqual({ autoCheckoutAt: AUTO_CHECKOUT_TOO_EARLY });
    const error = await expectAppError(
      settings.update({ user: admin, values: { autoCheckoutAt: '18:30' } }),
      'VALIDATION_FAILED',
    );
    expect(error.fields).toEqual({ autoCheckoutAt: AUTO_CHECKOUT_TOO_EARLY });

    // Off: neither the form nor the API checks the (hidden) time.
    const off = { ...form, autoCheckoutEnabled: false };
    expect(toValues(off, saved).errors).toEqual({});
    const stored = await settings.update({
      user: admin,
      values: { autoCheckoutEnabled: false, autoCheckoutAt: '18:00' },
    });
    expect(pick(stored)).toEqual({ autoCheckoutEnabled: false, autoCheckoutAt: '18:00' });
    await settings.update({
      user: admin,
      values: { autoCheckoutEnabled: true, autoCheckoutAt: '20:00' },
    });
  });
});
