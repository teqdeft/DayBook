// Settings form values: which keys the form edits, how saved settings become field text and back,
// the checks made before saving and which keys changed. Plain functions, so the form and the tests
// can both import them. The clock labels and the auto check-out message are the API's
// (src/modules/settings/schemas.js); tests/services/autoCheckoutSettings.test.js and
// tests/services/aiSettings.test.js check they agree.
import { NUMBERS } from './numberFields';
import { clockText, parseClockText } from './timeText';

/** Clock settings -> the words used in their messages ("Enter the office end time like ..."). */
export const CLOCKS = Object.freeze({
  officeStart: 'the office start time',
  officeEnd: 'the office end time',
  reportReminderAt: 'the report reminder time',
  lateAfter: 'the late mark time',
  // Auto check-out (CONTRACT 19)
  autoCheckoutAt: 'the auto check-out time',
});

/** AI clock settings (CONTRACT 20) -> the words used in their messages. */
export const AI_CLOCKS = Object.freeze({
  aiPmSummaryAt: 'the summary time',
  aiHrNotesAt: 'the HR notes time',
});

const ALL_CLOCKS = Object.freeze({ ...CLOCKS, ...AI_CLOCKS });

/**
 * Fields the page hides while a switch is off (all of these switches must be on to show it). A
 * hidden field is never an error: text that can't be read keeps the saved value.
 */
export const SHOWN_WITH = Object.freeze({
  autoCheckoutAt: ['autoCheckoutEnabled'],
  aiDailyLimit: ['aiEnabled'],
  aiPmSummaryAt: ['aiEnabled', 'aiPmSummaryEnabled'],
  aiHrNotesAt: ['aiEnabled', 'aiHrNotesEnabled'],
});

/** Whether a field is shown with these form values (SHOWN_WITH). */
export function isShown(form, key) {
  return (SHOWN_WITH[key] ?? []).every((flag) => Boolean(form?.[flag]));
}

/** "Check at" not after the office ends while auto check-out is on: the API's message. */
export const AUTO_CHECKOUT_TOO_EARLY = 'Pick a time after office hours end.';

/** Every key the form edits, in page order (the first field with an error gets focus). */
export const KEYS = Object.freeze([
  'companyName',
  'timezone',
  'workingDays',
  'officeStart',
  'officeEnd',
  'reportReminderAt',
  'lateAfter',
  'reportLock',
  'officeCheckinAnywhere',
  'allowUnverifiedOffice',
  'wfhRequiresApproval',
  'autoCheckoutEnabled',
  'autoCheckoutAt',
  'autoMarkMissingCheckout',
  'slackReportChannelId',
  'slackReportChannelName',
  'slackPostReports',
  'slackRemind',
  'slackUrgentNotify',
  'slackRequestsNotify',
  'activityTrackingEnabled',
  'activityIdleMinutes',
  'activityRetentionDays',
  'timersMode',
  'timerAwayMinutes',
  'timerReminderMinutes',
  'breakAllowanceMinutes',
  'pushEnabled',
  // AI with Gemini (CONTRACT 20)
  'aiEnabled',
  'aiDailyLimit',
  'aiPolishEnabled',
  'aiPmSummaryEnabled',
  'aiPmSummaryAt',
  'aiSummarySlack',
  'aiHrNotesEnabled',
  'aiHrNotesAt',
  'aiAskEnabled',
]);

/** Saved settings -> what the fields show (clocks as "9:30 AM"). */
export function toForm(saved) {
  const form = {};
  for (const key of KEYS) form[key] = key in ALL_CLOCKS ? clockText(saved[key]) : saved[key];
  for (const key of Object.keys(NUMBERS)) form[key] = String(saved[key] ?? '');
  form.workingDays = [...(saved.workingDays ?? [])];
  return form;
}

/**
 * Field text -> setting values, or the errors to show under the fields. A field hidden behind its
 * switch (SHOWN_WITH: "Check at" while auto check-out is off, CONTRACT 19; the AI limit and times
 * while AI or their feature is off, CONTRACT 20) keeps the saved value when its text can't be
 * read, and only a check that is on must come after the office ends.
 * @param {object} form what the fields show
 * @param {object} saved settings.getAll() as last saved
 * @returns {{ values: object, errors: object }}
 */
export function toValues(form, saved) {
  const values = { ...form, companyName: String(form.companyName ?? '').trim() };
  const errors = {};
  const autoOn = Boolean(form.autoCheckoutEnabled);
  for (const [key, label] of Object.entries(ALL_CLOCKS)) {
    const clock = parseClockText(form[key]);
    if (clock) values[key] = clock;
    else if (!isShown(form, key)) values[key] = saved?.[key];
    else errors[key] = `Enter ${label} like 9:30 AM.`;
  }
  for (const [key, { min, max, message }] of Object.entries(NUMBERS)) {
    const text = String(form[key] ?? '').trim();
    const number = Number(text);
    if (/^\d+$/.test(text) && number >= min && number <= max) values[key] = number;
    else if (!isShown(form, key)) values[key] = saved?.[key];
    else errors[key] = message;
  }
  if (!values.companyName) errors.companyName = 'Enter the company name.';
  if (values.workingDays.length === 0) errors.workingDays = 'Pick at least one working day.';
  if (!errors.officeStart && !errors.officeEnd && values.officeEnd <= values.officeStart) {
    errors.officeEnd = 'The office must close after it opens.';
  }
  if (autoOn && !errors.officeEnd && !errors.autoCheckoutAt) {
    if (values.autoCheckoutAt <= values.officeEnd) errors.autoCheckoutAt = AUTO_CHECKOUT_TOO_EARLY;
  }
  return { values, errors };
}

/** The keys whose values differ from what is saved, for PUT /api/settings. */
export function changedKeys(values, saved) {
  const body = {};
  for (const key of KEYS) {
    const value = key === 'workingDays' ? [...values[key]].sort((a, b) => a - b) : values[key];
    if (JSON.stringify(value ?? null) !== JSON.stringify(saved[key] ?? null)) body[key] = value;
  }
  // The channel name travels with its id.
  if ('slackReportChannelId' in body) body.slackReportChannelName = values.slackReportChannelName;
  return body;
}
