// "Polish my tasks" on the daily report (CONTRACT 20, reportPolish.js): which lines are sent, the
// lines "Fill report from timers" writes (they are polished on their own), the dialog's rows
// (changed lines only, unknown keys dropped) and applying the ticked ones (titles only, priority
// links stay, lines edited since are left alone).
import { describe, expect, it } from 'vitest';
import {
  applySuggestions,
  changedSuggestions,
  filledLines,
  MAX_POLISH_LINES,
  mayOffer,
  polishableLines,
  polishRequest,
  reportStage,
} from '@/app/(app)/report/reportPolish';
import { mergeTimerSummary } from '@/app/(app)/report/reportTimers';

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

const entry = (key, projectId, projectName, tasks) => ({
  key,
  id: null,
  projectId,
  projectRequestId: null,
  projectName,
  projectColor: 'blue',
  isUrgent: false,
  waitingForApproval: false,
  hours: '2h',
  savedMinutes: 120,
  tasks,
});

const ENTRIES = [
  entry('e1', 1, 'acme-seo', [
    task('t1', '  fixed bug login pg '),
    task('t2', ''),
    task('t3', 'P1 review homepage', {
      projectTaskId: 7,
      priority: 'p1',
      projectTaskTitle: 'Hero',
    }),
  ]),
  entry('e2', 2, 'internal-tool', [task('t4', 'x'.repeat(501)), task('t5', 'backend wrk')]),
];

describe('polishableLines', () => {
  it('sends written lines in page order, trimmed, with their project', () => {
    expect(polishableLines(ENTRIES)).toEqual([
      { key: 't1', title: 'fixed bug login pg', projectName: 'acme-seo', projectColor: 'blue' },
      { key: 't3', title: 'P1 review homepage', projectName: 'acme-seo', projectColor: 'blue' },
      { key: 't5', title: 'backend wrk', projectName: 'internal-tool', projectColor: 'blue' },
    ]);
    expect(polishableLines([])).toEqual([]);
  });

  it('sends at most 60 lines', () => {
    const many = [
      entry(
        'e9',
        9,
        'big',
        Array.from({ length: 70 }, (_, i) => task(`k${i}`, `line ${i}`)),
      ),
    ];
    const lines = polishableLines(many);
    expect(lines).toHaveLength(MAX_POLISH_LINES);
    expect(lines.at(-1).key).toBe('k59');
  });

  it('builds the request body without colours', () => {
    expect(polishRequest(polishableLines(ENTRIES).slice(0, 1))).toEqual({
      lines: [{ key: 't1', title: 'fixed bug login pg', projectName: 'acme-seo' }],
    });
  });
});

describe('filledLines', () => {
  it('lists the lines a fill wrote: new lines and the lone empty line it took', () => {
    // Fixture keys unlike the editor's own ('t1', 't2', … from newKey), which the fill uses.
    const before = [
      entry('e1', 1, 'acme-seo', [task('old1', 'login page')]),
      entry('e2', 2, 'internal-tool', [task('old2', '')]),
    ];
    const summary = {
      projects: [
        {
          projectId: 1,
          projectName: 'acme-seo',
          projectColor: 'blue',
          roundedMinutes: 90,
          tasks: [
            { note: 'Login page', projectTaskId: null, priority: null, projectTaskTitle: null },
            { note: 'meta tags', projectTaskId: null, priority: null, projectTaskTitle: null },
          ],
        },
        {
          projectId: 2,
          projectName: 'internal-tool',
          projectColor: 'teal',
          roundedMinutes: 30,
          tasks: [{ note: 'api fix', projectTaskId: null, priority: null, projectTaskTitle: null }],
        },
        {
          projectId: 3,
          projectName: 'acme-app',
          projectColor: 'violet',
          roundedMinutes: 45,
          tasks: [
            { note: 'checkout', projectTaskId: null, priority: null, projectTaskTitle: null },
          ],
        },
      ],
    };
    const after = mergeTimerSummary(before, summary);
    const written = filledLines(before, after);
    // "Login page" already had a line (any case); the rest were written by the fill.
    expect(written.map((line) => [line.title, line.projectName])).toEqual([
      ['meta tags', 'acme-seo'],
      ['api fix', 'internal-tool'],
      ['checkout', 'acme-app'],
    ]);
    // The lone empty line kept its key.
    expect(written[1].key).toBe('old2');
    expect(filledLines(after, after)).toEqual([]);
  });
});

