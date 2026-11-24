// Settings form values: which keys the form edits, how saved settings become field text and back,
// the checks made before saving and which keys changed. Plain functions, so the form and the tests
// can both import them. The clock labels and the cross-check messages are the API's
// (src/modules/settings/schemas.js and crossChecks.js, Files from CONTRACT 27);
// tests/unit/settingsValues.test.js, tests/services/autoCheckoutSettings.test.js and
// tests/services/aiSettings.test.js check they agree.
import { formatClockShort } from '@/lib/time';
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

/** HR updates' clock (CONTRACT 25); the API's message is "Enter a time like 10:00.". */
export const HR_CLOCKS = Object.freeze({
  hrSummaryAt: 'the HR summary time',
});

const ALL_CLOCKS = Object.freeze({ ...CLOCKS, ...AI_CLOCKS, ...HR_CLOCKS });

/**
 * Fields the page hides while a switch is off (all of these switches must be on to show it). A
 * hidden field is never an error: text that can't be read keeps the saved value.
 */
export const SHOWN_WITH = Object.freeze({
  autoCheckoutAt: ['autoCheckoutEnabled'],
  aiDailyLimit: ['aiEnabled'],
  aiPmSummaryAt: ['aiEnabled', 'aiPmSummaryEnabled'],
  aiHrNotesAt: ['aiEnabled', 'aiHrNotesEnabled'],
  hrSummaryAt: ['hrMorningSummary'], // CONTRACT 25
});

/** Whether a field is shown with these form values (SHOWN_WITH). */
export function isShown(form, key) {
  return (SHOWN_WITH[key] ?? []).every((flag) => Boolean(form?.[flag]));
}

/** "Check at" not after the office ends while auto check-out is on: the API's message. */
export const AUTO_CHECKOUT_TOO_EARLY = 'Pick a time after office hours end.';

/** Both marks on and the half day not below the short day (CONTRACT 25): the API's message. */
export const HALF_DAY_TOO_LONG = 'Half day must be less than the short day time.';

/** The morning HR summary before the late mark (CONTRACT 25): the API's message ("(9:30)"). */
export function summaryTooEarly(lateAfter) {
  return `Pick a time at or after the late mark (${formatClockShort(lateAfter)}).`;
}

/** The morning HR summary at or after office end (CONTRACT 25): the API's message. */
export const SUMMARY_TOO_LATE = 'Pick a time before office hours end.';

/** The largest file bigger than the storage limit (CONTRACT 27): the API's message. */
export const FILE_BIGGER_THAN_LIMIT = "The largest file can't be bigger than the storage limit.";

/** The evening wrap-up goes out this long after office hours end (CONTRACT 25, not a setting). */
const WRAP_UP_AFTER_MINUTES = 30;

/** When the evening wrap-up goes out for this office end: '18:30' -> '19:00'. */
export function wrapUpAt(officeEnd) {
  const [hours, minutes] = String(officeEnd).split(':').map(Number);
  const total = (hours * 60 + minutes + WRAP_UP_AFTER_MINUTES) % (24 * 60);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

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
  // Attendance marks and HR updates (CONTRACT 25)
  'halfDayUnderMinutes',
  'shortDayUnderMinutes',
  'leftEarlyGraceMinutes',
  'payrollMonthStartDay',
  'hrMorningSummary',
  'hrSummaryAt',
  'hrEveningSummary',
  'checkinReminderMinutes',
  'lateAlertDays',
  'slackReportChannelId',
  'slackReportChannelName',
  // Today's to-do (CONTRACT 24)
  'slackTodoChannelId',
  'slackTodoChannelName',
  'slackPostReports',
  'slackRemind',
  'slackUrgentNotify',
  'slackRequestsNotify',
  'slackAttendanceRemind', // CONTRACT 25
  'slackHrSummary',
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
  'aiProjectSummaryEnabled',
  // Files (CONTRACT 27)
  'fileMaxMb',
  'fileStorageLimitGb',
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
 * The checks across fields the API makes too: the office closes after it opens, auto check-out
 * after office end (CONTRACT 19), (CONTRACT 25) a half day below a short day while both are on,
 * the morning HR summary at or after the late mark and before office end while it is on, and
 * (CONTRACT 27) the largest file within the storage limit. Fields that already have an error are
 * left to that error.
 */
function crossCheck(form, values, errors) {
  const clean = (...keys) => keys.every((key) => !errors[key]);
  if (clean('officeStart', 'officeEnd') && values.officeEnd <= values.officeStart) {
    errors.officeEnd = 'The office must close after it opens.';
  }
  if (form.autoCheckoutEnabled && clean('officeEnd', 'autoCheckoutAt')) {
    if (values.autoCheckoutAt <= values.officeEnd) errors.autoCheckoutAt = AUTO_CHECKOUT_TOO_EARLY;
  }
  const { halfDayUnderMinutes: half, shortDayUnderMinutes: short } = values;
  if (clean('halfDayUnderMinutes', 'shortDayUnderMinutes') && half > 0 && short > 0) {
    if (half >= short) errors.halfDayUnderMinutes = HALF_DAY_TOO_LONG;
  }
  if (form.hrMorningSummary && clean('hrSummaryAt', 'lateAfter', 'officeEnd')) {
    if (values.hrSummaryAt < values.lateAfter) {
      errors.hrSummaryAt = summaryTooEarly(values.lateAfter);
    } else if (values.hrSummaryAt >= values.officeEnd) errors.hrSummaryAt = SUMMARY_TOO_LATE;
  }
  const tooBig = values.fileMaxMb > values.fileStorageLimitGb * 1024;
  if (clean('fileMaxMb', 'fileStorageLimitGb') && tooBig) errors.fileMaxMb = FILE_BIGGER_THAN_LIMIT;
}

/**
 * Field text -> setting values, or the errors to show under the fields. A field hidden behind its
 * switch (SHOWN_WITH: "Check at" while auto check-out is off, CONTRACT 19; the AI limit and times
 * while AI or their feature is off, CONTRACT 20; the HR summary time while it is off, CONTRACT
 * 25) keeps the saved value when its text can't be read, and only a check that is on is made.
 * @param {object} form what the fields show
 * @param {object} saved settings.getAll() as last saved
 * @returns {{ values: object, errors: object }}
 */
export function toValues(form, saved) {
  const values = { ...form, companyName: String(form.companyName ?? '').trim() };
  const errors = {};
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
  crossCheck(form, values, errors);
  return { values, errors };
}

/** The keys whose values differ from what is saved, for PUT /api/settings. */
export function changedKeys(values, saved) {
  const body = {};
  for (const key of KEYS) {
    const value = key === 'workingDays' ? [...values[key]].sort((a, b) => a - b) : values[key];
    if (JSON.stringify(value ?? null) !== JSON.stringify(saved[key] ?? null)) body[key] = value;
  }
  // A channel name travels with its id.
  if ('slackReportChannelId' in body) body.slackReportChannelName = values.slackReportChannelName;
  if ('slackTodoChannelId' in body) body.slackTodoChannelName = values.slackTodoChannelName ?? null;
  return body;
}
