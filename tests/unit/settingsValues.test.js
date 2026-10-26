// The Settings form's values (settingsValues.js): auto check-out (CONTRACT 19) shows "Check at" as
// "8:00 PM", must come after the office ends while it is on, and keeps the saved time while it is
// off and hidden; only changed keys are sent.
import { describe, expect, it } from 'vitest';
import {
  AUTO_CHECKOUT_TOO_EARLY,
  changedKeys,
  CLOCKS,
  KEYS,
  toForm,
  toValues,
} from '@/app/(app)/settings/settingsValues';
import { NUMBERS } from '@/app/(app)/settings/numberFields';

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
