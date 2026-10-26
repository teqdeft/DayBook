// AI summaries (CONTRACT 20): a PM's daily project summary and HR's weekly attendance notes,
// written by the worker with Gemini (`@/modules/ai`), and what the /summaries pages read.
// - sendPmSummaries(date) / sendHrNotes(date): the worker jobs ai-pm-summary and ai-hr-notes;
// - isoWeekKey(date) / lastWorkingDayOfWeek(date, workingDays): when HR notes run;
// - listMine({ user, page }) / getMine({ user, id }) / countMine(user): the person's own
//   summaries, of the kinds their role opens now.
export {
  sendPmSummaries,
  planSummaries,
  setRunBudgetForTests,
  PM_SUMMARY_TITLE,
} from './pmSummary';
export { sendHrNotes, countWeek, HR_NOTES_TITLE } from './hrNotes';
export { dayBounds, isoWeekKey, lastWorkingDayOfWeek } from './calendar';
export { listMine, getMine, countMine, readableKinds, periodLabel, PAGE_SIZE } from './view';
export { cleanBody, cleanTitle, bellBody, toBlocks, AI_NOTE } from './text';
export { SUMMARY_SCHEMA } from './writing';
