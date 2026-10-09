// Whole-number settings: shown as text, saved as numbers. The limits and messages are the API's
// (src/modules/settings/schemas.js); tests/services/timersSettings.test.js checks they agree.
// Plain data, so the client form and the tests can both import it.

export const NUMBERS = Object.freeze({
  // Screen time (CONTRACT 11)
  activityIdleMinutes: {
    min: 1,
    max: 120,
    message: 'Idle time must be between 1 and 120 minutes.',
  },
  activityRetentionDays: {
    min: 7,
    max: 3650,
    message: 'Keep screen time for 7 to 3650 days.',
  },
  // Project timers and breaks (CONTRACT 15)
  timerAwayMinutes: {
    min: 5,
    max: 240,
    message: 'Away time must be between 5 and 240 minutes.',
  },
  timerReminderMinutes: {
    min: 0,
    max: 240,
    message: 'The reminder must be between 0 and 240 minutes (0 turns it off).',
  },
  breakAllowanceMinutes: {
    min: 0,
    max: 480,
    message: 'The break allowance must be between 0 and 480 minutes (0 means no allowance).',
  },
});

/** "Project timers" choices; the values are the API's timersMode values. */
export const TIMER_MODE_OPTIONS = Object.freeze([
  { value: 'off', label: 'Off' },
  { value: 'optional', label: 'Optional — people can still type hours' },
  { value: 'required', label: 'Required — report hours come from timers' },
]);
