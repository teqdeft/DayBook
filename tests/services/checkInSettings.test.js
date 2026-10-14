// Check-in rules (CONTRACT 17, Settings -> Check-in): officeCheckinAnywhere and
// wfhRequiresApproval — defaults, saving with an audit row, on/off only, and hand-edited or
// missing rows.
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
