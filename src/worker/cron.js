// The worker for hosts that can't keep a process running (shared cPanel hosting): run it from a
// cron job every minute with `npm run worker:cron`. Each run does one pass of the minute jobs
// (reminders, missing check-outs, cleanup, Slack user sync, health log — their run keys make them
// run once per day, hour or 5 minutes), then sends Slack messages and desktop pushes every 10
// seconds for about 50 seconds, and exits. A MySQL named lock keeps two runs from overlapping.
// On a server that can keep a process running, use `npm run worker` (src/worker/index.js) instead.
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { cleanupJob } from './jobs/cleanup';
import { healthLogJob } from './jobs/healthLog';
import { markMissingCheckoutsJob } from './jobs/markMissingCheckouts';
import { pushNotificationsJob } from './jobs/pushNotifications';
import { reportReminderJob } from './jobs/reportReminder';
import { slackOutboxJob } from './jobs/slackOutbox';
import { slackUserSyncJob } from './jobs/slackUserSync';

const LOCK_NAME = 'daybook_worker_cron';
const MINUTE_JOBS = [
  reportReminderJob,
  markMissingCheckoutsJob,
  cleanupJob,
  slackUserSyncJob,
  healthLogJob,
];
const FAST_JOBS = [slackOutboxJob, pushNotificationsJob];
const FAST_EVERY_MS = 10_000;

/** `--seconds=50` (default): how long this run keeps sending before it exits. */
function runSeconds() {
  const arg = process.argv.find((value) => value.startsWith('--seconds='));
  const seconds = arg ? Number(arg.split('=')[1]) : 50;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 55) : 50;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runJob(job) {
  try {
    await job.tick();
  } catch (error) {
    logger.error({ err: error, job: job.name }, 'job tick failed');
  }
}

async function main() {
  if (!env.WORKER_CRON_ENABLED) {
    logger.info('worker cron: WORKER_CRON_ENABLED=false, nothing to do');
    return;
  }
  // The lock lives on one connection (a transaction pins it); it is released when that connection
  // ends, so a crashed run never blocks the next one.
  await db.transaction(async (trx) => {
    const [rows] = await trx.raw('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME]);
    if (Number(rows[0]?.got) !== 1) {
      logger.info('worker cron: the previous run is still going; this run is skipped');
      return;
    }
    try {
      for (const job of MINUTE_JOBS) await runJob(job);
      const endAt = Date.now() + runSeconds() * 1000;
      do {
        const started = Date.now();
        for (const job of FAST_JOBS) await runJob(job);
        const pause = FAST_EVERY_MS - (Date.now() - started);
        if (Date.now() + pause >= endAt) break;
        if (pause > 0) await wait(pause);
      } while (Date.now() < endAt);
    } finally {
      await trx.raw('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
  });
}

main()
  .catch((error) => {
    logger.fatal({ err: error }, 'worker cron run failed');
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
