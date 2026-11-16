// Deploy before migrate (CONTRACT 24): until `npm run migrate` has run migration 017,
// daily_reports.todo_posted_at and report_tasks.carry_closed_at / carry_closed_reason are missing.
// The dashboard reads that use them run once more without them (the board shows no Slack post,
// closed lines count as open again, as before 1.09), with one warning in the log per process. As
// soon as the migration has run they are used again, without a restart.
import { logger } from '@/lib/logger';

const NO_SUCH_COLUMN = 1054;

let warned = false;

function warnTodoColumnsMissing() {
  if (warned) return;
  warned = true;
  logger.warn(
    'The to-do columns are missing (run npm run migrate); dashboards read without to-do posts and closed lines',
  );
}

/**
 * Runs a read with the migration 017 columns (`read(true)`); when the database answers "no such
 * column" (errno 1054) it runs `read(false)` instead, which leaves them out. Other errors throw.
 * @template T
 * @param {(withTodoColumns: boolean) => Promise<T>} read
 * @returns {Promise<T>}
 */
export async function readWithTodoColumns(read) {
  try {
    return await read(true);
  } catch (error) {
    if (error?.errno !== NO_SUCH_COLUMN) throw error;
    warnTodoColumnsMissing();
    return read(false);
  }
}
