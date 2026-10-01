import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, toJson } from '@/lib/db';
import { logger } from '@/lib/logger';
import { now, setNowForTests } from '@/lib/time';
import { setSlackClientForTests } from '@/modules/slack/client';
import { forgetHandledKeysForTests, runOnce } from '@/worker/runOnce';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

// The jobs call other owners' services; here they only need to be called with the right day.
const { sendReportReminders, markMissingCheckouts, syncSlackUserIds } = vi.hoisted(() => ({
  sendReportReminders: vi.fn(async () => ({ reminded: 3 })),
  markMissingCheckouts: vi.fn(async () => ({ marked: 1 })),
  syncSlackUserIds: vi.fn(async () => ({ updated: 2 })),
}));
vi.mock('@/modules/reports', () => ({ reports: { sendReportReminders } }));
vi.mock('@/modules/attendance', () => ({ attendance: { markMissingCheckouts } }));
vi.mock('@/modules/users', () => ({ users: { syncSlackUserIds } }));

const { reportReminderJob } = await import('@/worker/jobs/reportReminder');
const { markMissingCheckoutsJob } = await import('@/worker/jobs/markMissingCheckouts');
const { cleanupJob } = await import('@/worker/jobs/cleanup');
const { healthLogJob, healthLogRunKey } = await import('@/worker/jobs/healthLog');
const { slackUserSyncJob } = await import('@/worker/jobs/slackUserSync');

/** A Slack client stand-in: these jobs only ask whether Slack is configured. */
const fakeSlackClient = { chat: {}, auth: {}, conversations: {}, users: {} };

/** `days` days before the pinned now, as a Date. */
const daysAgo = (days) => now().subtract(days, 'day').toDate();

/** The run keys a job has used so far, oldest first. */
async function runKeysOf(job) {
  return (await db('job_runs').where({ job }).orderBy('id').select('runKey')).map(
    (row) => row.runKey,
  );
}

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(() => {
  forgetHandledKeysForTests();
  sendReportReminders.mockClear();
  markMissingCheckouts.mockClear();
  syncSlackUserIds.mockClear();
});

afterEach(() => {
  setSlackClientForTests(null);
  vi.restoreAllMocks();
});

