// The timers module (CONTRACT 15): project timers that fill the daily report. The rules live in
// their own files; this file re-exports them so the module has one service object.
// - state.js: getState, getDaySummary
// - running.js: start, stop, stopRunning, stopAllRunning, resumeAfterBreak
// - entries.js: addEntry, updateEntry, removeEntry (changes by hand, audited)
// - away.js, awayRules.js: the away question about today's timer entries (CONTRACT 25 A)
// - awayAnswer.js: resolveAway (Keep, Remove as an away break, "I had left")
// - awayPutBack.js: putBackAway (Today's Put back)
// - worker.js: closeForgotten, sendReminders, lastRanAt (auto check-out, CONTRACT 19),
//   lastRanByUser (the suggested check-out time, CONTRACT 25), listEntriesFor (HR's break fixes)
// - forgotten.js: the midnight rule for a timer left running from an earlier day (the worker, and
//   any start or stop that finds one first)
// - taskMinutes.js: minutesByTask, the finished minutes per task (CONTRACT 28)
export { resolveAway } from './awayAnswer';
export { putBackAway } from './awayPutBack';
export { addEntry, removeEntry, updateEntry } from './entries';
export { resumeAfterBreak, start, stop, stopAllRunning, stopRunning } from './running';
export { canUse } from './shared';
export { forgetAway, getDaySummary, getState } from './state';
export { closeForgotten, lastRanAt, lastRanByUser, listEntriesFor, sendReminders } from './worker';
export { minutesByTask } from './taskMinutes';
