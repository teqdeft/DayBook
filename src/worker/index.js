// The worker process (npm run worker): schedules the six jobs of build guide section 12, plus the
// desktop-push job (CONTRACT 14), with node-cron. Ticks run in UTC; each job decides in company
// time. Stop it with Ctrl-C / SIGTERM (or the 'shutdown' message process managers send on
// Windows): it stops scheduling, waits for running jobs, then closes the database pool. A job
// whose previous tick is still running skips the new tick (the overlap guard in tick()).
import { env } from '@/lib/env';
import cron from 'node-cron';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { push } from '@/modules/push';
import { slack } from '@/modules/slack';
import { cleanupJob } from './jobs/cleanup';
import { healthLogJob } from './jobs/healthLog';
import { markMissingCheckoutsJob } from './jobs/markMissingCheckouts';
import { pushNotificationsJob } from './jobs/pushNotifications';
import { reportReminderJob } from './jobs/reportReminder';
import { slackOutboxJob } from './jobs/slackOutbox';
import { slackUserSyncJob } from './jobs/slackUserSync';

const JOBS = [
  slackOutboxJob,
  pushNotificationsJob,
  reportReminderJob,
  markMissingCheckoutsJob,
  slackUserSyncJob,
  cleanupJob,
  healthLogJob,
];
const STOP_WAIT_MS = 30_000;

const tasks = [];
const running = new Map();
let stopping = false;

// node-cron's own messages go to pino instead of the console.
const cronLogger = {
  info: (message) => logger.debug({ source: 'node-cron' }, String(message)),
  debug: (message) => logger.debug({ source: 'node-cron' }, String(message)),
  warn: (message) => logger.warn({ source: 'node-cron' }, String(message)),
  error: (message, error) =>
    logger.error(
      { source: 'node-cron', err: message instanceof Error ? message : error },
      String(message?.message ?? message),
    ),
};

/** Runs one tick of a job, unless its previous tick is still running. Never throws. */
function tick(job) {
  if (stopping) return;
  if (running.has(job.name)) {
    logger.debug({ job: job.name }, 'previous run still going; tick skipped');
    return;
  }
  const promise = Promise.resolve()
    .then(() => job.tick())
    .catch((error) => logger.error({ err: error, job: job.name }, 'job tick failed'))
    .finally(() => running.delete(job.name));
  running.set(job.name, promise);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());

async function shutdown(reason) {
  if (stopping) {
    logger.warn({ reason }, 'worker: second stop request, exiting now');
    process.exit(1);
  }
  stopping = true;
  logger.info({ reason }, 'worker stopping');
  await Promise.all(tasks.map((task) => task.destroy()));
  if (running.size > 0) {
    logger.info({ jobs: [...running.keys()] }, 'waiting for running jobs to finish');
    await Promise.race([Promise.allSettled([...running.values()]), wait(STOP_WAIT_MS)]);
  }
  await db.destroy();
  logger.info('worker stopped');
  process.exit(0);
}

async function start() {
  if (!env.WORKER_CRON_ENABLED) {
    logger.info('worker: WORKER_CRON_ENABLED=false, so no jobs are scheduled here; exiting');
    await db.destroy();
    return;
  }
  // Fails fast (and exits) when the database can't be reached.
  const health = await slack.outboxHealth();

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('message', (message) => {
    if (message === 'shutdown') shutdown('shutdown message');
  });

  for (const job of JOBS) {
    tasks.push(
      cron.schedule(job.cron, () => tick(job), {
        name: job.name,
        timezone: 'Etc/UTC',
        logger: cronLogger,
      }),
    );
  }
  logger.info(
    {
      jobs: JOBS.map((job) => `${job.name} (${job.cron})`),
      slackConfigured: slack.isConfigured(),
      pushConfigured: push.isConfigured(),
      pendingSlackMessages: health.pending,
    },
    'worker started',
  );
}

process.on('unhandledRejection', (error) => {
  logger.error({ err: error }, 'worker: unhandled promise rejection');
});

start().catch(async (error) => {
  logger.fatal({ err: error }, 'worker could not start');
  await db.destroy().catch(() => {});
  process.exit(1);
});
