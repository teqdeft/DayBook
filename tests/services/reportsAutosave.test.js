// The report page's browser-side pieces that decide what is saved and when: the autosave loop
// (build guide 7.4.4: one second after the last change) and the row helpers in reportState.js.
// Both are plain modules, so they run here without a browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave, RETRY_DELAY_MS, SAVE_DELAY_MS } from '@/app/(app)/report/autosave';
import {
  entryMinutes,
  firstHoursError,
  parseHours,
  TIME_FORMAT_ERROR,
  totalMinutes,
} from '@/app/(app)/report/reportHours';
import { applySavedIds, mapFieldErrors, newEntry, serialize } from '@/app/(app)/report/reportState';

/** A save the test resolves by hand, to hold a request "in flight". */
function deferredSaves() {
  const calls = [];
  const save = vi.fn(
    () =>
      new Promise((resolve) => {
        calls.push(resolve);
      }),
  );
  return { save, calls };
}

function setup(save) {
  const statuses = [];
  const autosave = createAutosave({ save, onStatus: (status) => statuses.push(status) });
  return { autosave, statuses };
}

/** Lets resolved promises run their callbacks. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('autosave loop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves once, one second after the last change', async () => {
    const save = vi.fn(async () => 'saved');
    const { autosave, statuses } = setup(save);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(600);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['waiting', 'waiting', 'saving', 'saved']);
    expect(autosave.hasPending()).toBe(false);
  });

  it('sends one request at a time; changes made meanwhile go in the next one', async () => {
    const { save, calls } = deferredSaves();
    const { autosave, statuses } = setup(save);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.isSaving()).toBe(true);

    // A change while the save runs keeps "saving" and waits for its own second.
    autosave.changed();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    calls[0]('saved');
    await flush();
    // The timer fired during the first save, so the next save starts right after it.
    expect(save).toHaveBeenCalledTimes(2);
    calls[1]('saved');
    await flush();
    expect(statuses).toEqual(['waiting', 'saving', 'waiting', 'saving', 'saved']);
    expect(autosave.isSaving()).toBe(false);
  });

  it('tries again every five seconds while offline', async () => {
    const outcomes = ['offline', 'offline', 'saved'];
    const save = vi.fn(async () => outcomes.shift());
    const { autosave, statuses } = setup(save);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(statuses.at(-1)).toBe('offline');
    expect(autosave.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe('saved');
    expect(autosave.hasPending()).toBe(false);
  });

  it('after a refused save, waits for the next change', async () => {
    const outcomes = ['failed', 'saved'];
    const save = vi.fn(async () => outcomes.shift());
    const { autosave, statuses } = setup(save);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(statuses.at(-1)).toBe('failed');
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe('saved');
  });

  it('stops for good when the report locked or changed elsewhere', async () => {
    const save = vi.fn(async () => 'stopped');
    const { autosave } = setup(save);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await autosave.saveNow()).toBe(false);
    expect(autosave.takePending()).toBe(false);
  });

  it('lets submit wait for a running save, and hands waiting changes to the leave save once', async () => {
    const { save, calls } = deferredSaves();
    const { autosave } = setup(save);
    autosave.changed();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    let idle = false;
    autosave.idle().then(() => {
      idle = true;
    });
    await flush();
    expect(idle).toBe(false);
    calls[0]('saved');
    await flush();
    expect(idle).toBe(true);

    autosave.changed();
    expect(autosave.takePending()).toBe(true);
    expect(autosave.takePending()).toBe(false);
    // The keepalive save took the changes: the timer no longer fires.
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('pause keeps changes unsaved for the submit; markSaved clears them', async () => {
    const save = vi.fn(async () => 'saved');
    const { autosave } = setup(save);
    autosave.changed();
    autosave.pause();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.hasPending()).toBe(true);
    autosave.markSaved();
    expect(autosave.hasPending()).toBe(false);
  });
});

describe('report rows', () => {
  function entry(hours, savedMinutes = 0) {
    return {
      ...newEntry({ projectId: 5, name: 'internal-tool' }),
      id: 1,
      hours,
      savedMinutes,
      tasks: [{ key: 't-a', id: 9, title: 'Backend', status: 'done' }],
    };
  }

  it('reads hours as typed, to the minute', () => {
    expect(parseHours('1,5')).toEqual({ minutes: 90 });
    expect(parseHours('')).toEqual({ minutes: 0 });
    expect(parseHours('7.75')).toEqual({ minutes: 465 });
    expect(parseHours('2h 5m')).toEqual({ minutes: 125 });
    // "7.30" may mean 7h 30m: refused rather than read as 7.3 hours (7h 18m).
    expect(parseHours('7.30')).toEqual({ error: TIME_FORMAT_ERROR });
    expect(parseHours('25')).toEqual({ error: 'Hours must be 24 or less.' });
    expect(parseHours('abc')).toEqual({ error: TIME_FORMAT_ERROR });
  });

  it('sends the time shown on screen, never an older value', () => {
    expect(serialize([entry('2h 30m', 120)]).body[0].minutes).toBe(150);
    expect(serialize([entry('7:18', 420)]).body[0].minutes).toBe(438);
    // A wrong value goes as typed, so the server refuses it under that field.
    expect(serialize([entry('7h 75m', 420)]).body[0].hours).toBe('7h 75m');
    expect(serialize([entry('7.3', 420)]).body[0].hours).toBe('7.3');
    expect(serialize([entry(' 25 ', 420)]).body[0].hours).toBe('25');
    // Only the save on leaving the page keeps the last valid value, to save everything else.
    expect(serialize([entry('7h 75m', 420)], { keepLastValid: true }).body[0].minutes).toBe(420);
  });

  it('finds the first wrong hours field; totals use the last valid value', () => {
    const rows = [entry('2h', 120), entry('7h 75m', 420)];
    expect(firstHoursError(rows)).toEqual({ entryKey: rows[1].key, message: TIME_FORMAT_ERROR });
    expect(firstHoursError([entry('2h 5m', 125)])).toBeNull();
    expect(entryMinutes(rows[1])).toBe(420);
    expect(totalMinutes(rows)).toBe(540);
    expect(totalMinutes([entry('2h 5m'), entry('6.5')])).toBe(515);
  });

  it('copies new ids from the saved report onto the rows that were sent', () => {
    const added = newEntry({ projectId: 6, name: 'iwilltillimwell' });
    added.tasks[0].title = 'Copy';
    const rows = [entry('2h', 120), added];
    const { keys } = serialize(rows);
    const view = {
      entries: [
        { id: 1, tasks: [{ id: 9 }] },
        { id: 2, tasks: [{ id: 10 }] },
      ],
    };
    const next = applySavedIds(rows, keys, view);
    expect(next[1].id).toBe(2);
    expect(next[1].tasks[0]).toMatchObject({ id: 10, title: 'Copy' });
    expect(next[0]).toBe(rows[0]);
    // Nothing new: the same array comes back.
    expect(applySavedIds(next, keys, view)).toBe(next);
  });

  it('puts the API field errors on the rows that were sent', () => {
    const rows = [entry('2h', 120)];
    const { keys } = serialize(rows);
    const errors = mapFieldErrors(
      {
        'entries.0.hours': 'Hours must be above 0.',
        'entries.0.tasks.0.title': 'Write at least 2 characters.',
        total: 'A day can have at most 16 hours.',
      },
      keys,
    );
    expect(errors.entries[rows[0].key]).toEqual({ hours: 'Hours must be above 0.' });
    expect(errors.tasks['t-a']).toBe('Write at least 2 characters.');
    expect(errors.general).toEqual(['A day can have at most 16 hours.']);
  });
});
