// The reports module's public functions (import them through '@/modules/reports'). The rules live
// in the files below, split by meaning:
//   drafts.js        opening a report (an empty draft)
//   save.js          writing entries and tasks (project and stale-save checks) and autosave
//   links.js         priority task links on task lines (CONTRACT section 13)
//   submit.js        submit rules, revisions, the Slack post
//   timerCheck.js    required timer mode (CONTRACT 15) and the day's timers the report shows
//   editRequests.js  edit requests after the lock
//   queries.js       reads other modules rely on, stuck tasks, report lists
//   reminders.js     the report-reminder job
//   monthLog.js      My log
//   suggestions.js   unfinished-task suggestions and closing them (CONTRACT 24)
//   carry.js         the checks on a line carried from a suggestion (CONTRACT 24)
//   todo.js          today's to-do: reading it, its writes, Play and Post to Slack (CONTRACT 24)
// and, below, two yes-or-no reads for HR's attendance screens (CONTRACT 25): never the content.
import * as repo from './repo';

export { openForDate } from './drafts';
export { saveReport, submitReport, submitProblems } from './submit';
export {
  requestEdit,
  approveEditRequest,
  declineEditRequest,
  pageEditRequestsFor,
  listPendingEditRequestsFor,
  listHandledEditRequestsFor,
  countPendingEditRequestsFor,
  listMyEditRequests,
} from './editRequests';
export {
  getDayStatus,
  getSubmittedMinutesByDay,
  listStuckTasks,
  hasEntriesForProjectRequest,
  moveProjectRequestEntries,
  saveSlackMessage,
  saveTodoSlackMessage,
  findTodoPost,
  getMinutesByProject,
  listMinutesByProject,
  getLastReportDateByProject,
  getReport,
  listRevisions,
  listReports,
} from './queries';
export { sendReportReminders } from './reminders';
export { getMonthLog, lockRuleText } from './monthLog';
export { monthLogWorkbook } from './logExport';
export { isEditable } from './view';
export { getPriorityLinks } from './links';
export { getTimersForReport, timersForReport } from './timerCheck';
export { listCarrySuggestions, closeSuggestion } from './suggestions';
export {
  getTodo,
  todoTakesLines,
  addTodoLine,
  addTodoLines,
  updateTodoLine,
  removeTodoLine,
  removeTodoProject,
  startTodoTimer,
  queueTodoPost,
} from './todo';

/** Distinct positive integer ids. */
function cleanIds(userIds) {
  return [...new Set((userIds ?? []).map(Number))].filter((id) => Number.isInteger(id) && id > 0);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which of these people submitted their report for one day (CONTRACT 25: the HR summaries and
 * reminders). Yes or no only: never the report.
 * @param {number[]} userIds
 * @param {string} workDate 'YYYY-MM-DD'
 * @returns {Promise<number[]>} the ids (of the given ones) with a submitted report that day
 */
export async function listSubmittedUserIds(userIds, workDate) {
  const ids = cleanIds(userIds);
  if (ids.length === 0 || !DATE.test(String(workDate))) return [];
  return repo.listSubmittedUserIds(ids, workDate);
}

/**
 * The days each person submitted a report in a range, in one query (CONTRACT 25: the month view,
 * the person month and "Needs a look" count missing reports). Dates only, never the content.
 * @param {{ userIds: number[], from: string, to: string }} input company dates 'YYYY-MM-DD'
 * @returns {Promise<Record<number, string[]>>} { [userId]: dates oldest first }; people without
 *   a submitted report in the range are left out
 */
export async function listSubmittedDays({ userIds, from, to } = {}) {
  const ids = cleanIds(userIds);
  if (ids.length === 0 || !DATE.test(String(from)) || !DATE.test(String(to)) || from > to) {
    return {};
  }
  const days = {};
  for (const row of await repo.listSubmittedDays(ids, from, to)) {
    (days[row.userId] ??= []).push(row.workDate);
  }
  return days;
}
