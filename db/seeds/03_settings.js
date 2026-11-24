// Default company settings. Safe to run twice: existing keys keep the value Admin saved.
export const DEFAULT_SETTINGS = {
  company_name: '[Company name]',
  timezone: 'Asia/Kolkata',
  working_days: [1, 2, 3, 4, 5], // Monday = 1
  office_start: '09:30',
  office_end: '18:30',
  late_after: '09:30',
  report_reminder_at: '18:30',
  report_lock: 'next_day_12:00',
  gap_warning_minutes: 90,
  stuck_task_days: 5,
  allow_unverified_office: true,
  auto_mark_missing_checkout: true,
  slack_enabled: true,
  slack_report_channel_id: null, // null until Admin picks a channel
  slack_report_channel_name: null,
  // Today's to-do (CONTRACT 24): their own channel; null = to-dos are not posted
  slack_todo_channel_id: null,
  slack_todo_channel_name: null,
  slack_post_reports: true,
  slack_remind: true,
  slack_urgent_notify: true,
  slack_requests_notify: true,
  // Screen time (company request after the build guide)
  activity_tracking_enabled: true,
  activity_idle_minutes: 5, // no mouse or keyboard for this long counts as idle (min 1)
  activity_retention_days: 365, // older screen-time segments are deleted by the cleanup job
  // Desktop notifications (company request after the build guide)
  push_enabled: true,
  // Project timers and breaks (company request after the build guide)
  timers_mode: 'optional', // off | optional | required
  timer_away_minutes: 25, // idle or locked this long while a timer runs: ask "keep or remove?"
  timer_reminder_minutes: 25, // remind after this long checked in with no timer (0 = never)
  break_allowance_minutes: 60, // breaks above this in a day are flagged (0 = no allowance)
  // Check-in rules (company request after the build guide)
  office_checkin_anywhere: false, // true: Office check-in works from any network
  wfh_requires_approval: true, // true: WFH only on days HR approved (HR and Admins excepted)
  // Auto check-out (company request after the build guide, CONTRACT 19)
  auto_checkout_enabled: true, // inactive after office end until this time: checked out
  auto_checkout_at: '20:00',
  // AI with Gemini (company request after the build guide, CONTRACT 20)
  ai_enabled: false, // Admin switches AI on after adding GEMINI_API_KEY
  ai_daily_limit: 200, // Gemini requests per day for the whole company
  ai_polish_enabled: true,
  ai_pm_summary_enabled: true,
  ai_pm_summary_at: '19:00',
  ai_summary_slack: true, // also send the PM summary as a Slack DM
  ai_hr_notes_enabled: true, // weekly, on the last working day of the week
  ai_hr_notes_at: '19:00',
  ai_ask_enabled: true,
  // Project management (company request, CONTRACT 22)
  ai_project_summary_enabled: false, // PMs write a summary from a project's files and notes
  // Attendance marks (CONTRACT 25, items 3 and 4). Worked = present time less breaks.
  half_day_under_minutes: 270, // a finished working day worked under this is a Half day (0 = off)
  short_day_under_minutes: 480, // worked under this, and not a Half day: Short day (0 = off)
  left_early_grace_minutes: 15, // out more than this before their own shift end: Left early
  payroll_month_start_day: 1, // 1 = calendar months; 26 = the 26th to the 25th, named after its end
  // HR updates (CONTRACT 25, items 1, 5 and 10)
  hr_morning_summary: true, // bell, desktop push and Slack DM to HR on working days
  hr_summary_at: '10:00', // at or after Late after, before office end
  hr_evening_summary: false, // sent at office end + 30 minutes
  checkin_reminder_minutes: 30, // after each person's own late mark, once a day (0 = off)
  late_alert_days: 4, // HR is told once per person per payroll month; also Needs a look
  // Slack (CONTRACT 25)
  slack_attendance_remind: true, // check-in reminders and the ones HR sends from Attendance
  slack_hr_summary: true, // the morning summary and the evening wrap-up
  // Files (CONTRACT 27): a missing row reads as these, since the live server never seeds
  file_max_mb: 500, // the largest single file, whole MB from 1 to 2,048
  file_storage_limit_gb: 10, // all project files together, whole GB from 1 to 1,000
};

export async function seed(knex) {
  const existing = new Set((await knex('settings').select('key')).map((row) => row.key));
  const missing = Object.entries(DEFAULT_SETTINGS)
    .filter(([key]) => !existing.has(key))
    .map(([key, value]) => ({ key, value: JSON.stringify(value) }));
  if (missing.length > 0) await knex('settings').insert(missing);
}
