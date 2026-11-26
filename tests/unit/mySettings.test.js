// My settings (CONTRACT 21, 26, 28): the sections each person sees, the Segmented choices, the
// one-at-a-time saver, and the default Sound (All since CONTRACT 28: a person with no stored row
// chimes for a new task, and the Notifications card shows All pressed with its help line).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import MySettingsSections from '@/app/(app)/my-settings/MySettingsSections.jsx';
import {
  NEW_TASK_CHOICES,
  SECTIONS,
  sectionsFor,
  SOUND_CHOICES,
  SUBMIT_BUTTON_CHOICES,
  THEME_CHOICES,
  TONE_CHOICES,
  writesReports,
} from '@/app/(app)/my-settings/sections';
import { createPreferenceSaver } from '@/app/(app)/my-settings/preferenceSaver';
import { TONE_NAMES } from '@/components/live/chime';
import { shouldChime } from '@/components/live/liveRules';
import { UserPrefsProvider, useBellSound } from '@/components/UserPrefs.jsx';
import {
  BELL_SOUNDS,
  BELL_TONES,
  NEW_TASK_STATUSES,
  PREFERENCE_DEFAULTS,
  SUBMIT_BUTTONS,
  THEMES,
} from '@/modules/preferences/schemas';
import { getFor } from '@/modules/preferences/service';

// No stored row for anyone, and the Notifications card drawn with the defaults (its save, desktop
// push and Play sound stand-ins do nothing).
vi.mock('@/modules/preferences/repo', () => ({ findPrefs: async () => null }));
vi.mock('@/app/(app)/my-settings/PreferencesProvider', async () => {
  const { PREFERENCE_DEFAULTS: values } = await import('@/modules/preferences/schemas');
  return { usePreferences: () => ({ values, change() {} }) };
});
vi.mock('@/components/PushSwitch', () => ({
  default: () => null,
  useDesktopPush: () => ({ state: 'unsupported' }),
}));
vi.mock('@/app/(app)/my-settings/PlaySoundButton', () => ({
  default: () => null,
  usePlaySound: () => () => {},
}));

const ids = (who) => sectionsFor(who).map((section) => section.id);

describe('My settings sections (CONTRACT 21)', () => {
  it('lists Daily report, AI, Notifications and Appearance in that order', () => {
    expect(SECTIONS.map((section) => section.label)).toEqual([
      'Daily report',
      'AI',
      'Notifications',
      'Appearance',
    ]);
    expect(ids({ writesReports: true, polishAvailable: true })).toEqual([
      'report',
      'ai',
      'notifications',
      'appearance',
    ]);
  });

  it('leaves out AI while the company has no polish', () => {
    expect(ids({ writesReports: true, polishAvailable: false })).toEqual([
      'report',
      'notifications',
      'appearance',
    ]);
  });

  it('gives people without a report (PMs) only Notifications and Appearance', () => {
    expect(ids({ writesReports: false, polishAvailable: true })).toEqual([
      'notifications',
      'appearance',
    ]);
    expect(ids({ writesReports: false, polishAvailable: false })).toEqual([
      'notifications',
      'appearance',
    ]);
  });

  it("counts whoever has a report, except an Admin who doesn't track attendance", () => {
    const person = (role, tracksAttendance, status = 'active') => ({
      role,
      tracksAttendance,
      status,
    });
    expect(writesReports(person('employee', true))).toBe(true);
    expect(writesReports(person('hr', true))).toBe(true);
    expect(writesReports(person('admin', true))).toBe(true);
    // The CEO: no Today or My log in the sidebar, so no Daily report or AI settings either.
    expect(writesReports(person('admin', false))).toBe(false);
    expect(writesReports(person('pm', false))).toBe(false);
    expect(writesReports(person('employee', true, 'deactivated'))).toBe(false);
  });

  it('offers exactly the values the preferences accept, with the contract labels', () => {
    expect(SUBMIT_BUTTON_CHOICES.map((choice) => choice.value)).toEqual([...SUBMIT_BUTTONS]);
    expect(SUBMIT_BUTTON_CHOICES.map((choice) => choice.label)).toEqual([
      'Both',
      'Submit and check out',
      'Submit report',
    ]);
    expect(NEW_TASK_CHOICES.map((choice) => choice.value)).toEqual([...NEW_TASK_STATUSES]);
    expect(NEW_TASK_CHOICES.map((choice) => choice.label)).toEqual(['In progress', 'Done']);
    expect(THEME_CHOICES.map((choice) => choice.value)).toEqual([...THEMES]);
    expect(THEME_CHOICES.map((choice) => choice.label)).toEqual([
      'Match my computer',
      'Light',
      'Dark',
    ]);
  });

  it('offers the bell sounds and the four tones with the contract labels (CONTRACT 26)', () => {
    // All first, as the default (CONTRACT 28); the stored values are BELL_SOUNDS', unchanged.
    expect(SOUND_CHOICES.map((choice) => choice.value)).toEqual(['all', 'important', 'off']);
    expect(SOUND_CHOICES.map((choice) => choice.value).sort()).toEqual([...BELL_SOUNDS].sort());
    expect(SOUND_CHOICES.map((choice) => choice.label)).toEqual(['All', 'Important only', 'Off']);
    expect(SOUND_CHOICES[0].value).toBe(PREFERENCE_DEFAULTS.bellSound);
    expect(BELL_SOUNDS).toEqual(['important', 'all', 'off']);
    expect(TONE_CHOICES.map((choice) => choice.value)).toEqual([...BELL_TONES]);
    // The page plays the picked value through playChimeNow(), so each must be a sound chime.js has.
    expect(TONE_CHOICES.map((choice) => choice.value)).toEqual([...TONE_NAMES]);
    expect(TONE_CHOICES.map((choice) => choice.label)).toEqual([
      'Chime',
      'Soft bell',
      'Ding',
      'Pop',
    ]);
  });
});

