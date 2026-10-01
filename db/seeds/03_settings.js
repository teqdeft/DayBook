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
};

export async function seed(knex) {
  const existing = new Set((await knex('settings').select('key')).map((row) => row.key));
  const missing = Object.entries(DEFAULT_SETTINGS)
    .filter(([key]) => !existing.has(key))
    .map(([key, value]) => ({ key, value: JSON.stringify(value) }));
  if (missing.length > 0) await knex('settings').insert(missing);
}
