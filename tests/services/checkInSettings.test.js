// Check-in rules (CONTRACT 17, Settings -> Check-in): officeCheckinAnywhere and
// wfhRequiresApproval — defaults, saving with an audit row, on/off only, and hand-edited or
// missing rows. Also the auto check-out time against office end (CONTRACT 19) when either moves.
import { beforeAll, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { settings } from '@/modules/settings';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

let admin;

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-10-13T04:00:00Z');
  admin = await createUser({ name: 'Admin Person', role: 'admin', email: 'admin@example.com' });
});

const pick = (values) => ({
  officeCheckinAnywhere: values.officeCheckinAnywhere,
  wfhRequiresApproval: values.wfhRequiresApproval,
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

describe('check-in rules', () => {
  it('are seeded: office check-in only on the office network, WFH needs approval', async () => {
    const rows = await db('settings')
      .whereIn('key', ['office_checkin_anywhere', 'wfh_requires_approval'])
      .orderBy('key');
    expect(rows.map((row) => [row.key, parseJson(row.value)])).toEqual([
      ['office_checkin_anywhere', false],
      ['wfh_requires_approval', true],
    ]);
    expect(pick(await settings.getAll())).toEqual({
      officeCheckinAnywhere: false,
      wfhRequiresApproval: true,
    });
  });

  it('save with Save changes, with one audit row naming both', async () => {
    const saved = await settings.update({
      user: admin,
      ip: '203.0.113.9',
      values: { officeCheckinAnywhere: true, wfhRequiresApproval: false },
    });
    expect(pick(saved)).toEqual({ officeCheckinAnywhere: true, wfhRequiresApproval: false });
    expect(pick(await settings.getAll())).toEqual(pick(saved));

    const row = await db('settings').where({ key: 'office_checkin_anywhere' }).first();
    expect(row.updatedBy).toBe(admin.id);
    const log = await db('auditLogs')
      .where({ action: 'settings.update' })
      .orderBy('id', 'desc')
      .first();
    expect(log).toMatchObject({ actorId: admin.id, ip: '203.0.113.9' });
    expect(parseJson(log.before)).toEqual({
      officeCheckinAnywhere: false,
      wfhRequiresApproval: true,
    });
    expect(parseJson(log.after)).toEqual({
      officeCheckinAnywhere: true,
      wfhRequiresApproval: false,
    });

    const back = await settings.update({
      user: admin,
      values: { officeCheckinAnywhere: false, wfhRequiresApproval: true },
    });
    expect(pick(back)).toEqual({ officeCheckinAnywhere: false, wfhRequiresApproval: true });
  });

  it('accept only on or off', async () => {
    const error = await expectAppError(
      settings.update({
        user: admin,
        values: { officeCheckinAnywhere: 'yes', wfhRequiresApproval: 1 },
      }),
      'VALIDATION_FAILED',
    );
    expect(error.fields).toEqual({
      officeCheckinAnywhere: 'Choose on or off.',
      wfhRequiresApproval: 'Choose on or off.',
    });
    expect(pick(await settings.getAll())).toEqual({
      officeCheckinAnywhere: false,
      wfhRequiresApproval: true,
    });
  });

  it('read a hand-edited row as on or off, and a missing row as the default', async () => {
    await setSettings({ office_checkin_anywhere: 1, wfh_requires_approval: 0 });
    expect(pick(await settings.getAll())).toEqual({
      officeCheckinAnywhere: true,
      wfhRequiresApproval: false,
    });
    const keys = ['office_checkin_anywhere', 'wfh_requires_approval'];
    await db('settings').whereIn('key', keys).delete();
    expect(pick(await settings.getAll())).toEqual({
      officeCheckinAnywhere: false,
      wfhRequiresApproval: true,
    });
    await db('settings').insert([
      { key: 'office_checkin_anywhere', value: 'false' },
      { key: 'wfh_requires_approval', value: 'true' },
    ]);
  });
});

describe('the auto check-out time against office end', () => {
  const MESSAGE = 'Pick a time after office hours end.';
  const clocks = async () => {
    const all = await settings.getAll();
    return [all.officeEnd, all.autoCheckoutAt, all.autoCheckoutEnabled];
  };

  it('refuses moving office end to or past it while auto check-out is on', async () => {
    for (const officeEnd of ['20:00', '20:30']) {
      const error = await expectAppError(
        settings.update({ user: admin, values: { officeEnd } }),
        'VALIDATION_FAILED',
      );
      expect(error.fields).toEqual({ autoCheckoutAt: MESSAGE });
    }
    expect(await clocks()).toEqual(['18:30', '20:00', true]);
  });

  it('checks the values after the save, so both can move together', async () => {
    await settings.update({ user: admin, values: { officeEnd: '20:30', autoCheckoutAt: '22:00' } });
    expect(await clocks()).toEqual(['20:30', '22:00', true]);
    await settings.update({ user: admin, values: { autoCheckoutAt: '20:00', officeEnd: '18:30' } });
    expect(await clocks()).toEqual(['18:30', '20:00', true]);
  });

  it('refuses turning it back on while its time is not after office end', async () => {
    await settings.update({
      user: admin,
      values: { autoCheckoutEnabled: false, officeEnd: '20:00' },
    });
    const error = await expectAppError(
      settings.update({ user: admin, values: { autoCheckoutEnabled: true } }),
      'VALIDATION_FAILED',
    );
    expect(error.fields).toEqual({ autoCheckoutAt: MESSAGE });
    // An unrelated save doesn't trip over the stored pair.
    await settings.update({ user: admin, values: { companyName: 'Acme Studio' } });
    await settings.update({
      user: admin,
      values: { autoCheckoutEnabled: true, officeEnd: '18:30' },
    });
    expect(await clocks()).toEqual(['18:30', '20:00', true]);
  });
});
