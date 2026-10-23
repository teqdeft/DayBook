// Timer time to the minute on the Daily report (company request: "8h 30m", exact minutes), the
// edge cases rounding used to hide: a misclick timer of a minute or two on "Fill report from
// timers", and required-mode hours that follow a running timer every minute without saving the
// draft every minute (a second open copy of the report would be refused as stale each time).
import { describe, expect, it } from 'vitest';
import { submitProblems } from '@/modules/reports/submit';
import { timerProblems } from '@/modules/reports/timerCheck';
import { entriesFromView, serialize } from '@/app/(app)/report/reportState';
import {
  FOLLOW_SAVE_MS,
  followSaves,
  followTimerHours,
  mergeTimerSummary,
  TIMER_TOLERANCE_MINUTES,
} from '@/app/(app)/report/reportTimers';

const MINUTE = 60_000;

/** A summary project; roundedMinutes is the whole-minute total. */
function project(projectId, roundedMinutes, notes = []) {
  return {
    projectId,
    projectName: `project-${projectId}`,
    projectColor: 'green',
    isUrgent: false,
    minutes: roundedMinutes,
    roundedMinutes,
    tasks: notes.map((note) => ({ note, projectTaskId: null, priority: null })),
  };
}

/** A saved draft with one card on project 7 at these minutes. */
function draft(minutes) {
  return entriesFromView({
    entries: [
      {
        id: 1,
        projectId: 7,
        projectName: 'acme',
        minutes,
        tasks: [{ id: 11, title: 'Login page', status: 'in_progress' }],
      },
    ],
  });
}

describe('Fill report from timers and a misclick timer', () => {
  it('adds no card for a project timed for the tolerance or less, so the submit goes through', () => {
    const summary = {
      projects: [
        project(7, 125, ['Login page']),
        project(8, TIMER_TOLERANCE_MINUTES),
        project(9, 1, ['Clicked by mistake']),
      ],
    };
    const next = mergeTimerSummary(entriesFromView({ entries: [] }), summary);
    expect(next.map((entry) => [entry.projectId, entry.hours])).toEqual([[7, '2h 5m']]);
    const body = serialize(next).body;
    expect(submitProblems(body)).toBeNull();
    // Required mode doesn't ask for them either.
    expect(timerProblems(body, summary)).toEqual({});
  });

  it('still adds a project timed for longer, and still fills a card the report has', () => {
    const summary = { projects: [project(7, 1), project(8, TIMER_TOLERANCE_MINUTES + 1)] };
    const next = mergeTimerSummary(draft(0), summary);
    expect(next.map((entry) => [entry.projectId, entry.hours])).toEqual([
      [7, '1m'],
      [8, '3m'],
    ]);
  });
});

describe('required mode: hours that follow a running timer', () => {
  it('saves the first follow, then once per FOLLOW_SAVE_MS', () => {
    expect(followSaves(null, 0)).toBe(true);
    expect(followSaves(0, FOLLOW_SAVE_MS - 1)).toBe(false);
    expect(followSaves(0, FOLLOW_SAVE_MS)).toBe(true);
  });

  it('shows every minute exactly but saves the draft once in 15 minutes, not every minute', () => {
    let rows = draft(125);
    let state = { lastAt: null, unsaved: false };
    const shown = [];
    let saves = 0;
    // The page reads the timers every minute (useTimerFill); minute 0 is the page load.
    for (let minute = 0; minute <= 15; minute += 1) {
      const at = minute * MINUTE;
      const save = followSaves(state.lastAt, at);
      const summary = { projects: [project(7, 125 + minute)] };
      const next = followTimerHours(rows, summary, { save, unsaved: state.unsaved });
      if (save && next.rows !== rows) saves += 1;
      state = { lastAt: save ? at : state.lastAt, unsaved: next.unsaved };
      rows = next.rows;
      shown.push(rows[0].hours);
    }
    expect(shown[1]).toBe('2h 6m');
    expect(shown[14]).toBe('2h 19m');
    // Minute 0 matched the saved draft; 1-14 only show; 15 saves.
    expect(saves).toBe(1);
    expect(state).toEqual({ lastAt: 15 * MINUTE, unsaved: false });
  });

  it('a 1-minute tick between saves changes what is shown, not what is saved', () => {
    const rows = draft(125);
    const tick = followTimerHours(
      rows,
      { projects: [project(7, 126)] },
      { save: false, unsaved: false },
    );
    expect(tick.rows[0]).toMatchObject({ hours: '2h 6m', savedMinutes: 126 });
    expect(tick.unsaved).toBe(true);
  });

  it('saves hours shown earlier once it may, even when the timer has stopped since', () => {
    const rows = draft(130);
    const summary = { projects: [project(7, 130)] };
    // Nothing moved and nothing waits: the same rows (no save).
    expect(followTimerHours(rows, summary, { save: true, unsaved: false }).rows).toBe(rows);
    // Hours shown without a save: a new array, so the provider saves them.
    const late = followTimerHours(rows, summary, { save: true, unsaved: true });
    expect(late.rows).not.toBe(rows);
    expect(late.rows).toEqual(rows);
    expect(late.unsaved).toBe(false);
    // Between saves nothing is sent and they stay waiting.
    expect(followTimerHours(rows, summary, { save: false, unsaved: true })).toEqual({
      rows,
      unsaved: true,
    });
  });
});
