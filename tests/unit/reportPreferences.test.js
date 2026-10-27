// The person's own settings on the daily report (CONTRACT 21, reportPreferences.js): the subset
// the page passes, which submit buttons the top bar shows, the polish switches, and the status
// of task lines added by hand (lines from timers and carried lines keep theirs).
import { describe, expect, it } from 'vitest';
import {
  REPORT_PREFERENCE_DEFAULTS,
  polishGates,
  preferencesOf,
  reportPreferences,
  submitButtonsShown,
} from '@/app/(app)/report/reportPreferences';
import { entriesFromView, newEntry, newTask } from '@/app/(app)/report/reportState';
import { mergeTimerSummary } from '@/app/(app)/report/reportTimers';
import { PREFERENCE_DEFAULTS } from '@/modules/preferences/schemas';

describe('reportPreferences', () => {
  it("keeps the module's defaults for the report's keys", () => {
    for (const [key, value] of Object.entries(REPORT_PREFERENCE_DEFAULTS)) {
      expect(PREFERENCE_DEFAULTS[key]).toBe(value);
    }
    expect(reportPreferences(PREFERENCE_DEFAULTS)).toEqual(REPORT_PREFERENCE_DEFAULTS);
  });

  it('picks only the report keys', () => {
    const all = {
      ...PREFERENCE_DEFAULTS,
      submitButtons: 'checkout',
      newTaskStatus: 'done',
      slackPreview: false,
      polishButton: false,
      polishLines: false,
      polishAfterTimers: false,
      theme: 'dark',
      bellRing: false,
    };
    expect(reportPreferences(all)).toEqual({
      submitButtons: 'checkout',
      newTaskStatus: 'done',
      slackPreview: false,
      polishButton: false,
      polishLines: false,
      polishAfterTimers: false,
    });
  });

  it('keeps the default for a missing or unknown value', () => {
    expect(reportPreferences(null)).toEqual(REPORT_PREFERENCE_DEFAULTS);
    expect(
      reportPreferences({ submitButtons: 'none', newTaskStatus: 'blocked', slackPreview: 'no' }),
    ).toEqual(REPORT_PREFERENCE_DEFAULTS);
  });

  it('falls back to the defaults when the page sent none', () => {
    expect(preferencesOf({})).toBe(REPORT_PREFERENCE_DEFAULTS);
    const preferences = { ...REPORT_PREFERENCE_DEFAULTS, slackPreview: false };
    expect(preferencesOf({ preferences })).toBe(preferences);
  });
});

describe('submitButtonsShown', () => {
  const shown = (submitButtons, canCheckOut, status) =>
    submitButtonsShown({ submitButtons, canCheckOut, status });
  const both = { checkOut: true, submit: true, checkOutPrimary: false };
  const submitOnly = { checkOut: false, submit: true, checkOutPrimary: false };

  it('both: as before', () => {
    expect(shown('both', true, 'draft')).toEqual(both);
    expect(shown('both', false, 'draft')).toEqual(submitOnly);
    expect(shown('both', true, 'submitted')).toEqual(both);
  });

  it('submit: never Submit and check out', () => {
    expect(shown('submit', true, 'draft')).toEqual(submitOnly);
    expect(shown('submit', true, 'submitted')).toEqual(submitOnly);
  });

  it("checkout: hides Submit report only while Submit and check out shows (today's draft)", () => {
    // Alone in the top bar, Submit and check out is the primary button.
    expect(shown('checkout', true, 'draft')).toEqual({
      checkOut: true,
      submit: false,
      checkOutPrimary: true,
    });
    // Checked out (or another day): Submit report is the only way to send it.
    expect(shown('checkout', false, 'draft')).toEqual(submitOnly);
    // Update report never hides, and stays the primary one.
    expect(shown('checkout', true, 'submitted')).toEqual(both);
    expect(shown('checkout', false, 'submitted')).toEqual(submitOnly);
  });
});

describe('polishGates', () => {
  const on = REPORT_PREFERENCE_DEFAULTS;

  it("needs the company's AI and an editable report", () => {
    const off = { available: false, button: false, lines: false, afterTimers: false };
    expect(polishGates({ aiPolish: false, readOnly: false, preferences: on })).toEqual(off);
    expect(polishGates({ aiPolish: true, readOnly: true, preferences: on })).toEqual(off);
    expect(polishGates({ aiPolish: true, readOnly: false, preferences: on })).toEqual({
      available: true,
      button: true,
      lines: true,
      afterTimers: true,
    });
  });

  it("then each feature has the person's own switch", () => {
    const gates = (change) =>
      polishGates({ aiPolish: true, readOnly: false, preferences: { ...on, ...change } });
    expect(gates({ polishButton: false })).toMatchObject({ button: false, lines: true });
    expect(gates({ polishLines: false })).toMatchObject({ button: true, lines: false });
    expect(gates({ polishAfterTimers: false })).toMatchObject({
      available: true,
      afterTimers: false,
    });
  });
});

describe('new task status', () => {
  it('lines added by hand take the given status, anything else is In progress', () => {
    expect(newTask().status).toBe('in_progress');
    expect(newTask('done').status).toBe('done');
    expect(newTask('later').status).toBe('in_progress');
    const entry = newEntry({ projectId: 5, name: 'internal-tool' }, 'done');
    expect(entry.tasks).toHaveLength(1);
    expect(entry.tasks[0]).toMatchObject({ title: '', status: 'done', carried: false });
    expect(newEntry({ projectId: 5, name: 'internal-tool' }).tasks[0].status).toBe('in_progress');
  });

  it('lines written by Fill report from timers stay In progress', () => {
    // A card added by hand with "Done" for new tasks: its lone empty line becomes a timer line.
    const card = newEntry({ projectId: 1, name: 'acme-seo' }, 'done');
    const summary = {
      projects: [
        {
          projectId: 1,
          projectName: 'acme-seo',
          projectColor: 'blue',
          roundedMinutes: 90,
          tasks: [
            { note: 'Login page', projectTaskId: null, priority: null, projectTaskTitle: null },
            { note: 'Meta tags', projectTaskId: null, priority: null, projectTaskTitle: null },
          ],
        },
        {
          projectId: 2,
          projectName: 'internal-tool',
          projectColor: 'teal',
          roundedMinutes: 30,
          tasks: [{ note: 'Api fix', projectTaskId: null, priority: null, projectTaskTitle: null }],
        },
      ],
    };
    const rows = mergeTimerSummary([card], summary);
    expect(rows.flatMap((entry) => entry.tasks.map((task) => [task.title, task.status]))).toEqual([
      ['Login page', 'in_progress'],
      ['Meta tags', 'in_progress'],
      ['Api fix', 'in_progress'],
    ]);
    // The line kept its key (the fill took the empty line).
    expect(rows[0].tasks[0].key).toBe(card.tasks[0].key);
  });

  it('carried lines keep their status', () => {
    const view = {
      entries: [
        {
          id: 1,
          projectId: 1,
          projectName: 'acme-seo',
          minutes: 0,
          tasks: [{ id: 9, title: 'Login page', status: 'blocked', carriedFromTaskId: 4 }],
        },
      ],
    };
    expect(entriesFromView(view)[0].tasks[0]).toMatchObject({ status: 'blocked', carried: true });
  });
});
