// Timers and breaks settings (CONTRACT 15): timersMode, timerAwayMinutes, timerReminderMinutes and
// breakAllowanceMinutes — defaults, saving, ranges, clamping of hand-edited rows, and the Settings
// form's limits matching the API's.
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { settings } from '@/modules/settings';
import {
  BREAK_ALLOWANCE_MINUTES,
  TIMER_AWAY_MINUTES,
  TIMER_MODES,
  TIMER_REMINDER_MINUTES,
} from '@/modules/settings/schemas';
import { NUMBERS, TIMER_MODE_OPTIONS } from '@/app/(app)/settings/numberFields';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

let admin;

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-09-30T04:00:00Z');
  admin = await createUser({ name: 'Admin Person', role: 'admin', email: 'admin@example.com' });
});

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
  return error;
}

const pick = (values) => ({
  timersMode: values.timersMode,
  timerAwayMinutes: values.timerAwayMinutes,
  timerReminderMinutes: values.timerReminderMinutes,
  breakAllowanceMinutes: values.breakAllowanceMinutes,
});

describe('timers and breaks settings', () => {
  it('defaults to optional timers, away after 25, reminder after 20, 60 min of breaks', async () => {
    expect(pick(await settings.getAll())).toEqual({
      timersMode: 'optional',
      timerAwayMinutes: 25,
      timerReminderMinutes: 20,
      breakAllowanceMinutes: 60,
    });
  });

  it('saves the four keys with Save changes (numbers from form text too) and audits them', async () => {
    const saved = await settings.update({
      user: admin,
      values: {
        timersMode: 'required',
        timerAwayMinutes: '30',
        timerReminderMinutes: ' 15 ',
        breakAllowanceMinutes: 45,
      },
    });
    expect(pick(saved)).toEqual({
      timersMode: 'required',
      timerAwayMinutes: 30,
      timerReminderMinutes: 15,
      breakAllowanceMinutes: 45,
    });
    const audit = await db('auditLogs')
      .where({ action: 'settings.update' })
      .orderBy('id', 'desc')
      .first();
    expect(JSON.parse(audit.before)).toEqual({
      timersMode: 'optional',
      timerAwayMinutes: 25,
      timerReminderMinutes: 20,
      breakAllowanceMinutes: 60,
    });
    expect(JSON.parse(audit.after)).toEqual({
      timersMode: 'required',
      timerAwayMinutes: 30,
      timerReminderMinutes: 15,
      breakAllowanceMinutes: 45,
    });
    expect(pick(await settings.getAll())).toEqual(pick(saved));
  });

  it('accepts the edges: 0 turns the reminder off and means no break allowance', async () => {
    const low = await settings.update({
      user: admin,
      values: {
        timersMode: 'off',
        timerAwayMinutes: 5,
        timerReminderMinutes: 0,
        breakAllowanceMinutes: '0',
      },
    });
    expect(pick(low)).toEqual({
      timersMode: 'off',
      timerAwayMinutes: 5,
      timerReminderMinutes: 0,
      breakAllowanceMinutes: 0,
    });
    const high = await settings.update({
      user: admin,
      values: { timerAwayMinutes: 240, timerReminderMinutes: 240, breakAllowanceMinutes: 480 },
    });
    expect(pick(high)).toMatchObject({
      timerAwayMinutes: 240,
      timerReminderMinutes: 240,
      breakAllowanceMinutes: 480,
    });
  });

  it('rejects other modes and values outside the allowed ranges, saving nothing', async () => {
    const before = pick(await settings.getAll());
    for (const [values, field] of [
      [{ timersMode: 'sometimes' }, 'timersMode'],
      [{ timersMode: '' }, 'timersMode'],
      [{ timersMode: null }, 'timersMode'],
      [{ timerAwayMinutes: 4 }, 'timerAwayMinutes'],
      [{ timerAwayMinutes: 241 }, 'timerAwayMinutes'],
      [{ timerAwayMinutes: 2.5 }, 'timerAwayMinutes'],
      [{ timerAwayMinutes: 'soon' }, 'timerAwayMinutes'],
      [{ timerReminderMinutes: -1 }, 'timerReminderMinutes'],
      [{ timerReminderMinutes: 241 }, 'timerReminderMinutes'],
      [{ timerReminderMinutes: '' }, 'timerReminderMinutes'],
      [{ breakAllowanceMinutes: -5 }, 'breakAllowanceMinutes'],
      [{ breakAllowanceMinutes: 481 }, 'breakAllowanceMinutes'],
      [{ breakAllowanceMinutes: '12.5' }, 'breakAllowanceMinutes'],
    ]) {
      // A valid key next to the bad one is not saved either.
      const valid =
        field === 'timerAwayMinutes' ? { breakAllowanceMinutes: 30 } : { timerAwayMinutes: 10 };
      const error = await expectAppError(
        settings.update({ user: admin, values: { ...valid, ...values } }),
        'VALIDATION_FAILED',
      );
      expect(error.fields, JSON.stringify(values)).toHaveProperty(field);
    }
    expect(pick(await settings.getAll())).toEqual(before);
  });

  it('keeps hand-edited rows inside the allowed ranges', async () => {
    await setSettings({
      timers_mode: 'sometimes',
      timer_away_minutes: 0,
      timer_reminder_minutes: -10,
      break_allowance_minutes: 99999,
    });
    expect(pick(await settings.getAll())).toEqual({
      timersMode: 'optional',
      timerAwayMinutes: 5,
      timerReminderMinutes: 0,
      breakAllowanceMinutes: 480,
    });
    await setSettings({
      timers_mode: 42,
      timer_away_minutes: 'soon',
      timer_reminder_minutes: 30.4,
      break_allowance_minutes: '90',
    });
    expect(pick(await settings.getAll())).toEqual({
      timersMode: 'optional',
      timerAwayMinutes: 25,
      timerReminderMinutes: 30,
      breakAllowanceMinutes: 90,
    });
    await setSettings({ timers_mode: 'required', timer_away_minutes: 9000 });
    expect(pick(await settings.getAll())).toMatchObject({
      timersMode: 'required',
      timerAwayMinutes: 240,
    });
  });
});

describe('the Settings form', () => {
  it('uses the same limits as the API', () => {
    const limits = (key) => ({ min: NUMBERS[key].min, max: NUMBERS[key].max });
    expect(limits('timerAwayMinutes')).toEqual({ ...TIMER_AWAY_MINUTES });
    expect(limits('timerReminderMinutes')).toEqual({ ...TIMER_REMINDER_MINUTES });
    expect(limits('breakAllowanceMinutes')).toEqual({ ...BREAK_ALLOWANCE_MINUTES });
    expect(TIMER_MODE_OPTIONS.map((option) => option.value)).toEqual([...TIMER_MODES]);
  });

  it('shows the API messages for out-of-range numbers', async () => {
    for (const [key, value] of [
      ['timerAwayMinutes', 241],
      ['timerReminderMinutes', 241],
      ['breakAllowanceMinutes', 481],
    ]) {
      const error = await expectAppError(
        settings.update({ user: admin, values: { [key]: value } }),
        'VALIDATION_FAILED',
      );
      expect(error.fields[key]).toBe(NUMBERS[key].message);
    }
  });
});
