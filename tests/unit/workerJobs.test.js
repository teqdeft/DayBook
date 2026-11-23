// The worker's job lists (CONTRACT 25, "Modules"): every job in src/worker/jobs is scheduled by
// both workers, the cron run (src/worker/cron.js, one pass a minute on cPanel) and the long-running
// one (src/worker/index.js). The four HR jobs run before cleanup and never wait in SLOW_JOBS, and
// at 00:05 a timer still running from yesterday is closed before its row is marked missing. Both
// files start their process on import, so this reads their source.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKER = new URL('../../src/worker/', import.meta.url);
const read = (name) => readFileSync(new URL(name, WORKER), 'utf8');
const HR_JOBS = ['checkinRemindersJob', 'hrSummaryJob', 'hrEveningSummaryJob', 'lateAlertsJob'];

/** The job names inside `const <list> = [ ... ]` (or `new Set([ ... ])`) of a source file. */
function listOf(source, list) {
  const match = new RegExp(`const ${list} = (?:new Set\\()?\\[([^\\]]*)\\]`).exec(source);
  expect(match, list).not.toBeNull();
  return match[1].match(/\w+Job\b/g) ?? [];
}

/** One `<name>Job` per file in src/worker/jobs, as each file exports it. */
const jobFiles = readdirSync(new URL('jobs/', WORKER))
  .filter((file) => file.endsWith('.js'))
  .map((file) => `${file.replace(/\.js$/, '')}Job`);

describe('the cron run (src/worker/cron.js)', () => {
  const source = read('cron.js');
  const minute = listOf(source, 'MINUTE_JOBS');
  const fast = listOf(source, 'FAST_JOBS');

  it('runs every job once, in the minute pass or the sending loop', () => {
    expect([...minute, ...fast].sort()).toEqual([...jobFiles].sort());
  });

  it('runs the four HR jobs before cleanup, none of them left for a later run', () => {
    for (const job of HR_JOBS) {
      expect(minute.indexOf(job), job).toBeGreaterThan(-1);
      expect(minute.indexOf(job), job).toBeLessThan(minute.indexOf('cleanupJob'));
    }
    expect(listOf(source, 'SLOW_JOBS')).toEqual(['aiPmSummaryJob', 'aiHrNotesJob']);
  });

  it('closes forgotten timers before marking missing check-outs', () => {
    expect(minute.indexOf('closeOpenTimersJob')).toBeLessThan(
      minute.indexOf('markMissingCheckoutsJob'),
    );
  });
});

describe('the long-running worker (src/worker/index.js)', () => {
  const jobs = listOf(read('index.js'), 'JOBS');

  it('schedules every job once, the four HR jobs included', () => {
    expect([...jobs].sort()).toEqual([...jobFiles].sort());
    expect(new Set(jobs).size).toBe(jobs.length);
  });

  it('starts close-open-timers before mark-missing-checkouts', () => {
    expect(jobs.indexOf('closeOpenTimersJob')).toBeLessThan(
      jobs.indexOf('markMissingCheckoutsJob'),
    );
  });
});
