// Settings → AI (CONTRACT 20): the form's AI keys — defaults, what the fields show, the daily limit
// and the two times (hidden while AI or their feature is off: never an error there, unreadable
// text keeps the saved value), only changed keys sent — and the form's limits and clock words
// match the API's messages.
import { beforeAll, describe, expect, it } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { setNowForTests } from '@/lib/time';
import { settings } from '@/modules/settings';
import { AI_DAILY_LIMIT } from '@/modules/settings/schemas';
import { NUMBERS } from '@/app/(app)/settings/numberFields';
import { SECTIONS } from '@/app/(app)/settings/SettingsNav';
import {
  AI_CLOCKS,
  changedKeys,
  isShown,
  KEYS,
  toForm,
  toValues,
} from '@/app/(app)/settings/settingsValues';
import { createUser, resetDatabase } from '../helpers/db.js';

const AI_KEYS = [
  'aiEnabled',
  'aiDailyLimit',
  'aiPolishEnabled',
  'aiPmSummaryEnabled',
  'aiPmSummaryAt',
  'aiSummarySlack',
  'aiHrNotesEnabled',
  'aiHrNotesAt',
  'aiAskEnabled',
];

let admin;
let saved;

beforeAll(async () => {
  await resetDatabase();
  setNowForTests('2026-10-26T04:00:00Z');
  admin = await createUser({ name: 'Admin Person', role: 'admin', email: 'admin@example.com' });
  saved = await settings.getAll();
});

const edit = (changes, from = saved) => ({ ...toForm(from), ...changes });
const pick = (values) => Object.fromEntries(AI_KEYS.map((key) => [key, values[key]]));

async function expectAppError(promise, code) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error, `expected ${code}`).not.toBeNull();
  expect(error.code).toBe(code);
  return error;
}

describe('Settings → AI form', () => {
  it('edits every AI key, last on the page, in the AI section', () => {
    expect(KEYS.slice(-AI_KEYS.length)).toEqual(AI_KEYS);
    expect(SECTIONS.at(-1)).toEqual({ id: 'ai', label: 'AI' });
  });

  it('shows the defaults: AI off, 200 a day, every feature on at 7:00 PM', () => {
    const form = toForm(saved);
    expect(pick(form)).toEqual({
      aiEnabled: false,
      aiDailyLimit: '200',
      aiPolishEnabled: true,
      aiPmSummaryEnabled: true,
      aiPmSummaryAt: '7:00 PM',
      aiSummarySlack: true,
      aiHrNotesEnabled: true,
      aiHrNotesAt: '7:00 PM',
      aiAskEnabled: true,
    });
    const { values, errors } = toValues(form, saved);
    expect(errors).toEqual({});
    expect(changedKeys(values, saved)).toEqual({});
  });

  it('saves the switches, the limit and the times, sending only what changed', async () => {
    const form = edit({
      aiEnabled: true,
      aiDailyLimit: ' 350 ',
      aiPmSummaryAt: '6:45 pm',
      aiSummarySlack: false,
      aiAskEnabled: false,
    });
    const { values, errors } = toValues(form, saved);
    expect(errors).toEqual({});
    const body = changedKeys(values, saved);
    expect(body).toEqual({
      aiEnabled: true,
      aiDailyLimit: 350,
      aiPmSummaryAt: '18:45',
      aiSummarySlack: false,
      aiAskEnabled: false,
    });
    const after = await settings.update({ user: admin, values: body, ip: '203.0.113.9' });
    expect(pick(after)).toMatchObject({ ...body, aiHrNotesAt: '19:00' });
    const row = await db('settings').where({ key: 'ai_daily_limit' }).first();
    expect(parseJson(row.value)).toBe(350);
    expect(toForm(after).aiPmSummaryAt).toBe('6:45 PM');
    // Back to the defaults for the other tests.
    await settings.update({ user: admin, values: pick(saved) });
  });

  it('checks the limit and the times while they are shown', () => {
    const on = edit({ aiEnabled: true });
    for (const text of ['', '-1', '2001', '12.5', 'lots']) {
      expect(toValues({ ...on, aiDailyLimit: text }, saved).errors, text).toEqual({
        aiDailyLimit: 'The daily AI limit must be between 0 and 2000.',
      });
    }
    expect(toValues({ ...on, aiDailyLimit: '0' }, saved).errors).toEqual({});
    expect(toValues({ ...on, aiPmSummaryAt: 'evening' }, saved).errors).toEqual({
      aiPmSummaryAt: 'Enter the summary time like 9:30 AM.',
    });
    expect(toValues({ ...on, aiHrNotesAt: '25:00' }, saved).errors).toEqual({
      aiHrNotesAt: 'Enter the HR notes time like 9:30 AM.',
    });
  });

  it('never flags hidden fields: unreadable text keeps the saved value', () => {
    // AI off hides the limit and both times; a feature that is off hides its own time.
    const hidden = [
      edit({ aiEnabled: false, aiDailyLimit: 'lots', aiPmSummaryAt: 'x', aiHrNotesAt: '' }),
      edit({ aiEnabled: true, aiPmSummaryEnabled: false, aiPmSummaryAt: 'evening' }),
      edit({ aiEnabled: true, aiHrNotesEnabled: false, aiHrNotesAt: 'friday' }),
    ];
    const expected = [
      {},
      { aiEnabled: true, aiPmSummaryEnabled: false },
      { aiEnabled: true, aiHrNotesEnabled: false },
    ];
    hidden.forEach((form, i) => {
      const { values, errors } = toValues(form, saved);
      expect(errors, String(i)).toEqual({});
      expect(changedKeys(values, saved), String(i)).toEqual(expected[i]);
    });
    expect(isShown(edit({ aiEnabled: true }), 'aiDailyLimit')).toBe(true);
    expect(isShown(edit({ aiEnabled: false }), 'aiPmSummaryAt')).toBe(false);
    expect(isShown(edit({}), 'companyName')).toBe(true);
  });

  it('uses the API limits and messages', async () => {
    expect({ min: NUMBERS.aiDailyLimit.min, max: NUMBERS.aiDailyLimit.max }).toEqual({
      ...AI_DAILY_LIMIT,
    });
    const range = await expectAppError(
      settings.update({ user: admin, values: { aiDailyLimit: 2001 } }),
      'VALIDATION_FAILED',
    );
    expect(range.fields.aiDailyLimit).toBe(NUMBERS.aiDailyLimit.message);
    expect(Object.keys(AI_CLOCKS)).toEqual(['aiPmSummaryAt', 'aiHrNotesAt']);
    for (const [key, label] of Object.entries(AI_CLOCKS)) {
      const error = await expectAppError(
        settings.update({ user: admin, values: { [key]: 'soon' } }),
        'VALIDATION_FAILED',
      );
      expect(error.fields[key]).toBe(`Enter ${label} as a time like 09:30.`);
    }
    expect(pick(await settings.getAll())).toEqual(pick(saved));
  });
});
