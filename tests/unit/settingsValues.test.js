// The Settings form's values (settingsValues.js): auto check-out (CONTRACT 19) shows "Check at" as
// "8:00 PM", must come after the office ends while it is on, and keeps the saved time while it is
// off and hidden; only changed keys are sent. Attendance marks and HR updates (CONTRACT 25) and
// Files (CONTRACT 27) use the API's limits, messages and cross checks.
import { describe, expect, it } from 'vitest';
import {
  AUTO_CHECKOUT_TOO_EARLY,
  changedKeys,
  CLOCKS,
  FILE_BIGGER_THAN_LIMIT,
  HALF_DAY_TOO_LONG,
  HR_CLOCKS,
  isShown,
  KEYS,
  SUMMARY_TOO_LATE,
  summaryTooEarly,
  toForm,
  toValues,
  wrapUpAt,
} from '@/app/(app)/settings/settingsValues';
import { NUMBERS } from '@/app/(app)/settings/numberFields';
import {
  CHECKIN_REMINDER_MINUTES,
  checkDayMarks,
  checkFileLimits,
  checkHrSummary,
  FILE_MAX_MB,
  FILE_STORAGE_LIMIT_GB,
  HALF_DAY_UNDER_MINUTES,
  LATE_ALERT_DAYS,
  LEFT_EARLY_GRACE_MINUTES,
  PAYROLL_MONTH_START_DAY,
  settingsUpdateSchema,
  SHORT_DAY_UNDER_MINUTES,
} from '@/modules/settings/schemas';

const SAVED = {
  companyName: 'Teqdeft',
  timezone: 'Asia/Kolkata',
  workingDays: [1, 2, 3, 4, 5],
  officeStart: '09:30',
  officeEnd: '18:30',
  reportReminderAt: '18:30',
  lateAfter: '09:35',
  reportLock: 'next_day_12:00',
  officeCheckinAnywhere: false,
  allowUnverifiedOffice: true,
  wfhRequiresApproval: true,
  autoCheckoutEnabled: true,
  autoCheckoutAt: '20:00',
  autoMarkMissingCheckout: true,
  slackReportChannelId: null,
  slackReportChannelName: null,
  slackPostReports: true,
  slackRemind: true,
  slackUrgentNotify: true,
  slackRequestsNotify: true,
  activityTrackingEnabled: true,
  activityIdleMinutes: 5,
  activityRetentionDays: 365,
  timersMode: 'optional',
  timerAwayMinutes: 25,
  timerReminderMinutes: 25,
  breakAllowanceMinutes: 60,
  pushEnabled: true,
  // CONTRACT 25
  halfDayUnderMinutes: 270,
  shortDayUnderMinutes: 480,
  leftEarlyGraceMinutes: 15,
  payrollMonthStartDay: 1,
  hrMorningSummary: true,
  hrSummaryAt: '10:00',
  hrEveningSummary: false,
  checkinReminderMinutes: 30,
  lateAlertDays: 4,
  slackAttendanceRemind: true,
  slackHrSummary: true,
  // CONTRACT 27
  fileMaxMb: 500,
  fileStorageLimitGb: 10,
};

const edit = (changes) => ({ ...toForm(SAVED), ...changes });

