// job_runs: one row per run key, so a job never runs twice for the same key.
import { db } from '@/lib/db';

/** Inserts a 'running' row. Throws a duplicate-key error (errno 1062) when the key already ran. */
export async function insertRun({ job, runKey, startedAt }, trx = db) {
  const [id] = await trx('job_runs').insert({
    job,
    runKey,
    status: 'running',
    startedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  });
  return id;
}

/** Marks a run done or failed. */
export function finishRun(id, { status, finishedAt, error = null }, trx = db) {
  return trx('job_runs').where({ id }).update({ status, finishedAt, error, updatedAt: finishedAt });
}

export function findRunByKey(runKey, trx = db) {
  return trx('job_runs').where({ runKey }).first();
}

/** Deletes runs started before a moment (the daily cleanup). Returns how many were deleted. */
export function deleteRunsStartedBefore(before, trx = db) {
  return trx('job_runs').where('startedAt', '<', before).delete();
}
