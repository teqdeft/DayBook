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
  addTodoLine,
  addTodoLines,
  updateTodoLine,
  removeTodoLine,
  removeTodoProject,
  startTodoTimer,
  queueTodoPost,
} from './todo';