describe('Settings form values', () => {
  it('edits both auto check-out keys, next to the other check-in switches', () => {
    expect(KEYS).toContain('autoCheckoutEnabled');
    expect(KEYS).toContain('autoCheckoutAt');
    // Page order: after the WFH switch, before the midnight switch and Slack.
    expect(KEYS.indexOf('autoCheckoutEnabled')).toBe(KEYS.indexOf('wfhRequiresApproval') + 1);
    expect(KEYS.indexOf('autoCheckoutAt')).toBe(KEYS.indexOf('autoCheckoutEnabled') + 1);
    expect(KEYS.indexOf('autoMarkMissingCheckout')).toBe(KEYS.indexOf('autoCheckoutAt') + 1);
    expect(CLOCKS.autoCheckoutAt).toBe('the auto check-out time');
    for (const key of [...Object.keys(CLOCKS), ...Object.keys(NUMBERS)]) {
      expect(KEYS, key).toContain(key);
    }
  });

  it('shows "Check at" as 8:00 PM and the switch as saved', () => {
    const form = toForm(SAVED);
    expect(form.autoCheckoutAt).toBe('8:00 PM');
    expect(form.autoCheckoutEnabled).toBe(true);
    expect(form.timerReminderMinutes).toBe('25');
    const { values, errors } = toValues(form, SAVED);
    expect(errors).toEqual({});
    expect(changedKeys(values, SAVED)).toEqual({});
  });

  it('saves a typed check time as HH:mm, sending only what changed', () => {
    for (const [text, clock] of [
      ['9:15 pm', '21:15'],
      ['21:15', '21:15'],
      ['7 PM', '19:00'],
    ]) {
      const { values, errors } = toValues(edit({ autoCheckoutAt: text }), SAVED);
      expect(errors, text).toEqual({});
      expect(changedKeys(values, SAVED), text).toEqual({ autoCheckoutAt: clock });
    }
    const off = toValues(edit({ autoCheckoutEnabled: false }), SAVED);
    expect(changedKeys(off.values, SAVED)).toEqual({ autoCheckoutEnabled: false });
  });

  it('asks for a time like 9:30 AM, and one after the office ends, while it is on', () => {
    expect(toValues(edit({ autoCheckoutAt: 'late' }), SAVED).errors).toEqual({
      autoCheckoutAt: 'Enter the auto check-out time like 9:30 AM.',
    });
    expect(toValues(edit({ autoCheckoutAt: '' }), SAVED).errors).toHaveProperty('autoCheckoutAt');
    for (const text of ['6:30 PM', '5:00 PM', '9:00 AM']) {
      expect(toValues(edit({ autoCheckoutAt: text }), SAVED).errors, text).toEqual({
        autoCheckoutAt: AUTO_CHECKOUT_TOO_EARLY,
      });
    }
    // Moving the office end past the check time flags the check time.
    expect(toValues(edit({ officeEnd: '8:30 PM' }), SAVED).errors).toEqual({
      autoCheckoutAt: AUTO_CHECKOUT_TOO_EARLY,
    });
    // An office end that can't be read is the only error shown.
    expect(toValues(edit({ officeEnd: 'soon' }), SAVED).errors).toEqual({
      officeEnd: 'Enter the office end time like 9:30 AM.',
    });
  });

  it('while it is off, "Check at" is hidden: never an error there, and bad text keeps the saved time', () => {
    const typed = toValues(edit({ autoCheckoutEnabled: false, autoCheckoutAt: 'late' }), SAVED);
    expect(typed.errors).toEqual({});
    expect(changedKeys(typed.values, SAVED)).toEqual({ autoCheckoutEnabled: false });

    const early = toValues(edit({ autoCheckoutEnabled: false, officeEnd: '9:00 PM' }), SAVED);
    expect(early.errors).toEqual({});
    expect(changedKeys(early.values, SAVED)).toEqual({
      autoCheckoutEnabled: false,
      officeEnd: '21:00',
    });
  });

  it('edits the to-do channel (CONTRACT 24) under the report channel; its name travels with its id', () => {
    expect(KEYS.indexOf('slackTodoChannelId')).toBe(KEYS.indexOf('slackReportChannelName') + 1);
    expect(KEYS.indexOf('slackTodoChannelName')).toBe(KEYS.indexOf('slackTodoChannelId') + 1);
    const saved = { ...SAVED, slackTodoChannelId: null, slackTodoChannelName: null };
    expect(toForm(saved)).toMatchObject({ slackTodoChannelId: null, slackTodoChannelName: null });
    const picked = toValues(
      { ...toForm(saved), slackTodoChannelId: 'C0TODO', slackTodoChannelName: 'morning-todo' },
      saved,
    );
    expect(changedKeys(picked.values, saved)).toEqual({
      slackTodoChannelId: 'C0TODO',
      slackTodoChannelName: 'morning-todo',
    });
    // "Don't post to-dos" saves null for both, and never touches the report channel.
    const on = { ...saved, slackTodoChannelId: 'C0TODO', slackTodoChannelName: 'morning-todo' };
    const off = toValues(
      { ...toForm(on), slackTodoChannelId: null, slackTodoChannelName: null },
      on,
    );
    expect(changedKeys(off.values, on)).toEqual({
      slackTodoChannelId: null,
      slackTodoChannelName: null,
    });
    // Saved settings from before the key existed read as "Don't post to-dos": nothing to send.
    expect(changedKeys(toValues(toForm(SAVED), SAVED).values, SAVED)).toEqual({});
  });

  it('turning it on checks the time again', () => {
    const saved = { ...SAVED, autoCheckoutEnabled: false, autoCheckoutAt: '18:00' };
    const form = { ...toForm(saved), autoCheckoutEnabled: true };
    expect(toValues(form, saved).errors).toEqual({
      autoCheckoutAt: AUTO_CHECKOUT_TOO_EARLY,
    });
    const fixed = toValues({ ...form, autoCheckoutAt: '8:15 PM' }, saved);
    expect(fixed.errors).toEqual({});
    expect(changedKeys(fixed.values, saved)).toEqual({
      autoCheckoutEnabled: true,
      autoCheckoutAt: '20:15',
    });
  });
});

