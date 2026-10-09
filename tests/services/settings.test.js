import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { settings } from '@/modules/settings';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

let admin;

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-09-30T04:00:00Z');
  admin = await createUser({ name: 'Admin Person', role: 'admin', email: 'admin@example.com' });
});

afterAll(() => {
  settings.setCacheTtlForTests(null);
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

describe('settings.getAll', () => {
  it('returns the seeded defaults with camelCase keys and HH:mm clocks', async () => {
    expect(await settings.getAll()).toEqual({
      companyName: '[Company name]',
      timezone: 'Asia/Kolkata',
      workingDays: [1, 2, 3, 4, 5],
      officeStart: '09:30',
      officeEnd: '18:30',
      lateAfter: '09:30',
      reportReminderAt: '18:30',
      reportLock: 'next_day_12:00',
      gapWarningMinutes: 90,
      stuckTaskDays: 5,
      allowUnverifiedOffice: true,
      autoMarkMissingCheckout: true,
      slackEnabled: true,
      slackReportChannelId: null,
      slackReportChannelName: null,
      slackPostReports: true,
      slackRemind: true,
      slackUrgentNotify: true,
      slackRequestsNotify: true,
      activityTrackingEnabled: true,
      activityIdleMinutes: 5,
      activityRetentionDays: 365,
      pushEnabled: true,
      timersMode: 'optional',
      timerAwayMinutes: 25,
      timerReminderMinutes: 20,
      breakAllowanceMinutes: 60,
    });
  });

  it('falls back to the default for a missing or broken row', async () => {
    await db('settings').where({ key: 'stuck_task_days' }).delete();
    await db('settings')
      .where({ key: 'office_start' })
      .update({ value: JSON.stringify('9:05') });
    const values = await settings.getAll();
    expect(values.stuckTaskDays).toBe(5);
    expect(values.officeStart).toBe('09:05');
    await db('settings').insert({ key: 'stuck_task_days', value: '5' });
    await setSettings({ office_start: '09:30' });
  });

  it('returns a copy, so callers cannot change the cached values', async () => {
    const values = await settings.getAll();
    values.workingDays.push(6);
    values.companyName = 'Changed';
    expect((await settings.getAll()).workingDays).toEqual([1, 2, 3, 4, 5]);
    expect((await settings.getAll()).companyName).toBe('[Company name]');
  });
});

describe('settings.update', () => {
  beforeEach(() => settings.setCacheTtlForTests(null));

  it('saves only changed keys, records who changed them and writes one audit row', async () => {
    const auditBefore = await db('audit_logs')
      .where({ action: 'settings.update' })
      .count({ n: '*' })
      .first();
    const result = await settings.update({
      user: admin,
      ip: '203.0.113.9',
      values: {
        companyName: '  Acme Studio ',
        officeEnd: '18:30',
        workingDays: [5, 1, 2, 3, 4, 6],
      },
    });
    expect(result.companyName).toBe('Acme Studio');
    expect(result.workingDays).toEqual([1, 2, 3, 4, 5, 6]);

    const row = await db('settings').where({ key: 'company_name' }).first();
    expect(parseJson(row.value)).toBe('Acme Studio');
    expect(row.updatedBy).toBe(admin.id);
    const untouched = await db('settings').where({ key: 'office_end' }).first();
    expect(untouched.updatedBy).toBeNull();

    const logs = await db('audit_logs').where({ action: 'settings.update' }).orderBy('id', 'desc');
    expect(logs.length).toBe(Number(auditBefore.n) + 1);
    expect(logs[0]).toMatchObject({ actorId: admin.id, entityType: 'settings', ip: '203.0.113.9' });
    expect(parseJson(logs[0].before)).toEqual({
      companyName: '[Company name]',
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(parseJson(logs[0].after)).toEqual({
      companyName: 'Acme Studio',
      workingDays: [1, 2, 3, 4, 5, 6],
    });
  });

  it('writes nothing when no value changed', async () => {
    const count = async () => Number((await db('audit_logs').count({ n: '*' }).first()).n);
    const before = await count();
    await settings.update({
      user: admin,
      values: { companyName: 'Acme Studio', slackRemind: true },
    });
    expect(await count()).toBe(before);
  });

  it('clears the cache on save', async () => {
    settings.setCacheTtlForTests(60_000);
    expect((await settings.getAll()).lateAfter).toBe('09:30');
    // A direct database change is invisible while the cache is warm...
    await setSettings({ late_after: '09:45' });
    expect((await settings.getAll()).lateAfter).toBe('09:30');
    // ...and a save through the service clears it.
    const saved = await settings.update({ user: admin, values: { reportReminderAt: '19:00' } });
    expect(saved.reportReminderAt).toBe('19:00');
    expect(saved.lateAfter).toBe('09:45');
    expect((await settings.getAll()).lateAfter).toBe('09:45');
    await setSettings({ late_after: '09:30', report_reminder_at: '18:30' });
  });

  it('rejects invalid values with a message per field', async () => {
    const error = await expectAppError(
      settings.update({
        user: admin,
        values: {
          companyName: '   ',
          timezone: 'Mars/Olympus',
          workingDays: [],
          officeStart: '25:00',
          reportLock: 'tomorrow',
          gapWarningMinutes: 5,
          slackRemind: 'yes',
        },
      }),
      'VALIDATION_FAILED',
    );
    expect(error.status).toBe(400);
    expect(Object.keys(error.fields).sort()).toEqual(
      [
        'companyName',
        'gapWarningMinutes',
        'officeStart',
        'reportLock',
        'slackRemind',
        'timezone',
        'workingDays',
      ].sort(),
    );
    expect(error.fields.timezone).toBe('Pick a valid time zone.');
    expect(error.fields.workingDays).toBe('Pick at least one working day.');
    expect((await settings.getAll()).companyName).toBe('Acme Studio');
  });

  it('accepts the report lock formats, clocks with seconds and a cleared channel', async () => {
    const saved = await settings.update({
      user: admin,
      values: {
        reportLock: 'same_day_23:59',
        officeStart: '09:00:00',
        timezone: 'Europe/London',
        slackReportChannelId: 'C0123ABCD',
        slackReportChannelName: '#daily-reports',
      },
    });
    expect(saved).toMatchObject({
      reportLock: 'same_day_23:59',
      officeStart: '09:00',
      timezone: 'Europe/London',
      slackReportChannelId: 'C0123ABCD',
      slackReportChannelName: 'daily-reports',
    });
    const cleared = await settings.update({
      user: admin,
      values: { slackReportChannelId: '', slackReportChannelName: null },
    });
    expect(cleared.slackReportChannelId).toBeNull();
    expect(cleared.slackReportChannelName).toBeNull();
    await expectAppError(
      settings.update({ user: admin, values: { reportLock: 'next_day_24:00' } }),
      'VALIDATION_FAILED',
    );
  });
});

describe('office networks', () => {
  it('adds a network with an audit row and rejects a duplicate IP', async () => {
    const network = await settings.addOfficeNetwork({
      user: admin,
      name: ' Main office ',
      ipAddress: ' 203.0.113.24 ',
      ip: '203.0.113.24',
    });
    expect(network).toMatchObject({
      name: 'Main office',
      ipAddress: '203.0.113.24',
      createdBy: admin.id,
    });
    const log = await db('audit_logs')
      .where({ action: 'office_network.add', entityId: network.id })
      .first();
    expect(parseJson(log.after)).toEqual({ name: 'Main office', ipAddress: '203.0.113.24' });

    const duplicate = await expectAppError(
      settings.addOfficeNetwork({ user: admin, name: 'Again', ipAddress: '::ffff:203.0.113.24' }),
      'DUPLICATE_NETWORK',
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.fields.ipAddress).toBe('That IP address is already saved.');
    expect(await settings.listOfficeNetworks()).toHaveLength(1);
  });

  it('validates the name and the IP address', async () => {
    const error = await expectAppError(
      settings.addOfficeNetwork({ user: admin, name: '', ipAddress: '300.1.1.1' }),
      'VALIDATION_FAILED',
    );
    expect(error.fields).toEqual({
      name: 'Enter a name for this network.',
      ipAddress: 'Enter a valid IP address, like 203.0.113.24.',
    });
    const ipv6 = await settings.addOfficeNetwork({
      user: admin,
      name: 'Branch',
      ipAddress: '2001:DB8::1',
    });
    expect(ipv6.ipAddress).toBe('2001:db8::1');
  });

  it('isOfficeIp matches exactly, after normalising ::ffff:', async () => {
    expect(await settings.isOfficeIp('203.0.113.24')).toBe(true);
    expect(await settings.isOfficeIp('::ffff:203.0.113.24')).toBe(true);
    expect(await settings.isOfficeIp('2001:db8::1')).toBe(true);
    expect(await settings.isOfficeIp('203.0.113.2')).toBe(false);
    expect(await settings.isOfficeIp('203.0.113.245')).toBe(false);
    expect(await settings.isOfficeIp(null)).toBe(false);
    expect(await settings.isOfficeIp('')).toBe(false);
  });

  it('removes a network with an audit row; removing again is NOT_FOUND', async () => {
    const [network] = await settings.listOfficeNetworks();
    expect(
      await settings.removeOfficeNetwork({ user: admin, id: String(network.id), ip: '10.0.0.1' }),
    ).toEqual({
      id: network.id,
    });
    const log = await db('audit_logs')
      .where({ action: 'office_network.remove', entityId: network.id })
      .first();
    expect(parseJson(log.before)).toEqual({ name: 'Main office', ipAddress: '203.0.113.24' });
    expect(log.ip).toBe('10.0.0.1');
    expect(await settings.isOfficeIp('203.0.113.24')).toBe(false);
    await expectAppError(
      settings.removeOfficeNetwork({ user: admin, id: network.id }),
      'NOT_FOUND',
    );
    await expectAppError(settings.removeOfficeNetwork({ user: admin, id: 'abc' }), 'NOT_FOUND');
  });
});
