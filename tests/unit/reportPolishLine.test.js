// "Polish on each task line" (CONTRACT 21, reportLinePolish.js and reportPolish.polishLineFor):
// the line a sparkle sends, each line's state (waiting, then a suggestion or a toast), the rules
// that drop a stale suggestion, and Use (the title only, only while the line still says what was
// sent). Lines are independent: several may wait at once.
import { describe, expect, it } from 'vitest';
import {
  NO_LINE_POLISH,
  dropLineSuggestion,
  findTask,
  isLineBusy,
  removeLinePolish,
  settleLinePolish,
  startLinePolish,
  suggestionToApply,
  visibleLinePolish,
} from '@/app/(app)/report/reportLinePolish';
import {
  applySuggestions,
  canPolish,
  changedSuggestions,
  polishLineFor,
  polishRequest,
} from '@/app/(app)/report/reportPolish';

const task = (key, title, extra = {}) => ({
  key,
  id: null,
  title,
  status: 'in_progress',
  carried: false,
  projectTaskId: null,
  priority: null,
  projectTaskTitle: null,
  ...extra,
});

const entry = (key, projectName, tasks) => ({
  key,
  id: null,
  projectId: 1,
  projectRequestId: null,
  projectName,
  projectColor: 'violet',
  isUrgent: false,
  waitingForApproval: false,
  hours: '2h',
  savedMinutes: 120,
  tasks,
});

const ROWS = [
  entry('e1', 'acme-app', [
    task('t1', ' fixed bug login pg ', { status: 'done' }),
    task('t2', 'P1 hero', { projectTaskId: 7, priority: 'p1', projectTaskTitle: 'Hero' }),
    task('t3', '   '),
  ]),
  entry('e2', 'internal-tool', [task('t4', 'x'.repeat(501))]),
];

/** The rows with one line's title changed (as typing does). */
const typed = (rows, key, title) =>
  rows.map((row) => ({
    ...row,
    tasks: row.tasks.map((item) => (item.key === key ? { ...item, title } : item)),
  }));

const press = (lines, rows, key, id) => {
  const line = polishLineFor(rows, key);
  return startLinePolish(lines, { key, id, raw: findTask(rows, key).title, sent: line.title });
};

describe('polishLineFor', () => {
  it('sends one written line, trimmed, with its project', () => {
    const line = polishLineFor(ROWS, 't1');
    expect(line).toEqual({
      key: 't1',
      title: 'fixed bug login pg',
      projectName: 'acme-app',
      projectColor: 'violet',
    });
    expect(polishRequest([line])).toEqual({
      lines: [{ key: 't1', title: 'fixed bug login pg', projectName: 'acme-app' }],
    });
  });

  it('nothing for an empty or too long line, or one that is gone', () => {
    expect(polishLineFor(ROWS, 't3')).toBeNull();
    expect(polishLineFor(ROWS, 't4')).toBeNull();
    expect(polishLineFor(ROWS, 'nope')).toBeNull();
    expect(canPolish({ title: 'x'.repeat(500) })).toBe(true);
    expect(canPolish({ title: ' ' })).toBe(false);
  });
});

describe('a press', () => {
  it('makes the line wait; presses while it waits are ignored', () => {
    const busy = press(NO_LINE_POLISH, ROWS, 't1', 1);
    expect(busy.t1).toEqual({
      phase: 'busy',
      id: 1,
      raw: ' fixed bug login pg ',
      sent: 'fixed bug login pg',
    });
    expect(isLineBusy(busy, 't1')).toBe(true);
    expect(press(busy, ROWS, 't1', 2)).toBe(busy);
  });

  it('lets other lines wait at the same time', () => {
    const both = press(press(NO_LINE_POLISH, ROWS, 't1', 1), ROWS, 't2', 2);
    expect(Object.keys(both)).toEqual(['t1', 't2']);
    const { lines } = settleLinePolish(both, {
      key: 't2',
      id: 2,
      task: findTask(ROWS, 't2'),
      enabled: true,
      suggestion: { after: 'Built the hero' },
    });
    expect(lines.t1.phase).toBe('busy');
    expect(lines.t2).toMatchObject({ phase: 'suggest', after: 'Built the hero' });
  });

  it('asks again for a line that shows a suggestion', () => {
    const shown = { t1: { phase: 'suggest', id: 1, raw: 'a', sent: 'a', after: 'A' } };
    expect(press(shown, ROWS, 't1', 2).t1).toMatchObject({ phase: 'busy', id: 2 });
  });
});

