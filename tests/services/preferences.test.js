// My settings (CONTRACT 21): the defaults, stored values over them (unknown keys and values gone
// stale ignored), strict updates that name the field, partial updates that keep the other keys,
// each person's own row and the fallback while the table is missing. The API is in
// preferencesRoute.test.js.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, parseJson } from '@/lib/db';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { preferences, preferencesFor } from '@/modules/preferences';
import { createUser, resetDatabase } from '../helpers/db.js';

const T0 = '2026-10-26T06:00:00Z'; // Monday 26 October, 11:30 in Kolkata
const DEFAULTS = {
  submitButtons: 'both',
  newTaskStatus: 'in_progress',
  carryOver: true,
  slackPreview: true,
  polishButton: true,
  polishLines: true,
  polishAfterTimers: true,
  bellRing: true,
  theme: 'system',
};
let alice;
let bob;

/** What the person's row holds (null without one). */
async function storedRow(user) {
  const row = await db('userPreferences').where({ userId: user.id }).first();
  return row ? parseJson(row.prefs) : null;
}

async function expectValidation(values, fields) {
  const error = await preferences.update({ user: alice, values }).then(
    () => null,
    (caught) => caught,
  );
  expect(error, 'expected VALIDATION_FAILED').not.toBeNull();
  expect(error.code).toBe('VALIDATION_FAILED');
  expect(error.fields).toEqual(fields);
  expect(error.message).toBe(Object.values(fields)[0]);
}

beforeAll(async () => {
  await resetDatabase();
  alice = await createUser({ name: 'Alice Mehta' });
  bob = await createUser({ name: 'Bob Singh', role: 'pm', tracksAttendance: false });
});

beforeEach(async () => {
  setNowForTests(T0);
  await db('userPreferences').delete();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reading preferences', () => {
  it('gives every key its default before the first change, without creating a row', async () => {
    expect(preferences.PREFERENCE_DEFAULTS).toEqual(DEFAULTS);
    expect(Object.isFrozen(preferences.PREFERENCE_DEFAULTS)).toBe(true);
    const mine = await preferences.getFor(alice.id);
    expect(mine).toEqual(DEFAULTS);
    mine.theme = 'dark'; // a copy: the defaults never change
    expect(preferences.PREFERENCE_DEFAULTS.theme).toBe('system');
    expect(await storedRow(alice)).toBeNull();
    expect(await preferences.getFor(undefined)).toEqual(DEFAULTS);
  });

  it('puts stored values over the defaults and ignores unknown keys and stale values', async () => {
    await db('userPreferences').insert({
      userId: alice.id,
      prefs: JSON.stringify({
        submitButtons: 'checkout',
        bellRing: false,
        theme: 'purple',
        carryOver: 'no',
        newTaskStatus: 'blocked',
        oldKey: 1,
      }),
      updatedAt: new Date(T0),
    });
    expect(await preferences.getFor(alice.id)).toEqual({
      ...DEFAULTS,
      submitButtons: 'checkout',
      bellRing: false,
    });
  });

  it('gives the defaults when the stored value is not an object', async () => {
    await db('userPreferences').insert({
      userId: alice.id,
      prefs: JSON.stringify(['dark']),
      updatedAt: new Date(T0),
    });
    expect(await preferences.getFor(alice.id)).toEqual(DEFAULTS);
    // The next change still saves (a merge patch over a non-object starts from {}).
    await preferences.update({ user: alice, values: { theme: 'dark' } });
    expect(await storedRow(alice)).toEqual({ theme: 'dark' });
  });

  it('reads once per request through preferencesFor (every read outside one)', async () => {
    await preferences.update({ user: alice, values: { slackPreview: false } });
    const mine = await preferencesFor(alice);
    expect(mine).toEqual({ ...DEFAULTS, slackPreview: false });
    expect(Object.isFrozen(mine)).toBe(true);
    await preferences.update({ user: alice, values: { slackPreview: true } });
    expect((await preferencesFor(alice)).slackPreview).toBe(true);
  });
});

