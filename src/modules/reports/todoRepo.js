// Queries for today's to-do (CONTRACT 24) that repo.js doesn't have: the open tasks the to-do's
// carried lines continue. Kept apart from repo.js, which holds every other reports query, only
// for its size. A to-do line is an ordinary report_tasks line of today's draft, so every other
// read and write goes through repo.js.
import { db } from '@/lib/db';

/**
 * The lines carried lines continue, with their status and report day: the "From Wednesday" tag
 * of a carried to-do line, and the status a line added from a suggestion keeps.
 * @param {number[]} ids report_tasks ids of the sources
 * @param {import('knex').Knex} [trx]
 * @returns {Promise<Array<{ id: number, status: string, workDate: string }>>}
 */
export function listSourceLines(ids, trx = db) {
  if (ids.length === 0) return Promise.resolve([]);
  return trx('reportTasks as t')
    .join('reportEntries as e', 'e.id', 't.entryId')
    .join('dailyReports as d', 'd.id', 'e.reportId')
    .whereIn('t.id', ids)
    .select('t.id', 't.status', 'd.workDate');
}
