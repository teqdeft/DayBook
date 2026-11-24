import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { settings } from '@/modules/settings';
import { createUser, resetDatabase, setSettings } from '../helpers/db.js';

let admin;

// CONTRACT 25: Attendance marks, HR updates and the two Slack switches (snake_case row keys).
const KEYS_1_10 = {
  half_day_under_minutes: 'halfDayUnderMinutes',
  short_day_under_minutes: 'shortDayUnderMinutes',
  left_early_grace_minutes: 'leftEarlyGraceMinutes',
  payroll_month_start_day: 'payrollMonthStartDay',
  hr_morning_summary: 'hrMorningSummary',
  hr_summary_at: 'hrSummaryAt',
  hr_evening_summary: 'hrEveningSummary',
  checkin_reminder_minutes: 'checkinReminderMinutes',
  late_alert_days: 'lateAlertDays',
  slack_attendance_remind: 'slackAttendanceRemind',
  slack_hr_summary: 'slackHrSummary',
};
const DEFAULTS_1_10 = {
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
};
const pick110 = (values) =>
  Object.fromEntries(Object.values(KEYS_1_10).map((key) => [key, values[key]]));

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-09-30T04:00:00Z');
  admin = await createUser({ name: 'Admin Person', role: 'admin', email: 'admin@example.com' });
});