describe('saving preferences', () => {
  it('saves one key, keeps the others, and stores only the keys that differ', async () => {
    const first = await preferences.update({ user: alice, values: { theme: 'dark' } });
    expect(first).toEqual({ ...DEFAULTS, theme: 'dark' });
    const second = await preferences.update({
      user: alice,
      values: { carryOver: false, submitButtons: 'submit' },
    });
    expect(second).toEqual({
      ...DEFAULTS,
      theme: 'dark',
      carryOver: false,
      submitButtons: 'submit',
    });
    expect(await storedRow(alice)).toEqual({
      theme: 'dark',
      carryOver: false,
      submitButtons: 'submit',
    });

    // Back to a default: the key leaves the row, the others stay.
    const third = await preferences.update({ user: alice, values: { theme: 'system' } });
    expect(third).toEqual({ ...DEFAULTS, carryOver: false, submitButtons: 'submit' });
    expect(await storedRow(alice)).toEqual({ carryOver: false, submitButtons: 'submit' });
    const row = await db('userPreferences').where({ userId: alice.id }).first();
    expect(row.updatedAt.toISOString()).toBe('2026-10-26T06:00:00.000Z');
  });

  it('creates the row on the first change, even when it sets a default', async () => {
    expect(await preferences.update({ user: alice, values: { bellRing: true } })).toEqual(DEFAULTS);
    expect(await storedRow(alice)).toEqual({});
  });

  it('keeps both changes saved at the same moment', async () => {
    await Promise.all([
      preferences.update({ user: alice, values: { theme: 'light' } }),
      preferences.update({ user: alice, values: { polishLines: false } }),
      preferences.update({ user: alice, values: { newTaskStatus: 'done' } }),
    ]);
    expect(await preferences.getFor(alice.id)).toEqual({
      ...DEFAULTS,
      theme: 'light',
      polishLines: false,
      newTaskStatus: 'done',
    });
  });

  it("changes only the person's own row", async () => {
    await preferences.update({ user: alice, values: { theme: 'dark', polishButton: false } });
    await preferences.update({ user: bob, values: { bellRing: false } });
    expect(await preferences.getFor(alice.id)).toEqual({
      ...DEFAULTS,
      theme: 'dark',
      polishButton: false,
    });
    expect(await preferences.getFor(bob.id)).toEqual({ ...DEFAULTS, bellRing: false });
  });

  it('refuses unknown keys, wrong values and empty changes, naming the field', async () => {
    await expectValidation({ colour: 'red' }, { colour: '"colour" isn\'t one of your settings.' });
    await expectValidation(
      { theme: 'purple' },
      {
        theme: 'Theme must be Match my computer, Light or Dark.',
      },
    );
    await expectValidation(
      { submitButtons: 'none' },
      {
        submitButtons: 'Submit buttons must be Both, Submit and check out, or Submit report.',
      },
    );
    await expectValidation(
      { newTaskStatus: 'blocked' },
      {
        newTaskStatus: 'New tasks must start as In progress or Done.',
      },
    );
    await expectValidation(
      { carryOver: 'false' },
      {
        carryOver: 'Bring unfinished tasks into my next report must be on or off.',
      },
    );
    await expectValidation(
      { bellRing: null },
      {
        bellRing: 'Ring the bell for unread notifications must be on or off.',
      },
    );
    await expectValidation({}, { _: 'Choose a setting to change.' });
    await expectValidation(undefined, { _: 'Choose a setting to change.' });
    await expectValidation({ theme: undefined }, { _: 'Choose a setting to change.' });
    await expectValidation(['theme'], { _: 'Send the settings to change.' });
    // A good key next to a bad one saves nothing.
    await expectValidation(
      { theme: 'dark', toString: true },
      { toString: '"toString" isn\'t one of your settings.' },
    );
    // Only the first unknown key is named, and a key zod would drop ("__proto__") counts too.
    await expectValidation(
      { colour: 'red', size: 2, theme: 'purple' },
      { colour: '"colour" isn\'t one of your settings.' },
    );
    await expectValidation(JSON.parse('{"__proto__":{"x":1},"theme":"dark"}'), {
      ['__proto__']: '"__proto__" isn\'t one of your settings.',
    });
    expect(await storedRow(alice)).toBeNull();
  });

  it('needs a person', async () => {
    await expect(
      preferences.update({ user: null, values: { theme: 'dark' } }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it("goes with the person's account", async () => {
    const carol = await createUser({ name: 'Carol Dsouza' });
    await preferences.update({ user: carol, values: { theme: 'dark' } });
    await db('users').where({ id: carol.id }).delete();
    expect(await db('userPreferences').where({ userId: carol.id }).first()).toBeUndefined();
  });
});

describe('before the migration ran', () => {
  it('gives the defaults with one warning, and refuses to save', async () => {
    await preferences.update({ user: alice, values: { theme: 'dark' } });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await db.raw('RENAME TABLE `user_preferences` TO `user_preferences_hidden`');
    try {
      expect(await preferences.getFor(alice.id)).toEqual(DEFAULTS);
      expect(await preferences.getFor(bob.id)).toEqual(DEFAULTS);
      await expect(
        preferences.update({ user: alice, values: { theme: 'light' } }),
      ).rejects.toMatchObject({ code: 'PREFERENCES_UNAVAILABLE', status: 503 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0].at(-1))).toMatch(/user_preferences/);
    } finally {
      await db.raw('RENAME TABLE `user_preferences_hidden` TO `user_preferences`');
    }
    expect(await preferences.getFor(alice.id)).toEqual({ ...DEFAULTS, theme: 'dark' });
  });

  it('still throws other database errors', async () => {
    await db.raw('ALTER TABLE `user_preferences` CHANGE `prefs` `prefs_hidden` JSON NOT NULL');
    try {
      await expect(preferences.getFor(alice.id)).rejects.toMatchObject({ errno: 1054 });
    } finally {
      await db.raw('ALTER TABLE `user_preferences` CHANGE `prefs_hidden` `prefs` JSON NOT NULL');
    }
    expect(await preferences.getFor(alice.id)).toEqual(DEFAULTS);
  });
});