describe('the default Sound is All (CONTRACT 28)', () => {
  const newTask = {
    id: 41,
    type: 'project_task.added',
    title: 'Neha Kapoor gave you a task on Acme store: Write the FAQ',
    readAt: null,
  };
  const chime = (choice) =>
    shouldChime({
      choice,
      batch: { items: [newTask] },
      osSound: new Set(),
      gapMs: 30_000,
      tabId: 'a',
      soundTabId: 'a',
      frontTabId: 'a',
      push: { active: false, apple: false },
    });

  it('chimes for a new task for someone with no stored row', async () => {
    const { bellSound } = await getFor(7);
    expect(bellSound).toBe('all');
    expect(chime(bellSound)).toBe('play');
    // A normal type: Important only (now a choice, no longer the default) still skips it.
    expect(chime('important')).toBe('not_important');
  });

  it('falls back to All in the browser for a missing or unknown choice, also outside the app', () => {
    const Probe = () => useBellSound();
    const soundFor = (prefs) =>
      renderToStaticMarkup(createElement(UserPrefsProvider, { prefs }, createElement(Probe)));
    expect(renderToStaticMarkup(createElement(Probe))).toBe('all');
    expect(soundFor(null)).toBe('all');
    expect(soundFor({ theme: 'dark' })).toBe('all');
    expect(soundFor({ bellSound: 'loud' })).toBe('all');
    expect(soundFor({ bellSound: 'all' })).toBe('all');
    expect(soundFor({ bellSound: 'important' })).toBe('important');
    expect(soundFor({ bellSound: 'off' })).toBe('off');
  });

  it('shows All pressed first in the Notifications card, with the new help line', () => {
    const html = renderToStaticMarkup(
      createElement(MySettingsSections, { sections: ['notifications'], push: null }),
    );
    const sound = html.slice(html.indexOf('>Sound</p>'), html.indexOf('>Choose a sound</p>'));
    expect(sound).toContain(
      'A short sound for every new notification while Daybook is open. Important only plays it just for reminders and requests that ask you to act.',
    );
    const buttons = [...sound.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]+)</g)];
    expect(buttons.map(([, pressed, label]) => [label, pressed])).toEqual([
      ['All', 'true'],
      ['Important only', 'false'],
      ['Off', 'false'],
    ]);
  });
});