// CONTRACT 25: Attendance marks, HR updates and the two Slack switches.
describe('Settings form values: attendance marks and HR updates', () => {
  /** The API's message for one value of one key (settingsUpdateSchema), or null when allowed. */
  const apiMessage = (key, value) => {
    const result = settingsUpdateSchema.safeParse({ [key]: value });
    return result.success ? null : result.error.issues[0].message;
  };
  /** What checkDayMarks / checkHrSummary throw on these values, or null. */
  const crossMessage = (check, current, parsed) => {
    try {
      check(current, parsed);
      return null;
    } catch (error) {
      return error.fields;
    }
  };

  it('edits the new keys in page order: Check-in, Attendance marks, HR updates, then Slack', () => {
    const marks = [
      'halfDayUnderMinutes',
      'shortDayUnderMinutes',
      'leftEarlyGraceMinutes',
      'payrollMonthStartDay',
      'hrMorningSummary',
      'hrSummaryAt',
      'hrEveningSummary',
      'checkinReminderMinutes',
      'lateAlertDays',
    ];
    const start = KEYS.indexOf('autoMarkMissingCheckout') + 1;
    expect(KEYS.slice(start, start + marks.length)).toEqual(marks);
    expect(KEYS[start + marks.length]).toBe('slackReportChannelId');
    const slack = KEYS.indexOf('slackRequestsNotify');
    expect(KEYS.slice(slack + 1, slack + 3)).toEqual(['slackAttendanceRemind', 'slackHrSummary']);
    expect(Object.keys(CLOCKS)).not.toContain('hrSummaryAt');
    expect(HR_CLOCKS).toEqual({ hrSummaryAt: 'the HR summary time' });
  });

  it('uses the API limits and messages for the six numbers', () => {
    const bounds = {
      halfDayUnderMinutes: HALF_DAY_UNDER_MINUTES,
      shortDayUnderMinutes: SHORT_DAY_UNDER_MINUTES,
      leftEarlyGraceMinutes: LEFT_EARLY_GRACE_MINUTES,
      payrollMonthStartDay: PAYROLL_MONTH_START_DAY,
      checkinReminderMinutes: CHECKIN_REMINDER_MINUTES,
      lateAlertDays: LATE_ALERT_DAYS,
    };
    for (const [key, { min, max }] of Object.entries(bounds)) {
      expect({ min: NUMBERS[key].min, max: NUMBERS[key].max }, key).toEqual({ min, max });
      expect(apiMessage(key, max + 1), key).toBe(NUMBERS[key].message);
      expect(apiMessage(key, min - 1), key).toBe(NUMBERS[key].message);
      expect(apiMessage(key, min), key).toBeNull();
      // The form refuses the same values with the same words.
      const { errors } = toValues(edit({ [key]: String(max + 1) }), SAVED);
      expect(errors[key], key).toBe(NUMBERS[key].message);
    }
    expect(NUMBERS.halfDayUnderMinutes.message).toBe(
      'Half day must be between 0 and 720 minutes (0 turns it off).',
    );
    expect(NUMBERS.payrollMonthStartDay.message).toBe(
      'The payroll month must start on a day from 1 to 28.',
    );
  });

  it('shows the numbers as text and the summary time as 10:00 AM; sends only what changed', () => {
    const form = toForm(SAVED);
    expect(form).toMatchObject({
      halfDayUnderMinutes: '270',
      payrollMonthStartDay: '1',
      lateAlertDays: '4',
      hrSummaryAt: '10:00 AM',
      hrMorningSummary: true,
      slackHrSummary: true,
    });
    expect(toValues(form, SAVED).errors).toEqual({});
    const { values, errors } = toValues(
      edit({
        payrollMonthStartDay: '26',
        hrSummaryAt: '11:15 am',
        hrEveningSummary: true,
        slackAttendanceRemind: false,
      }),
      SAVED,
    );
    expect(errors).toEqual({});
    expect(changedKeys(values, SAVED)).toEqual({
      payrollMonthStartDay: 26,
      hrSummaryAt: '11:15',
      hrEveningSummary: true,
      slackAttendanceRemind: false,
    });
  });

  it('puts the evening wrap-up half an hour after office hours end', () => {
    expect(wrapUpAt('18:30')).toBe('19:00');
    expect(wrapUpAt('17:45')).toBe('18:15');
    expect(wrapUpAt('23:50')).toBe('00:20');
  });

  it('asks for a time like 9:30 AM while the summary is on, and hides it while off', () => {
    expect(toValues(edit({ hrSummaryAt: 'soon' }), SAVED).errors).toEqual({
      hrSummaryAt: 'Enter the HR summary time like 9:30 AM.',
    });
    expect(apiMessage('hrSummaryAt', 'soon')).toBe('Enter a time like 10:00.');
    expect(isShown(edit({ hrMorningSummary: false }), 'hrSummaryAt')).toBe(false);
    expect(isShown(edit({}), 'hrSummaryAt')).toBe(true);
    const off = toValues(edit({ hrMorningSummary: false, hrSummaryAt: 'soon' }), SAVED);
    expect(off.errors).toEqual({});
    expect(changedKeys(off.values, SAVED)).toEqual({ hrMorningSummary: false });
    // Off, the summary time is never checked against the late mark or office end.
    const early = toValues(edit({ hrMorningSummary: false, hrSummaryAt: '7:00 AM' }), SAVED);
    expect(early.errors).toEqual({});
  });

  it('refuses a half day not below the short day while both are on, as the API does', () => {
    for (const [half, short] of [
      ['480', '480'],
      ['500', '400'],
    ]) {
      const form = edit({ halfDayUnderMinutes: half, shortDayUnderMinutes: short });
      expect(toValues(form, SAVED).errors).toEqual({ halfDayUnderMinutes: HALF_DAY_TOO_LONG });
      expect(
        crossMessage(checkDayMarks, SAVED, {
          halfDayUnderMinutes: Number(half),
          shortDayUnderMinutes: Number(short),
        }),
      ).toEqual({ halfDayUnderMinutes: HALF_DAY_TOO_LONG });
    }
    for (const [half, short] of [
      ['0', '200'],
      ['600', '0'],
      ['269', '270'],
    ]) {
      const form = edit({ halfDayUnderMinutes: half, shortDayUnderMinutes: short });
      expect(toValues(form, SAVED).errors, `${half} ${short}`).toEqual({});
    }
    // A number that can't be read is the only error shown.
    expect(toValues(edit({ shortDayUnderMinutes: 'x' }), SAVED).errors).toEqual({
      shortDayUnderMinutes: NUMBERS.shortDayUnderMinutes.message,
    });
  });

  it('wants the summary at or after the late mark and before office end, as the API does', () => {
    // SAVED: late after 9:35, office ends 6:30 PM.
    const early = toValues(edit({ hrSummaryAt: '9:30 AM' }), SAVED).errors;
    expect(early).toEqual({ hrSummaryAt: summaryTooEarly('09:35') });
    expect(early.hrSummaryAt).toBe('Pick a time at or after the late mark (9:35).');
    expect(crossMessage(checkHrSummary, SAVED, { hrSummaryAt: '09:30' })).toEqual(early);
    expect(toValues(edit({ hrSummaryAt: '9:35 AM' }), SAVED).errors).toEqual({});

    const late = toValues(edit({ hrSummaryAt: '6:30 PM' }), SAVED).errors;
    expect(late).toEqual({ hrSummaryAt: SUMMARY_TOO_LATE });
    expect(crossMessage(checkHrSummary, SAVED, { hrSummaryAt: '18:30' })).toEqual(late);

    // Moving the late mark past the summary flags the summary time, with the new late mark.
    const moved = toValues(edit({ lateAfter: '1:05 PM' }), SAVED).errors;
    expect(moved).toEqual({ hrSummaryAt: 'Pick a time at or after the late mark (1:05).' });
    expect(crossMessage(checkHrSummary, SAVED, { lateAfter: '13:05' })).toEqual(moved);
  });
});