afterAll(() => {
  settings.setCacheTtlForTests(null);
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

describe('settings.getAll', () => {
  it('returns the seeded defaults with camelCase keys and HH:mm clocks', async () => {
    expect(await settings.getAll()).toEqual({
      companyName: '[Company name]',
      timezone: 'Asia/Kolkata',
      workingDays: [1, 2, 3, 4, 5],
      officeStart: '09:30',
      officeEnd: '18:30',
      lateAfter: '09:30',
      reportReminderAt: '18:30',
      reportLock: 'next_day_12:00',
      gapWarningMinutes: 90,
      stuckTaskDays: 5,
      allowUnverifiedOffice: true,
      autoMarkMissingCheckout: true,
      slackEnabled: true,
      slackReportChannelId: null,
      slackReportChannelName: null,
      slackTodoChannelId: null,
      slackTodoChannelName: null,
      slackPostReports: true,
      slackRemind: true,
      slackUrgentNotify: true,
      slackRequestsNotify: true,
      activityTrackingEnabled: true,
      activityIdleMinutes: 5,
      activityRetentionDays: 365,
      pushEnabled: true,
      timersMode: 'optional',
      timerAwayMinutes: 25,
      timerReminderMinutes: 25,
      breakAllowanceMinutes: 60,
      officeCheckinAnywhere: false,
      wfhRequiresApproval: true,
      autoCheckoutEnabled: true,
      autoCheckoutAt: '20:00',
      aiEnabled: false,
      aiDailyLimit: 200,
      aiPolishEnabled: true,
      aiPmSummaryEnabled: true,
      aiPmSummaryAt: '19:00',
      aiSummarySlack: true,
      aiHrNotesEnabled: true,
      aiHrNotesAt: '19:00',
      aiAskEnabled: true,
      aiProjectSummaryEnabled: false,
      ...DEFAULTS_1_10,
      fileMaxMb: 500,
      fileStorageLimitGb: 10,
    });
  });

  it('falls back to the default for a missing or broken row', async () => {
    await db('settings').where({ key: 'stuck_task_days' }).delete();
    await db('settings')
      .where({ key: 'office_start' })
      .update({ value: JSON.stringify('9:05') });
    const values = await settings.getAll();
    expect(values.stuckTaskDays).toBe(5);
    expect(values.officeStart).toBe('09:05');
    await db('settings').insert({ key: 'stuck_task_days', value: '5' });
    await setSettings({ office_start: '09:30' });
  });

  it('returns a copy, so callers cannot change the cached values', async () => {
    const values = await settings.getAll();
    values.workingDays.push(6);
    values.companyName = 'Changed';
    expect((await settings.getAll()).workingDays).toEqual([1, 2, 3, 4, 5]);
    expect((await settings.getAll()).companyName).toBe('[Company name]');
  });
});

describe('settings.update', () => {
  beforeEach(() => settings.setCacheTtlForTests(null));

  it('saves only changed keys, records who changed them and writes one audit row', async () => {
    const auditBefore = await db('audit_logs')
      .where({ action: 'settings.update' })
      .count({ n: '*' })
      .first();
    const result = await settings.update({
      user: admin,
      ip: '203.0.113.9',
      values: {
        companyName: '  Acme Studio ',
        officeEnd: '18:30',
        workingDays: [5, 1, 2, 3, 4, 6],
      },
    });
    expect(result.companyName).toBe('Acme Studio');
    expect(result.workingDays).toEqual([1, 2, 3, 4, 5, 6]);

    const row = await db('settings').where({ key: 'company_name' }).first();
    expect(parseJson(row.value)).toBe('Acme Studio');
    expect(row.updatedBy).toBe(admin.id);
    const untouched = await db('settings').where({ key: 'office_end' }).first();
    expect(untouched.updatedBy).toBeNull();

    const logs = await db('audit_logs').where({ action: 'settings.update' }).orderBy('id', 'desc');
    expect(logs.length).toBe(Number(auditBefore.n) + 1);
    expect(logs[0]).toMatchObject({ actorId: admin.id, entityType: 'settings', ip: '203.0.113.9' });
    expect(parseJson(logs[0].before)).toEqual({
      companyName: '[Company name]',
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(parseJson(logs[0].after)).toEqual({
      companyName: 'Acme Studio',
      workingDays: [1, 2, 3, 4, 5, 6],
    });
  });

  it('writes nothing when no value changed', async () => {
    const count = async () => Number((await db('audit_logs').count({ n: '*' }).first()).n);
    const before = await count();
    await settings.update({
      user: admin,
      values: { companyName: 'Acme Studio', slackRemind: true },
    });
    expect(await count()).toBe(before);
  });

  it('clears the cache on save', async () => {
    settings.setCacheTtlForTests(60_000);
    expect((await settings.getAll()).lateAfter).toBe('09:30');
    // A direct database change is invisible while the cache is warm...
    await setSettings({ late_after: '09:45' });
    expect((await settings.getAll()).lateAfter).toBe('09:30');
    // ...and a save through the service clears it.
    const saved = await settings.update({ user: admin, values: { reportReminderAt: '19:00' } });
    expect(saved.reportReminderAt).toBe('19:00');
    expect(saved.lateAfter).toBe('09:45');
    expect((await settings.getAll()).lateAfter).toBe('09:45');
    await setSettings({ late_after: '09:30', report_reminder_at: '18:30' });
  });

  it('rejects invalid values with a message per field', async () => {
    const error = await expectAppError(
      settings.update({
        user: admin,
        values: {
          companyName: '   ',
          timezone: 'Mars/Olympus',
          workingDays: [],
          officeStart: '25:00',
          reportLock: 'tomorrow',
          gapWarningMinutes: 5,
          slackRemind: 'yes',
        },
      }),
      'VALIDATION_FAILED',
    );
    expect(error.status).toBe(400);
    expect(Object.keys(error.fields).sort()).toEqual(
      [
        'companyName',
        'gapWarningMinutes',
        'officeStart',
        'reportLock',
        'slackRemind',
        'timezone',
        'workingDays',
      ].sort(),
    );
    expect(error.fields.timezone).toBe('Pick a valid time zone.');
    expect(error.fields.workingDays).toBe('Pick at least one working day.');
    expect((await settings.getAll()).companyName).toBe('Acme Studio');
  });

  it('accepts the report lock formats, clocks with seconds and a cleared channel', async () => {
    const saved = await settings.update({
      user: admin,
      values: {
        reportLock: 'same_day_23:59',
        officeStart: '09:00:00',
        timezone: 'Europe/London',
        slackReportChannelId: 'C0123ABCD',
        slackReportChannelName: '#daily-reports',
      },
    });
    expect(saved).toMatchObject({
      reportLock: 'same_day_23:59',
      officeStart: '09:00',
      timezone: 'Europe/London',
      slackReportChannelId: 'C0123ABCD',
      slackReportChannelName: 'daily-reports',
    });
    const cleared = await settings.update({
      user: admin,
      values: { slackReportChannelId: '', slackReportChannelName: null },
    });
    expect(cleared.slackReportChannelId).toBeNull();
    expect(cleared.slackReportChannelName).toBeNull();
    await expectAppError(
      settings.update({ user: admin, values: { reportLock: 'next_day_24:00' } }),
      'VALIDATION_FAILED',
    );
  });

  it('saves and reads the to-do channel (CONTRACT 24), null by default and apart from reports', async () => {
    await setSettings({ slack_report_channel_id: 'C0REPORTS', slack_report_channel_name: 'daily' });
    const before = await settings.getAll();
    expect(before).toMatchObject({ slackTodoChannelId: null, slackTodoChannelName: null });

    const saved = await settings.update({
      user: admin,
      values: { slackTodoChannelId: 'C0TODO', slackTodoChannelName: '#morning-todo' },
    });
    expect(saved).toMatchObject({
      slackTodoChannelId: 'C0TODO',
      slackTodoChannelName: 'morning-todo',
      slackReportChannelId: 'C0REPORTS',
      slackReportChannelName: 'daily',
    });
    const row = await db('settings').where({ key: 'slack_todo_channel_id' }).first();
    expect(parseJson(row.value)).toBe('C0TODO');
    expect(row.updatedBy).toBe(admin.id);

    // "Don't post to-dos" saves null for both; the report channel stays as it was.
    const cleared = await settings.update({
      user: admin,
      values: { slackTodoChannelId: '', slackTodoChannelName: null },
    });
    expect(cleared).toMatchObject({
      slackTodoChannelId: null,
      slackTodoChannelName: null,
      slackReportChannelId: 'C0REPORTS',
    });
    await expectAppError(
      settings.update({ user: admin, values: { slackTodoChannelId: 'C'.repeat(41) } }),
      'VALIDATION_FAILED',
    );
    await setSettings({ slack_report_channel_id: null, slack_report_channel_name: null });
  });

  it('reads missing to-do channel rows as null, and adds the row on the first save', async () => {
    // The live server never runs seeds: a database seeded before 1.09 has no such rows.
    await db('settings')
      .whereIn('key', ['slack_todo_channel_id', 'slack_todo_channel_name'])
      .delete();
    expect(await settings.getAll()).toMatchObject({
      slackTodoChannelId: null,
      slackTodoChannelName: null,
    });
    const saved = await settings.update({
      user: admin,
      values: { slackTodoChannelId: 'C0TODO', slackTodoChannelName: 'morning-todo' },
    });
    expect(saved.slackTodoChannelId).toBe('C0TODO');
    const keys = await db('settings')
      .whereIn('key', ['slack_todo_channel_id', 'slack_todo_channel_name'])
      .pluck('key');
    expect(keys.sort()).toEqual(['slack_todo_channel_id', 'slack_todo_channel_name']);
    await setSettings({ slack_todo_channel_id: null, slack_todo_channel_name: null });
  });
});

describe('attendance marks and HR updates (CONTRACT 25)', () => {
  beforeEach(() => settings.setCacheTtlForTests(null));

  it('reads the defaults when the rows are missing (the live server never seeds)', async () => {
    const rows = await db('settings').whereIn('key', Object.keys(KEYS_1_10)).select('key', 'value');
    expect(rows).toHaveLength(11);
    await db('settings').whereIn('key', Object.keys(KEYS_1_10)).delete();
    expect(pick110(await settings.getAll())).toEqual(DEFAULTS_1_10);

    // The first save adds the row; the others keep reading their defaults.
    const saved = await settings.update({ user: admin, values: { lateAlertDays: 6 } });
    expect(pick110(saved)).toEqual({ ...DEFAULTS_1_10, lateAlertDays: 6 });
    expect(await db('settings').where({ key: 'late_alert_days' }).first()).toMatchObject({
      value: '6',
      updatedBy: admin.id,
    });
    await db('settings').where({ key: 'late_alert_days' }).delete();
    await db('settings').insert(rows);
    expect(pick110(await settings.getAll())).toEqual(DEFAULTS_1_10);
  });

  it('keeps a hand-edited number inside its range and a broken clock at the default', async () => {
    await setSettings({
      half_day_under_minutes: 9000,
      payroll_month_start_day: 0,
      late_alert_days: 'many',
      checkin_reminder_minutes: -5,
      hr_summary_at: '',
    });
    expect(await settings.getAll()).toMatchObject({
      halfDayUnderMinutes: 720,
      payrollMonthStartDay: 1,
      lateAlertDays: 4,
      checkinReminderMinutes: 0,
      hrSummaryAt: '10:00',
    });
    await setSettings({
      half_day_under_minutes: 270,
      payroll_month_start_day: 1,
      late_alert_days: 4,
      checkin_reminder_minutes: 30,
      hr_summary_at: '10:00',
    });
  });

  it('saves every key with an audit row, and reads the clock as HH:mm', async () => {
    const values = {
      halfDayUnderMinutes: '240',
      shortDayUnderMinutes: 450,
      leftEarlyGraceMinutes: 0,
      payrollMonthStartDay: 26,
      hrMorningSummary: false,
      hrSummaryAt: '9:45',
      hrEveningSummary: true,
      checkinReminderMinutes: 0,
      lateAlertDays: 31,
      slackAttendanceRemind: false,
      slackHrSummary: false,
    };
    const saved = await settings.update({ user: admin, values });
    expect(pick110(saved)).toEqual({ ...values, halfDayUnderMinutes: 240, hrSummaryAt: '09:45' });
    const log = await db('audit_logs')
      .where({ action: 'settings.update' })
      .orderBy('id', 'desc')
      .first();
    expect(parseJson(log.before)).toEqual(DEFAULTS_1_10);
    expect(parseJson(log.after)).toEqual(pick110(saved));
    const restored = await settings.update({ user: admin, values: DEFAULTS_1_10 });
    expect(pick110(restored)).toEqual(DEFAULTS_1_10);
  });

  it('refuses values out of range with the Settings messages', async () => {
    const reminder = 'The reminder must be between 0 and 240 minutes (0 turns it off).';
    const cases = [
      ['halfDayUnderMinutes', 721, 'Half day must be between 0 and 720 minutes (0 turns it off).'],
      ['shortDayUnderMinutes', -1, 'Short day must be between 0 and 720 minutes (0 turns it off).'],
      ['leftEarlyGraceMinutes', 241, 'The left early grace must be between 0 and 240 minutes.'],
      ['payrollMonthStartDay', 29, 'The payroll month must start on a day from 1 to 28.'],
      ['payrollMonthStartDay', 0, 'The payroll month must start on a day from 1 to 28.'],
      ['checkinReminderMinutes', 2.5, reminder],
      ['checkinReminderMinutes', 241, reminder],
      ['lateAlertDays', 0, 'Late days must be between 1 and 31.'],
      ['lateAlertDays', 32, 'Late days must be between 1 and 31.'],
      ['hrSummaryAt', '10 am', 'Enter a time like 10:00.'],
      ['hrMorningSummary', 'yes', 'Choose on or off.'],
      ['hrEveningSummary', null, 'Choose on or off.'],
      ['slackAttendanceRemind', 'on', 'Choose on or off.'],
      ['slackHrSummary', 1, 'Choose on or off.'],
    ];
    for (const [key, value, message] of cases) {
      const error = await expectAppError(
        settings.update({ user: admin, values: { [key]: value } }),
        'VALIDATION_FAILED',
      );
      expect(error.fields, `${key} = ${value}`).toEqual({ [key]: message });
    }
    // The edges are allowed.
    const edges = await settings.update({
      user: admin,
      values: { halfDayUnderMinutes: 0, shortDayUnderMinutes: 720, payrollMonthStartDay: 28 },
    });
    expect(edges).toMatchObject({
      halfDayUnderMinutes: 0,
      shortDayUnderMinutes: 720,
      payrollMonthStartDay: 28,
    });
    await settings.update({ user: admin, values: DEFAULTS_1_10 });
    expect(pick110(await settings.getAll())).toEqual(DEFAULTS_1_10);
  });

  it('checkDayMarks: a half day below a short day while both are on', async () => {
    const message = 'Half day must be less than the short day time.';
    for (const values of [
      { halfDayUnderMinutes: 480 },
      { shortDayUnderMinutes: 200 },
      { halfDayUnderMinutes: 500, shortDayUnderMinutes: 400 },
    ]) {
      const error = await expectAppError(
        settings.update({ user: admin, values }),
        'VALIDATION_FAILED',
      );
      expect(error.fields).toEqual({ halfDayUnderMinutes: message });
      expect(error.message).toBe(message);
    }
    // 0 turns a mark off, so the other can be anything.
    let saved = await settings.update({
      user: admin,
      values: { halfDayUnderMinutes: 600, shortDayUnderMinutes: 0 },
    });
    expect(saved).toMatchObject({ halfDayUnderMinutes: 600, shortDayUnderMinutes: 0 });
    saved = await settings.update({
      user: admin,
      values: { halfDayUnderMinutes: 0, shortDayUnderMinutes: 100 },
    });
    expect(saved).toMatchObject({ halfDayUnderMinutes: 0, shortDayUnderMinutes: 100 });
    // Neither sent: a stored clash (a hand-edited row) never blocks other saves.
    await setSettings({ half_day_under_minutes: 500, short_day_under_minutes: 400 });
    expect(
      (await settings.update({ user: admin, values: { lateAlertDays: 5 } })).lateAlertDays,
    ).toBe(5);
    await settings.update({ user: admin, values: DEFAULTS_1_10 });
    expect(pick110(await settings.getAll())).toEqual(DEFAULTS_1_10);
  });

  it('checkHrSummary: at or after the late mark and before office end, while the summary is on', async () => {
    const tooEarly = (clock) => ({
      hrSummaryAt: `Pick a time at or after the late mark (${clock}).`,
    });
    const tooLate = { hrSummaryAt: 'Pick a time before office hours end.' };
    const refused = async (values) =>
      (await expectAppError(settings.update({ user: admin, values }), 'VALIDATION_FAILED')).fields;

    expect(await refused({ hrSummaryAt: '09:15' })).toEqual(tooEarly('9:30'));
    expect(await refused({ hrSummaryAt: '18:30' })).toEqual(tooLate);
    // Moving the late mark or office end past the summary is refused on the summary time.
    expect(await refused({ lateAfter: '13:05' })).toEqual(tooEarly('1:05'));
    expect(await refused({ officeEnd: '10:00' })).toEqual(tooLate);

    // The late mark itself is fine, and so is moving both together.
    const atMark = await settings.update({ user: admin, values: { hrSummaryAt: '09:30' } });
    expect(atMark.hrSummaryAt).toBe('09:30');
    const moved = await settings.update({
      user: admin,
      values: { lateAfter: '10:15', hrSummaryAt: '10:15' },
    });
    expect(moved).toMatchObject({ lateAfter: '10:15', hrSummaryAt: '10:15' });

    // Off: the time isn't checked (the form hides it), and turning it back on checks it.
    const off = await settings.update({
      user: admin,
      values: { hrMorningSummary: false, hrSummaryAt: '07:00' },
    });
    expect(off).toMatchObject({ hrMorningSummary: false, hrSummaryAt: '07:00' });
    expect(await refused({ hrMorningSummary: true })).toEqual(tooEarly('10:15'));
    expect((await settings.getAll()).hrMorningSummary).toBe(false);

    await settings.update({
      user: admin,
      values: { lateAfter: '09:30', hrSummaryAt: '10:00', hrMorningSummary: true },
    });
    expect(pick110(await settings.getAll())).toEqual(DEFAULTS_1_10);
  });
});

// CONTRACT 27: Settings → Files, the largest file and the storage limit.
describe('files (CONTRACT 27)', () => {
  const FILE_KEYS = { file_max_mb: 'fileMaxMb', file_storage_limit_gb: 'fileStorageLimitGb' };
  const FILE_DEFAULTS = { fileMaxMb: 500, fileStorageLimitGb: 10 };
  const pickFiles = (values) =>
    Object.fromEntries(Object.values(FILE_KEYS).map((key) => [key, values[key]]));
  const TOO_BIG = "The largest file can't be bigger than the storage limit.";

  beforeEach(() => settings.setCacheTtlForTests(null));

  it('reads the defaults when the rows are missing (the live server never seeds)', async () => {
    const rows = await db('settings').whereIn('key', Object.keys(FILE_KEYS)).select('key', 'value');
    expect(rows).toHaveLength(2);
    await db('settings').whereIn('key', Object.keys(FILE_KEYS)).delete();
    expect(pickFiles(await settings.getAll())).toEqual(FILE_DEFAULTS);
    const saved = await settings.update({ user: admin, values: { fileStorageLimitGb: 25 } });
    expect(pickFiles(saved)).toEqual({ fileMaxMb: 500, fileStorageLimitGb: 25 });
    await db('settings').whereIn('key', Object.keys(FILE_KEYS)).delete();
    await db('settings').insert(rows);
    expect(pickFiles(await settings.getAll())).toEqual(FILE_DEFAULTS);
  });

  it('keeps a hand-edited value inside its range', async () => {
    await setSettings({ file_max_mb: 99999, file_storage_limit_gb: 0 });
    expect(pickFiles(await settings.getAll())).toEqual({ fileMaxMb: 2048, fileStorageLimitGb: 1 });
    await setSettings({ file_max_mb: 'lots', file_storage_limit_gb: -3 });
    expect(pickFiles(await settings.getAll())).toEqual({ fileMaxMb: 500, fileStorageLimitGb: 1 });
    await setSettings({ file_max_mb: 500, file_storage_limit_gb: 10 });
  });

  it('saves both keys with an audit row', async () => {
    const saved = await settings.update({
      user: admin,
      values: { fileMaxMb: '750', fileStorageLimitGb: 40 },
    });
    expect(pickFiles(saved)).toEqual({ fileMaxMb: 750, fileStorageLimitGb: 40 });
    const log = await db('audit_logs')
      .where({ action: 'settings.update' })
      .orderBy('id', 'desc')
      .first();
    expect(parseJson(log.before)).toEqual(FILE_DEFAULTS);
    expect(parseJson(log.after)).toEqual({ fileMaxMb: 750, fileStorageLimitGb: 40 });
    await settings.update({ user: admin, values: FILE_DEFAULTS });
    expect(pickFiles(await settings.getAll())).toEqual(FILE_DEFAULTS);
  });

  it('refuses values out of range with the Settings messages', async () => {
    const size = 'Pick a size from 1 to 2,048 MB.';
    const limit = 'Pick a limit from 1 to 1,000 GB.';
    const cases = [
      ['fileMaxMb', 0, size],
      ['fileMaxMb', 2049, size],
      ['fileMaxMb', 1.5, size],
      ['fileMaxMb', 'big', size],
      ['fileStorageLimitGb', 0, limit],
      ['fileStorageLimitGb', 1001, limit],
      ['fileStorageLimitGb', null, limit],
    ];
    for (const [key, value, message] of cases) {
      const error = await expectAppError(
        settings.update({ user: admin, values: { [key]: value } }),
        'VALIDATION_FAILED',
      );
      expect(error.fields, `${key} = ${value}`).toEqual({ [key]: message });
    }
    const edges = await settings.update({
      user: admin,
      values: { fileMaxMb: 2048, fileStorageLimitGb: 1000 },
    });
    expect(pickFiles(edges)).toEqual({ fileMaxMb: 2048, fileStorageLimitGb: 1000 });
    await settings.update({ user: admin, values: FILE_DEFAULTS });
  });

  it('checkFileLimits: the largest file fits in the storage limit (1 GB = 1,024 MB)', async () => {
    const refused = await expectAppError(
      settings.update({ user: admin, values: { fileMaxMb: 1025, fileStorageLimitGb: 1 } }),
      'VALIDATION_FAILED',
    );
    expect(refused.fields).toEqual({ fileMaxMb: TOO_BIG });
    expect(refused.message).toBe(TOO_BIG);
    // Lowering the limit alone under the stored largest file is checked on the values after it.
    await settings.update({ user: admin, values: { fileMaxMb: 2048, fileStorageLimitGb: 5 } });
    const lowered = await expectAppError(
      settings.update({ user: admin, values: { fileStorageLimitGb: 1 } }),
      'VALIDATION_FAILED',
    );
    expect(lowered.fields).toEqual({ fileMaxMb: TOO_BIG });
    expect(pickFiles(await settings.getAll())).toEqual({ fileMaxMb: 2048, fileStorageLimitGb: 5 });
    const fits = await settings.update({
      user: admin,
      values: { fileMaxMb: 1024, fileStorageLimitGb: 1 },
    });
    expect(pickFiles(fits)).toEqual({ fileMaxMb: 1024, fileStorageLimitGb: 1 });
    // Other keys never run the check.
    await setSettings({ file_max_mb: 2048, file_storage_limit_gb: 1 });
    await settings.update({ user: admin, values: { lateAlertDays: 5 } });
    await settings.update({ user: admin, values: { ...FILE_DEFAULTS, lateAlertDays: 4 } });
    expect(pickFiles(await settings.getAll())).toEqual(FILE_DEFAULTS);
  });
});

describe('office networks', () => {
  it('adds a network with an audit row and rejects a duplicate IP', async () => {
    const network = await settings.addOfficeNetwork({
      user: admin,
      name: ' Main office ',
      ipAddress: ' 203.0.113.24 ',
      ip: '203.0.113.24',
    });
    expect(network).toMatchObject({
      name: 'Main office',
      ipAddress: '203.0.113.24',
      createdBy: admin.id,
    });
    const log = await db('audit_logs')
      .where({ action: 'office_network.add', entityId: network.id })
      .first();
    expect(parseJson(log.after)).toEqual({ name: 'Main office', ipAddress: '203.0.113.24' });

    const duplicate = await expectAppError(
      settings.addOfficeNetwork({ user: admin, name: 'Again', ipAddress: '::ffff:203.0.113.24' }),
      'DUPLICATE_NETWORK',
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.fields.ipAddress).toBe('That IP address is already saved.');
    expect(await settings.listOfficeNetworks()).toHaveLength(1);
  });

  it('validates the name and the IP address', async () => {
    const error = await expectAppError(
      settings.addOfficeNetwork({ user: admin, name: '', ipAddress: '300.1.1.1' }),
      'VALIDATION_FAILED',
    );
    expect(error.fields).toEqual({
      name: 'Enter a name for this network.',
      ipAddress: 'Enter a valid IP address, like 203.0.113.24.',
    });
    const ipv6 = await settings.addOfficeNetwork({
      user: admin,
      name: 'Branch',
      ipAddress: '2001:DB8::1',
    });
    expect(ipv6.ipAddress).toBe('2001:db8::1');
  });

  it('isOfficeIp matches exactly, after normalising ::ffff:', async () => {
    expect(await settings.isOfficeIp('203.0.113.24')).toBe(true);
    expect(await settings.isOfficeIp('::ffff:203.0.113.24')).toBe(true);
    expect(await settings.isOfficeIp('2001:db8::1')).toBe(true);
    expect(await settings.isOfficeIp('203.0.113.2')).toBe(false);
    expect(await settings.isOfficeIp('203.0.113.245')).toBe(false);
    expect(await settings.isOfficeIp(null)).toBe(false);
    expect(await settings.isOfficeIp('')).toBe(false);
  });

  it('removes a network with an audit row; removing again is NOT_FOUND', async () => {
    const [network] = await settings.listOfficeNetworks();
    expect(
      await settings.removeOfficeNetwork({ user: admin, id: String(network.id), ip: '10.0.0.1' }),
    ).toEqual({
      id: network.id,
    });
    const log = await db('audit_logs')
      .where({ action: 'office_network.remove', entityId: network.id })
      .first();
    expect(parseJson(log.before)).toEqual({ name: 'Main office', ipAddress: '203.0.113.24' });
    expect(log.ip).toBe('10.0.0.1');
    expect(await settings.isOfficeIp('203.0.113.24')).toBe(false);
    await expectAppError(
      settings.removeOfficeNetwork({ user: admin, id: network.id }),
      'NOT_FOUND',
    );
    await expectAppError(settings.removeOfficeNetwork({ user: admin, id: 'abc' }), 'NOT_FOUND');
  });
});