describe('runOnce', () => {
  it('runs a key once; a second run with the same key is skipped, even after a restart', async () => {
    setNowForTests('2026-09-30T13:00:00Z');
    const fn = vi.fn(async () => ({ reminded: 2 }));
    expect(await runOnce('report-reminder', 'report_reminder:2026-09-30', fn)).toEqual({
      status: 'done',
      result: { reminded: 2 },
    });
    expect(await runOnce('report-reminder', 'report_reminder:2026-09-30', fn)).toEqual({
      status: 'skipped',
    });
    // A new process (no memory of handled keys) is stopped by the unique run_key.
    forgetHandledKeysForTests();
    expect(await runOnce('report-reminder', 'report_reminder:2026-09-30', fn)).toEqual({
      status: 'skipped',
    });
    expect(fn).toHaveBeenCalledTimes(1);

    const row = await db('job_runs').where({ runKey: 'report_reminder:2026-09-30' }).first();
    expect(row).toMatchObject({ job: 'report-reminder', status: 'done', error: null });
    expect(row.startedAt).toEqual(new Date('2026-09-30T13:00:00Z'));
    expect(row.finishedAt).toEqual(new Date('2026-09-30T13:00:00Z'));
  });

  it('two workers racing on one key run it once', async () => {
    const fn = vi.fn(async () => 'ok');
    const results = await Promise.all([
      runOnce('cleanup', 'cleanup:2026-09-30', fn),
      runOnce('cleanup', 'cleanup:2026-09-30', fn),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['done', 'skipped']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('marks a failed run failed with its error and does not retry it', async () => {
    const fn = vi.fn(async () => {
      throw new Error('Slack is down');
    });
    const result = await runOnce('mark-missing-checkouts', 'mark_missing_checkouts:2026-09-30', fn);
    expect(result.status).toBe('failed');
    expect(result.error.message).toBe('Slack is down');
    const row = await db('job_runs').where({ runKey: 'mark_missing_checkouts:2026-09-30' }).first();
    expect(row).toMatchObject({ status: 'failed', error: 'Error: Slack is down' });
    forgetHandledKeysForTests();
    expect(
      await runOnce('mark-missing-checkouts', 'mark_missing_checkouts:2026-09-30', fn),
    ).toEqual({
      status: 'skipped',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rethrows when job_runs cannot be written, so the next tick tries again', async () => {
    const fn = vi.fn();
    // run_key is NOT NULL, so this insert fails for a reason other than a duplicate key.
    await expect(runOnce('broken', null, fn)).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('daily jobs decide in company time', () => {
  it('report-reminder runs once per working day at report_reminder_at', async () => {
    await setSettings({
      report_reminder_at: '18:30',
      timezone: 'Asia/Kolkata',
      working_days: [1, 2, 3, 4, 5],
    });
    setNowForTests('2026-10-01T12:59:00Z'); // Thursday 18:29 in Kolkata
    expect(await reportReminderJob.tick()).toBeNull();
    setNowForTests('2026-10-01T13:00:00Z'); // 18:30
    expect(await reportReminderJob.tick()).toEqual({ status: 'done', result: { reminded: 3 } });
    expect(sendReportReminders).toHaveBeenCalledWith('2026-10-01');
    setNowForTests('2026-10-01T13:01:00Z');
    expect(await reportReminderJob.tick()).toEqual({ status: 'skipped' });
    // An Admin change applies on the next tick: a later reminder time the next day.
    await setSettings({ report_reminder_at: '19:00' });
    setNowForTests('2026-10-02T13:15:00Z'); // Friday 18:45
    expect(await reportReminderJob.tick()).toBeNull();
    setNowForTests('2026-10-02T13:30:00Z'); // 19:00
    expect((await reportReminderJob.tick()).status).toBe('done');
    expect(sendReportReminders).toHaveBeenLastCalledWith('2026-10-02');
    expect(sendReportReminders).toHaveBeenCalledTimes(2);
    setNowForTests('2026-10-03T13:35:00Z'); // Saturday
    expect(await reportReminderJob.tick()).toBeNull();
    expect(sendReportReminders).toHaveBeenCalledTimes(2);
  });

  it('mark-missing-checkouts runs at 00:05 company time, every day', async () => {
    setNowForTests('2026-10-03T18:34:00Z'); // 00:04 Sunday in Kolkata
    expect(await markMissingCheckoutsJob.tick()).toBeNull();
    setNowForTests('2026-10-03T18:35:00Z'); // 00:05
    expect((await markMissingCheckoutsJob.tick()).status).toBe('done');
    expect(
      await db('job_runs').where({ runKey: 'mark_missing_checkouts:2026-10-04' }).first(),
    ).toBeTruthy();
    expect(markMissingCheckouts).toHaveBeenCalledTimes(1);
  });
});

describe('cleanup (03:00 company time, once a day)', () => {
  const TABLES = {
    sessions: 'sessions',
    outbox: 'slack_outbox',
    notifications: 'notifications',
    runs: 'job_runs',
  };

  /** Rows each retention rule must delete or keep, by TABLES name. */
  async function insertCleanupRows() {
    const person = await createUser();
    const session = (name, expiresAt) =>
      db('sessions').insert({ userId: person.id, tokenHash: name.padEnd(64, '0'), expiresAt });
    const outbox = (status, createdAt) =>
      db('slack_outbox').insert({
        kind: 'dm',
        channel: 'U0TEST',
        payload: toJson({ text: 'Hi' }),
        status,
        nextAttemptAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });
    const notification = (readAt, createdAt) =>
      db('notifications').insert({
        userId: person.id,
        type: 'test',
        title: 'Test',
        readAt,
        createdAt,
        updatedAt: createdAt,
      });
    const run = (runKey, startedAt) =>
      db('job_runs').insert({
        job: 'test',
        runKey,
        status: 'done',
        startedAt,
        finishedAt: startedAt,
      });
    const ids = async (...inserts) => (await Promise.all(inserts)).map(([id]) => id);
    return {
      deleted: {
        sessions: await ids(session('expired', daysAgo(0.01))),
        outbox: await ids(outbox('sent', daysAgo(91))),
        notifications: await ids(notification(daysAgo(181), daysAgo(181))),
        runs: await ids(run('test:old', daysAgo(91))),
      },
      kept: {
        sessions: await ids(session('live', daysAgo(-1))),
        outbox: await ids(
          outbox('sent', daysAgo(89)),
          outbox('pending', daysAgo(120)),
          outbox('failed', daysAgo(120)),
        ),
        // Read 179 days ago (created earlier), and an old notification nobody read.
        notifications: await ids(
          notification(daysAgo(179), daysAgo(200)),
          notification(null, daysAgo(400)),
        ),
        runs: await ids(run('test:recent', daysAgo(89))),
      },
    };
  }

  const countIds = async (table, ids) =>
    Number((await db(table).whereIn('id', ids).count({ n: '*' }).first()).n);

  it('deletes expired sessions, sent Slack messages after 90 days, read notifications after 180 days and job runs after 90 days', async () => {
    await setSettings({ timezone: 'Asia/Kolkata' });
    setNowForTests('2026-10-04T21:29:00Z'); // 02:59 on Monday 5 Oct in Kolkata
    const rows = await insertCleanupRows();
    expect(await cleanupJob.tick()).toBeNull();

    setNowForTests('2026-10-04T21:30:00Z'); // 03:00
    expect(await cleanupJob.tick()).toEqual({
      status: 'done',
      result: {
        expiredSessions: 1,
        sentOutbox: 1,
        readNotifications: 1,
        jobRuns: 1,
        activitySegments: 0,
      },
    });
    for (const [name, table] of Object.entries(TABLES)) {
      expect(await countIds(table, rows.deleted[name]), `${name} deleted`).toBe(0);
      expect(await countIds(table, rows.kept[name]), `${name} kept`).toBe(rows.kept[name].length);
    }
    expect(await db('job_runs').where({ runKey: 'cleanup:2026-10-05' }).first()).toMatchObject({
      job: 'cleanup',
      status: 'done',
    });

    // Later the same day, in this worker or another one, it is skipped.
    setNowForTests('2026-10-04T23:00:00Z'); // 04:30
    expect(await cleanupJob.tick()).toEqual({ status: 'skipped' });
    forgetHandledKeysForTests();
    expect(await cleanupJob.tick()).toEqual({ status: 'skipped' });
    // The next day it runs again.
    setNowForTests('2026-10-05T21:30:00Z'); // 03:00 on Tuesday 6 Oct
    expect((await cleanupJob.tick()).status).toBe('done');
    expect((await runKeysOf('cleanup')).slice(-2)).toEqual([
      'cleanup:2026-10-05',
      'cleanup:2026-10-06',
    ]);
  });
});

describe('health-log (every 5 minutes)', () => {
  it('has one run key per 5-minute slot: the slot nearest the tick, in UTC', () => {
    setNowForTests('2026-10-01T10:05:00Z');
    expect(healthLogRunKey()).toBe('health_log:2026-10-01T10:05');
    setNowForTests('2026-10-01T10:04:59.900Z'); // a tick a moment early
    expect(healthLogRunKey()).toBe('health_log:2026-10-01T10:05');
    setNowForTests('2026-10-01T10:05:02Z'); // or a moment late
    expect(healthLogRunKey()).toBe('health_log:2026-10-01T10:05');
    setNowForTests('2026-10-01T23:58:00Z');
    expect(healthLogRunKey()).toBe('health_log:2026-10-02T00:00');
  });

  it('logs the queue once per slot, even with two workers, and warns after 15 minutes', async () => {
    await db('slack_outbox').delete();
    setNowForTests('2026-10-01T10:00:00Z');
    const createdAt = now().subtract(16, 'minute').toDate();
    await db('slack_outbox').insert({
      kind: 'dm',
      channel: 'U0TEST',
      payload: toJson({ text: 'Hi' }),
      status: 'pending',
      nextAttemptAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
    const info = vi.spyOn(logger, 'info');
    const warn = vi.spyOn(logger, 'warn');

    // Slack is not set up: a plain health line, no alert.
    expect(await healthLogJob.tick()).toEqual({
      status: 'done',
      result: expect.objectContaining({
        slackConfigured: false,
        pending: 1,
        oldestPendingMinutes: 16,
      }),
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ pending: 1 }), 'health');
    expect(warn).not.toHaveBeenCalled();

    // A second worker ticking in the same slot writes nothing.
    info.mockClear();
    forgetHandledKeysForTests();
    expect(await healthLogJob.tick()).toEqual({ status: 'skipped' });
    expect(info).not.toHaveBeenCalled();

    // Next slot, with Slack set up: the message has waited 21 minutes, so it is a warning.
    setSlackClientForTests(fakeSlackClient);
    setNowForTests('2026-10-01T10:05:00Z');
    expect((await healthLogJob.tick()).status).toBe('done');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ slackConfigured: true, pending: 1, oldestPendingMinutes: 21 }),
      'slack outbox is behind: a message has waited 21 minutes',
    );
    expect(info).not.toHaveBeenCalled();
    expect(await runKeysOf('health-log')).toEqual([
      'health_log:2026-10-01T10:00',
      'health_log:2026-10-01T10:05',
    ]);
  });
});

describe('slack-user-sync (every hour)', () => {
  it('is skipped while Slack is not set up or is turned off in Settings', async () => {
    setNowForTests('2026-10-01T10:00:00Z');
    await setSettings({ slack_enabled: true });
    expect(await slackUserSyncJob.tick()).toBeNull(); // no bot token
    setSlackClientForTests(fakeSlackClient);
    await setSettings({ slack_enabled: false });
    expect(await slackUserSyncJob.tick()).toBeNull();
    expect(syncSlackUserIds).not.toHaveBeenCalled();
    expect(await db('job_runs').where({ job: 'slack-user-sync' })).toHaveLength(0);
  });

  it('syncs once per UTC hour, even with two workers', async () => {
    setSlackClientForTests(fakeSlackClient);
    await setSettings({ slack_enabled: true });
    setNowForTests('2026-10-01T10:00:00Z');
    expect(await slackUserSyncJob.tick()).toEqual({ status: 'done', result: { updated: 2 } });
    setNowForTests('2026-10-01T10:59:00Z');
    forgetHandledKeysForTests();
    expect(await slackUserSyncJob.tick()).toEqual({ status: 'skipped' });
    setNowForTests('2026-10-01T11:00:00Z');
    expect((await slackUserSyncJob.tick()).status).toBe('done');
    expect(syncSlackUserIds).toHaveBeenCalledTimes(2);
    expect(await runKeysOf('slack-user-sync')).toEqual([
      'slack_user_sync:2026-10-01T10',
      'slack_user_sync:2026-10-01T11',
    ]);
  });
});
