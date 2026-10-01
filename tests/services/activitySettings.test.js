// Screen-time settings (tracking switch, idle minutes, retention) and the nightly clean-up of old
// segments.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { settings } from '@/modules/settings';
import { cleanupJob } from '@/worker/jobs/cleanup';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

let admin;
let vishal;

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-09-30T04:00:00Z');
  admin = await createUser({ name: 'Admin Person', role: 'admin', email: 'admin@example.com' });
  vishal = await createUser({ name: 'Vishal Saini' });
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

describe('screen-time settings', () => {
  it('defaults to tracking on, idle after 5 minutes, kept for 365 days', async () => {
    expect(await settings.getAll()).toMatchObject({
      activityTrackingEnabled: true,
      activityIdleMinutes: 5,
      activityRetentionDays: 365,
    });
  });

  it('saves the three keys with Save changes (numbers from form text too)', async () => {
    const saved = await settings.update({
      user: admin,
      values: {
        activityTrackingEnabled: false,
        activityIdleMinutes: '10',
        activityRetentionDays: 90,
      },
    });
    expect(saved).toMatchObject({
      activityTrackingEnabled: false,
      activityIdleMinutes: 10,
      activityRetentionDays: 90,
    });
    const audit = await db('auditLogs')
      .where({ action: 'settings.update' })
      .orderBy('id', 'desc')
      .first();
    expect(JSON.parse(audit.after)).toEqual({
      activityTrackingEnabled: false,
      activityIdleMinutes: 10,
      activityRetentionDays: 90,
    });
  });

  it('rejects values outside the allowed ranges', async () => {
    for (const [values, field] of [
      [{ activityIdleMinutes: 0 }, 'activityIdleMinutes'],
      [{ activityIdleMinutes: 121 }, 'activityIdleMinutes'],
      [{ activityIdleMinutes: 2.5 }, 'activityIdleMinutes'],
      [{ activityRetentionDays: 6 }, 'activityRetentionDays'],
      [{ activityRetentionDays: 3651 }, 'activityRetentionDays'],
      [{ activityTrackingEnabled: 'yes' }, 'activityTrackingEnabled'],
    ]) {
      const error = await expectAppError(
        settings.update({ user: admin, values }),
        'VALIDATION_FAILED',
      );
      expect(error.fields).toHaveProperty(field);
    }
  });

  it('keeps hand-edited rows inside the allowed ranges', async () => {
    await setSettings({ activity_idle_minutes: 0, activity_retention_days: 99999 });
    expect(await settings.getAll()).toMatchObject({
      activityIdleMinutes: 1,
      activityRetentionDays: 3650,
    });
    await setSettings({ activity_idle_minutes: 'soon', activity_retention_days: 30.4 });
    expect(await settings.getAll()).toMatchObject({
      activityIdleMinutes: 5,
      activityRetentionDays: 30,
    });
  });
});

describe('cleanup job', () => {
  it('deletes screen time older than activityRetentionDays at 03:00', async () => {
    await setSettings({ timezone: 'Asia/Kolkata', activity_retention_days: 30 });
    const segment = (workDate) => ({
      userId: vishal.id,
      workDate,
      state: 'active',
      source: 'system',
      startedAt: new Date(`${workDate}T04:00:00Z`),
      endedAt: new Date(`${workDate}T05:00:00Z`),
    });
    // Today is Mon 5 Oct in Kolkata: keep 5 Sep and later.
    await db('activitySegments').insert([
      segment('2026-09-03'),
      segment('2026-09-04'),
      segment('2026-09-05'),
      segment('2026-10-05'),
    ]);
    setNowForTests('2026-10-04T21:30:00Z'); // 03:00 on 5 Oct
    const run = await cleanupJob.tick();
    expect(run).toMatchObject({ status: 'done', result: { activitySegments: 2 } });
    expect(
      (await db('activitySegments').orderBy('workDate').select('workDate')).map((r) => r.workDate),
    ).toEqual(['2026-09-05', '2026-10-05']);
  });
});
