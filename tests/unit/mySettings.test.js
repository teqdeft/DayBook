import { describe, expect, it } from 'vitest';
import {
  NEW_TASK_CHOICES,
  SECTIONS,
  sectionsFor,
  SUBMIT_BUTTON_CHOICES,
  THEME_CHOICES,
  writesReports,
} from '@/app/(app)/my-settings/sections';
import { createPreferenceSaver } from '@/app/(app)/my-settings/preferenceSaver';
import { NEW_TASK_STATUSES, SUBMIT_BUTTONS, THEMES } from '@/modules/preferences/schemas';

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