// CONTRACT 27: Settings → Files, the largest file and the storage limit.
describe('Settings form values: files', () => {
  const apiResult = (values) => settingsUpdateSchema.safeParse(values);
  const apiMessage = (key, value) => {
    const result = apiResult({ [key]: value });
    return result.success ? null : result.error.issues[0].message;
  };

  it('edits the two keys last, after AI, as the Files section comes last', () => {
    expect(KEYS.slice(-3)).toEqual(['aiProjectSummaryEnabled', 'fileMaxMb', 'fileStorageLimitGb']);
  });

  it('uses the API limits and messages', () => {
    const bounds = { fileMaxMb: FILE_MAX_MB, fileStorageLimitGb: FILE_STORAGE_LIMIT_GB };
    expect(bounds).toEqual({
      fileMaxMb: { min: 1, max: 2048 },
      fileStorageLimitGb: { min: 1, max: 1000 },
    });
    for (const [key, { min, max }] of Object.entries(bounds)) {
      expect({ min: NUMBERS[key].min, max: NUMBERS[key].max }, key).toEqual({ min, max });
      for (const wrong of [max + 1, min - 1, 1.5, 'ten']) {
        expect(apiMessage(key, wrong), `${key} ${wrong}`).toBe(NUMBERS[key].message);
      }
      expect(apiMessage(key, max), key).toBeNull();
      expect(apiMessage(key, String(min)), key).toBeNull();
      const { errors } = toValues(edit({ [key]: String(max + 1) }), SAVED);
      expect(errors[key], key).toBe(NUMBERS[key].message);
    }
    expect(NUMBERS.fileMaxMb.message).toBe('Pick a size from 1 to 2,048 MB.');
    expect(NUMBERS.fileStorageLimitGb.message).toBe('Pick a limit from 1 to 1,000 GB.');
  });

  it('shows the numbers as text and sends only what changed', () => {
    expect(toForm(SAVED)).toMatchObject({ fileMaxMb: '500', fileStorageLimitGb: '10' });
    const { values, errors } = toValues(
      edit({ fileMaxMb: ' 750 ', fileStorageLimitGb: '40' }),
      SAVED,
    );
    expect(errors).toEqual({});
    expect(changedKeys(values, SAVED)).toEqual({ fileMaxMb: 750, fileStorageLimitGb: 40 });
  });

  it('refuses a largest file bigger than the storage limit, as the API does', () => {
    const refused = toValues(edit({ fileMaxMb: '2048', fileStorageLimitGb: '1' }), SAVED).errors;
    expect(refused).toEqual({ fileMaxMb: FILE_BIGGER_THAN_LIMIT });
    expect(FILE_BIGGER_THAN_LIMIT).toBe("The largest file can't be bigger than the storage limit.");
    let thrown = null;
    try {
      checkFileLimits(SAVED, { fileMaxMb: 2048, fileStorageLimitGb: 1 });
    } catch (error) {
      thrown = error.fields;
    }
    expect(thrown).toEqual(refused);
    // 1 GB is 1,024 MB: a 1,024 MB file fits a 1 GB limit.
    expect(toValues(edit({ fileMaxMb: '1024', fileStorageLimitGb: '1' }), SAVED).errors).toEqual(
      {},
    );
    expect(() => checkFileLimits(SAVED, { fileMaxMb: 1024, fileStorageLimitGb: 1 })).not.toThrow();
    // A number that can't be read is the only error shown.
    expect(toValues(edit({ fileMaxMb: 'x', fileStorageLimitGb: '1' }), SAVED).errors).toEqual({
      fileMaxMb: NUMBERS.fileMaxMb.message,
    });
  });
});