describe('the answer', () => {
  const busy = press(NO_LINE_POLISH, ROWS, 't1', 1);
  const settle = (rows, extra) =>
    settleLinePolish(busy, {
      key: 't1',
      id: 1,
      task: findTask(rows, 't1'),
      enabled: true,
      ...extra,
    });
  const line = polishLineFor(ROWS, 't1');

  it('a changed line shows as a suggestion', () => {
    const [suggestion] = changedSuggestions([line], [{ key: 't1', title: 'Fixed the login bug' }]);
    const result = settle(ROWS, { suggestion });
    expect(result.outcome).toBe('suggest');
    expect(result.lines.t1).toEqual({
      phase: 'suggest',
      id: 1,
      raw: ' fixed bug login pg ',
      sent: 'fixed bug login pg',
      after: 'Fixed the login bug',
    });
  });

  it('an unchanged line or an empty answer: the toast, no suggestion', () => {
    for (const answer of [[{ key: 't1', title: 'fixed bug login pg' }], [], undefined]) {
      const suggestion = changedSuggestions([line], answer)[0] ?? null;
      const result = settle(ROWS, { suggestion });
      expect(result).toEqual({ lines: NO_LINE_POLISH, outcome: 'unchanged' });
    }
  });

  it('an error: the toast, also when the line was typed in meanwhile', () => {
    const error = new Error('Gemini is busy. Try again in a minute.');
    expect(settle(ROWS, { error })).toEqual({ lines: NO_LINE_POLISH, outcome: 'error' });
    const edited = typed(ROWS, 't1', 'fixed bug login page');
    expect(settle(edited, { error }).outcome).toBe('error');
  });

  it('is dropped quietly when the line changed, went, or the report stopped being editable', () => {
    const suggestion = { after: 'Fixed the login bug' };
    const edited = typed(ROWS, 't1', 'fixed bug login page');
    expect(settle(edited, { suggestion })).toEqual({ lines: NO_LINE_POLISH, outcome: 'stale' });
    const removed = [{ ...ROWS[0], tasks: ROWS[0].tasks.slice(1) }];
    expect(settle(removed, { suggestion }).outcome).toBe('stale');
    expect(settle(ROWS, { suggestion, enabled: false }).outcome).toBe('stale');
    expect(settle(ROWS, { error: new Error('x'), enabled: false }).outcome).toBe('stale');
  });

  it('counts only for the request the line waits for', () => {
    const other = settleLinePolish(busy, {
      key: 't1',
      id: 9,
      task: findTask(ROWS, 't1'),
      enabled: true,
      suggestion: { after: 'Old answer' },
    });
    expect(other).toEqual({ lines: busy, outcome: 'gone' });
    const kept = removeLinePolish(busy, 't1');
    expect(kept).toBe(NO_LINE_POLISH);
    expect(settleLinePolish(kept, { key: 't1', id: 1, enabled: true }).outcome).toBe('gone');
  });
});

describe('what shows', () => {
  const suggesting = {
    t1: {
      phase: 'suggest',
      id: 1,
      raw: ' fixed bug login pg ',
      sent: 'fixed bug login pg',
      after: 'Fixed the login bug',
    },
    t2: { phase: 'busy', id: 2, raw: 'P1 hero', sent: 'P1 hero' },
  };

  it('everything while the line still says what was sent', () => {
    expect(visibleLinePolish(suggesting, ROWS, true)).toBe(suggesting);
    expect(visibleLinePolish(NO_LINE_POLISH, ROWS, true)).toBe(NO_LINE_POLISH);
  });

  it('nothing while line polish is off or the report is read-only', () => {
    expect(visibleLinePolish(suggesting, ROWS, false)).toBe(NO_LINE_POLISH);
  });

  it('typing hides a suggestion; a line still waiting keeps its spinner', () => {
    const rows = typed(typed(ROWS, 't1', 'fixed bug'), 't2', 'P1 hero banner');
    expect(visibleLinePolish(suggesting, rows, true)).toEqual({ t2: suggesting.t2 });
  });

  it('a removed line shows nothing', () => {
    const rows = [{ ...ROWS[0], tasks: [ROWS[0].tasks[1]] }];
    expect(visibleLinePolish(suggesting, rows, true)).toEqual({ t2: suggesting.t2 });
  });

  it('typing drops the suggestion for good, not a request on its way', () => {
    expect(dropLineSuggestion(suggesting, 't1')).toEqual({ t2: suggesting.t2 });
    expect(dropLineSuggestion(suggesting, 't2')).toBe(suggesting);
    expect(dropLineSuggestion(suggesting, 'nope')).toBe(suggesting);
  });
});

describe('Use', () => {
  const shown = {
    phase: 'suggest',
    id: 1,
    raw: ' fixed bug login pg ',
    sent: 'fixed bug login pg',
    after: 'Fixed the login bug',
  };

  it('changes the title only', () => {
    const { rows, applied } = applySuggestions(ROWS, [suggestionToApply('t1', shown)]);
    expect(applied).toBe(1);
    expect(rows[0].tasks[0]).toEqual({ ...ROWS[0].tasks[0], title: 'Fixed the login bug' });
    expect(rows[0].tasks[1]).toBe(ROWS[0].tasks[1]);
    expect(rows[1]).toBe(ROWS[1]);
  });

  it('keeps a priority link and the status', () => {
    const linked = { ...shown, raw: 'P1 hero', sent: 'P1 hero', after: 'Built the hero banner' };
    const { rows } = applySuggestions(ROWS, [suggestionToApply('t2', linked)]);
    expect(rows[0].tasks[1]).toMatchObject({
      title: 'Built the hero banner',
      status: 'in_progress',
      projectTaskId: 7,
      priority: 'p1',
      projectTaskTitle: 'Hero',
    });
  });

  it('only while the line still says what was sent', () => {
    const edited = typed(ROWS, 't1', 'fixed bug login page');
    expect(applySuggestions(edited, [suggestionToApply('t1', shown)])).toEqual({
      rows: edited,
      applied: 0,
    });
    // Spaces around the text don't count as a change.
    const spaced = typed(ROWS, 't1', 'fixed bug login pg');
    expect(applySuggestions(spaced, [suggestionToApply('t1', shown)]).applied).toBe(1);
  });
});
