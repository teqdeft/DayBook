// How loudly each notification type alerts (CONTRACT 26): 'important' types ask the reader to act
// today (check in or out, end a break, add a missing time, start a timer, send a report, decide a
// request, drop other work for an urgent project) and are the ones the "Important only" Sound
// choice chimes for (since CONTRACT 28 the default Sound is All, which chimes for every type);
// every other type is 'normal'. Pure and browser-safe (no imports), so the bell's client code
// imports it too, an exception to CONTRACT 2 like @/modules/reports/todoText.

/**
 * Every type Daybook creates, with its level: 45 types, 19 important, 26 normal. The table in
 * CONTRACT 26 is the contract (CONTRACT 27 adds project_task.files_added, CONTRACT 28
 * project_task.reassigned).
 */
export const ALERT_TYPES = Object.freeze({
  // Important (19)
  'attendance.checkin_reminder': 'important',
  'attendance.remind_check_in': 'important',
  'attendance.remind_break': 'important',
  'attendance.remind_check_out': 'important',
  'attendance.remind_missing_checkout': 'important',
  'attendance.checkout_reminder': 'important',
  'attendance.auto_checkout': 'important',
  'attendance.missing_checkout': 'important',
  'attendance.unverified_office': 'important',
  'attendance_correction.requested': 'important',
  'attendance.hr_summary': 'important',
  'wfh_request.created': 'important',
  'project.urgent': 'important',
  'project_request.created': 'important',
  'report_edit.requested': 'important',
  'report.reminder': 'important',
  'timer.reminder': 'important',
  'timer.stopped_midnight': 'important',
  'system.test': 'important',
  // Normal (26)
  'attendance_correction.approved': 'normal',
  'attendance_correction.rejected': 'normal',
  'attendance.self_checkout_past': 'normal',
  'attendance.edited': 'normal',
  'attendance.break_over_allowance': 'normal',
  'attendance.hr_evening_summary': 'normal',
  'attendance.late_alert': 'normal',
  'holiday.past_changed': 'normal',
  'leave.marked': 'normal',
  'leave.changed': 'normal',
  'leave.removed': 'normal',
  'wfh_request.approved': 'normal',
  'wfh_request.declined': 'normal',
  'project.created': 'normal',
  'project.member_added': 'normal',
  'project_request.approved': 'normal',
  'project_request.declined': 'normal',
  'project_task.added': 'normal',
  'project_task.changed': 'normal',
  'project_task.files_added': 'normal',
  'project_task.reassigned': 'normal',
  'report_edit.sent': 'normal',
  'report_edit.approved': 'normal',
  'report_edit.declined': 'normal',
  'ai.pm_summary': 'normal',
  'ai.hr_notes': 'normal',
});

/** A type's group (its card icon) by the part before the dot. */
export const ALERT_GROUPS = Object.freeze({
  attendance: 'attendance',
  attendance_correction: 'attendance',
  leave: 'calendar',
  holiday: 'calendar',
  wfh_request: 'calendar',
  project: 'project',
  project_request: 'project',
  project_task: 'task',
  report: 'report',
  report_edit: 'report',
  timer: 'timer',
  ai: 'ai',
  system: 'system',
});

/** True when the type is listed in ALERT_TYPES (own keys only, so "toString" isn't). */
export function isClassified(type) {
  return typeof type === 'string' && Object.hasOwn(ALERT_TYPES, type);
}

/**
 * How loudly a type alerts.
 * @param {string} type for example 'attendance.remind_check_in'
 * @returns {'important' | 'normal'} 'normal' for a type that isn't listed
 */
export function alertLevel(type) {
  return isClassified(type) ? ALERT_TYPES[type] : 'normal';
}

/** True when the type chimes under the "Important only" Sound choice. */
export function isImportant(type) {
  return alertLevel(type) === 'important';
}

/**
 * A type's group, from the part before the first dot.
 * @param {string} type
 * @returns {'attendance' | 'calendar' | 'project' | 'task' | 'report' | 'timer' | 'ai' | 'system'}
 *   'system' for an unknown prefix
 */
export function alertGroup(type) {
  const prefix = typeof type === 'string' ? type.split('.')[0] : '';
  return Object.hasOwn(ALERT_GROUPS, prefix) ? ALERT_GROUPS[prefix] : 'system';
}

/**
 * Throws when a type isn't listed (notifications.notify calls it under Vitest, so a new type fails
 * the creating module's service test until it is classified).
 * @param {string} type
 * @throws Error naming the type and CONTRACT 26
 */
export function assertClassified(type) {
  if (isClassified(type)) return;
  throw new Error(
    `Notification type "${type}" has no alert level. Add it to ALERT_TYPES (CONTRACT 26).`,
  );
}
