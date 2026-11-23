// Builder D's part of the attendance module (CONTRACT 25, items 5 and 1), spread into index.js:
// one Remind mechanism with the 30-minute rule, the automatic check-in reminder, and the morning
// HR summary and evening wrap-up. Functions and constants only (index.js spreads this while
// attendance and timers import each other).
export {
  REMIND_EVERY_MINUTES,
  REMIND_KINDS,
  nextRemindAt,
  remindKindFor,
  remindSkipFor,
} from './remindRules';
export { deleteOldReminders, listReminders, remind } from './reminders';
export { sendCheckinReminders } from './checkinReminders';
export { eveningSummaryMinutes, sendHrEveningSummary, sendHrMorningSummary } from './hrSummary';
