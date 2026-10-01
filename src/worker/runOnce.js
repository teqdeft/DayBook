// runOnce(job, runKey, fn): runs fn at most once per run key, across restarts and several workers.
// The unique job_runs.run_key does the work: the first insert wins, every later one is a duplicate.
import { logger } from '@/lib/logger';
import { nowDate } from '@/lib/time';
import * as repo from './repo';

// Keys this process already handled, so a daily job that checks every minute doesn't try the
// insert again on every tick.
const handledKeys = new Set();

/** Tests only: forget the keys this process has handled (the job_runs rows stay). */
export function forgetHandledKeysForTests() {
  handledKeys.clear();
}

function describeError(error) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 1000);
}

/**
 * Runs fn once for a run key such as 'report_reminder:2026-10-01'. A key that already has a
 * job_runs row (done, failed or still running) is skipped. A failed run is logged and marked
 * failed; it is not retried automatically (the logs are the alert).
 * @param {string} job for example 'report-reminder'
 * @param {string} runKey unique per run, for example 'report_reminder:2026-10-01'
 * @param {() => Promise<unknown>} fn
 * @param {{ quiet?: boolean }} [options] quiet: log a successful run at debug level instead of
 *   info, for a frequent job that logs its own result (failures are always logged as errors)
 * @returns {Promise<{ status: 'done', result: unknown } | { status: 'skipped' } |
 *   { status: 'failed', error: unknown }>}
 * @throws only when job_runs itself can't be written (for example the database is down); the
 *   key is then tried again on the next tick
 */
export async function runOnce(job, runKey, fn, { quiet = false } = {}) {
  if (handledKeys.has(runKey)) return { status: 'skipped' };
  let id;
  try {
    id = await repo.insertRun({ job, runKey, startedAt: nowDate() });
  } catch (error) {
    if (error?.errno !== 1062) throw error;
    handledKeys.add(runKey);
    logger.debug({ job, runKey }, 'job already ran for this key; skipped');
    return { status: 'skipped' };
  }
  handledKeys.add(runKey);

  const started = performance.now();
  let outcome;
  try {
    outcome = { status: 'done', result: await fn() };
  } catch (error) {
    outcome = { status: 'failed', error };
  }
  const durationMs = Math.round(performance.now() - started);
  try {
    await repo.finishRun(id, {
      status: outcome.status,
      finishedAt: nowDate(),
      error: outcome.status === 'failed' ? describeError(outcome.error) : null,
    });
  } catch (error) {
    logger.error({ err: error, job, runKey }, 'could not record the job result');
  }
  if (outcome.status === 'done') {
    const level = quiet ? 'debug' : 'info';
    logger[level]({ job, runKey, result: outcome.result ?? null, durationMs }, 'job done');
  } else {
    logger.error({ err: outcome.error, job, runKey, durationMs }, 'job failed');
  }
  return outcome;
}