/** A send() whose answers the test hands out one at a time. */
function controlledSend() {
  const calls = [];
  const send = (key, value) =>
    new Promise((resolve, reject) => calls.push({ key, value, resolve, reject }));
  return { calls, send };
}

/** Lets the saver's queued promises run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function track(options) {
  const events = { status: [], reverts: [], errors: [], drained: 0 };
  const saver = createPreferenceSaver({
    initial: { carryOver: true, theme: 'system' },
    onStatus: (status) => events.status.push(status),
    onRevert: (key, value) => events.reverts.push([key, value]),
    onError: (error, key) => events.errors.push([key, error.message]),
    onDrained: () => {
      events.drained += 1;
    },
    ...options,
  });
  return { saver, events };
}

describe('saving My settings one change at a time', () => {
  it('says Saving… then Saved, and refreshes once the queue is empty', async () => {
    const { calls, send } = controlledSend();
    const { saver, events } = track({ send });
    saver.change('carryOver', false);
    expect(events.status).toEqual(['saving']);
    await flush();
    calls[0].resolve({ carryOver: false, theme: 'system' });
    await flush();
    expect(events.status).toEqual(['saving', 'saved']);
    expect(events.reverts).toEqual([]);
    expect(events.drained).toBe(1);
    expect(saver.saved()).toEqual({ carryOver: false, theme: 'system' });
  });

  it('sends changes in the order they were made, the next only after the last answered', async () => {
    const { calls, send } = controlledSend();
    const { saver, events } = track({ send });
    saver.change('theme', 'dark');
    saver.change('carryOver', false);
    await flush();
    expect(calls.map((call) => call.key)).toEqual(['theme']);
    calls[0].resolve({ theme: 'dark' });
    await flush();
    expect(calls.map((call) => call.key)).toEqual(['theme', 'carryOver']);
    expect(events.status).toEqual(['saving', 'saving']);
    calls[1].resolve({ carryOver: false });
    await flush();
    expect(events.status.at(-1)).toBe('saved');
    expect(events.drained).toBe(1);
  });

  it('puts a failed change back to the saved value and reports the error', async () => {
    const { calls, send } = controlledSend();
    const { saver, events } = track({ send });
    saver.change('theme', 'dark');
    await flush();
    calls[0].reject(new Error('My settings are not ready yet.'));
    await flush();
    expect(events.reverts).toEqual([['theme', 'system']]);
    expect(events.errors).toEqual([['theme', 'My settings are not ready yet.']]);
    expect(events.status.at(-1)).toBe('idle');
    expect(events.drained).toBe(0);
  });

  it('leaves a failed change alone when a newer one for that key is on its way', async () => {
    const { calls, send } = controlledSend();
    const { saver, events } = track({ send });
    saver.change('theme', 'dark');
    saver.change('theme', 'light');
    await flush();
    calls[0].reject(new Error('Busy'));
    await flush();
    expect(events.reverts).toEqual([]);
    calls[1].resolve({ theme: 'light' });
    await flush();
    expect(events.reverts).toEqual([]);
    expect(saver.saved().theme).toBe('light');
    expect(events.status.at(-1)).toBe('saved');
  });

  it('reverts the newest failed change to what the server last confirmed', async () => {
    const { calls, send } = controlledSend();
    const { saver, events } = track({ send });
    saver.change('theme', 'dark');
    saver.change('theme', 'light');
    await flush();
    calls[0].resolve({ theme: 'dark' });
    await flush();
    calls[1].reject(new Error('Busy'));
    await flush();
    expect(events.reverts).toEqual([['theme', 'dark']]);
    // Something was saved before the failure, so the shell still refreshes.
    expect(events.drained).toBe(1);
  });

  it('keeps going after a callback throws', async () => {
    const { calls, send } = controlledSend();
    const { saver } = track({
      send,
      onDrained: () => {
        throw new Error('refresh failed');
      },
    });
    const first = saver.change('carryOver', false);
    await flush();
    calls[0].resolve({ carryOver: false });
    await expect(first).rejects.toThrow('refresh failed');
    saver.change('theme', 'dark');
    await flush();
    expect(calls.map((call) => call.key)).toEqual(['carryOver', 'theme']);
  });
});