describe('changedSuggestions', () => {
  const sent = polishableLines(ENTRIES);

  it('lists changed lines only, in the order sent, and drops unknown keys and repeats', () => {
    const rows = changedSuggestions(sent, [
      { key: 't5', title: 'Backend work' },
      { key: 't1', title: ' Fixed the login page bug ' },
      { key: 't3', title: 'P1 review homepage' },
      { key: 'zz', title: 'Something new' },
      { key: 't1', title: 'A second answer' },
    ]);
    expect(rows).toEqual([
      {
        key: 't1',
        projectName: 'acme-seo',
        projectColor: 'blue',
        before: 'fixed bug login pg',
        after: 'Fixed the login page bug',
      },
      {
        key: 't5',
        projectName: 'internal-tool',
        projectColor: 'blue',
        before: 'backend wrk',
        after: 'Backend work',
      },
    ]);
  });

  it('is empty when nothing changed or the answer is unusable', () => {
    expect(
      changedSuggestions(
        sent,
        sent.map(({ key, title }) => ({ key, title })),
      ),
    ).toEqual([]);
    expect(changedSuggestions(sent, [{ key: 't1', title: '   ' }, { key: 't5' }])).toEqual([]);
    expect(changedSuggestions(sent, undefined)).toEqual([]);
  });
});

describe('applySuggestions', () => {
  it('changes only the titles of the picked lines; status and priority links stay', () => {
    const picked = [
      { key: 't1', before: 'fixed bug login pg', after: 'Fixed the login page bug' },
      { key: 't3', before: 'P1 review homepage', after: 'Reviewed the homepage (P1)' },
    ];
    const { rows, applied } = applySuggestions(ENTRIES, picked);
    expect(applied).toBe(2);
    expect(rows[0].tasks[0]).toEqual({ ...ENTRIES[0].tasks[0], title: 'Fixed the login page bug' });
    expect(rows[0].tasks[2]).toMatchObject({
      title: 'Reviewed the homepage (P1)',
      status: 'in_progress',
      projectTaskId: 7,
      priority: 'p1',
      projectTaskTitle: 'Hero',
    });
    // Untouched rows and cards keep their identity (no needless re-render or save).
    expect(rows[0].tasks[1]).toBe(ENTRIES[0].tasks[1]);
    expect(rows[1]).toBe(ENTRIES[1]);
    expect(ENTRIES[0].tasks[0].title).toBe('  fixed bug login pg ');
  });

  it('leaves lines edited or removed since the request, and returns the same rows', () => {
    const picked = [
      { key: 't5', before: 'backend work', after: 'Backend work' },
      { key: 'gone', before: 'old line', after: 'Old line' },
    ];
    const result = applySuggestions(ENTRIES, picked);
    expect(result).toEqual({ rows: ENTRIES, applied: 0 });
    expect(result.rows).toBe(ENTRIES);
  });
});

describe('mayOffer', () => {
  const draft = reportStage({ status: 'draft', submittedAt: null });
  const submitted = reportStage({ status: 'submitted', submittedAt: '2026-10-26T13:00:00Z' });

  it('offers what the person asked for while the report can change', () => {
    const asked = { auto: false, available: true, stageAtStart: draft };
    expect(mayOffer({ ...asked, stageNow: draft })).toBe(true);
    expect(mayOffer({ ...asked, stageNow: submitted })).toBe(true);
    expect(mayOffer({ ...asked, available: false, stageNow: draft })).toBe(false);
  });

  it('drops the offer after Fill once the report was submitted while Gemini wrote', () => {
    const auto = { auto: true, available: true, stageAtStart: draft };
    expect(mayOffer({ ...auto, stageNow: draft })).toBe(true);
    expect(mayOffer({ ...auto, stageNow: submitted })).toBe(false);
    const resubmitted = reportStage({ status: 'submitted', submittedAt: '2026-10-26T14:00:00Z' });
    expect(mayOffer({ ...auto, stageAtStart: submitted, stageNow: resubmitted })).toBe(false);
    expect(reportStage(null)).toBe(':');
  });
});
