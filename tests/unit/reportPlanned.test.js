// Planned projects and the submit rules on their own (CONTRACT 24 company rule, planned.js,
// submitProblems and timerProblems): a 0-minute project with no Done line may ride along with a
// worked one, a Done line at 0 hours still needs hours, an empty 0-hour card is dropped, and
// required timer mode doesn't ask a planned project for timer time.
import { describe, expect, it } from 'vitest';
import { isEmptyEntry, isPlannedEntry, writtenTasks } from '@/modules/reports/planned';
import { submitProblems } from '@/modules/reports/submit';
import { timerProblems } from '@/modules/reports/timerCheck';

const NO_TIMER_TIME = 'No timer time on this project today. Remove it or add time on Today.';
const task = (title, status = 'in_progress') => ({ title, status });
const entry = (projectId, minutes, tasks) => ({ projectId, minutes, tasks });

describe('isPlannedEntry and isEmptyEntry', () => {
  it('a planned project has 0 minutes and no Done line with text', () => {
    expect(isPlannedEntry(entry(1, 0, [task('Plan'), task('Wait', 'blocked')]))).toBe(true);
    expect(isPlannedEntry(entry(1, 0, [task('  ', 'done'), task('Plan')]))).toBe(true);
    expect(isPlannedEntry(entry(1, 0, [task('Shipped', 'done')]))).toBe(false);
    expect(isPlannedEntry(entry(1, 15, [task('Plan')]))).toBe(false);
    expect(isPlannedEntry({ projectId: 1, minutes: 0 })).toBe(true);
  });

  it('an empty card has 0 minutes and nothing written', () => {
    expect(isEmptyEntry(entry(1, 0, []))).toBe(true);
    expect(isEmptyEntry(entry(1, 0, [task(' ')]))).toBe(true);
    expect(isEmptyEntry(entry(1, 0, [task('Plan')]))).toBe(false);
    expect(isEmptyEntry(entry(1, 30, []))).toBe(false);
    expect(writtenTasks(entry(1, 0, [task(''), task('A task')]))).toEqual([task('A task')]);
  });
});

describe('submitProblems with planned projects', () => {
  it('lets a planned project go with a worked one', () => {
    expect(submitProblems([entry(1, 60, [task('Worked')]), entry(2, 0, [task('Plan')])])).toBe(
      null,
    );
  });

  it('still asks for hours on a Done line, and when nothing was worked', () => {
    expect(
      submitProblems([entry(1, 60, [task('Worked')]), entry(2, 0, [task('Shipped', 'done')])])
        .fields,
    ).toEqual({ 'entries.1.hours': 'Hours must be above 0.' });
    expect(submitProblems([entry(1, 0, [task('Plan')])]).fields).toEqual({
      'entries.0.hours': 'Hours must be above 0.',
    });
  });

  it('drops an empty 0-hour card, keeping the field keys of the others', () => {
    expect(submitProblems([entry(1, 0, []), entry(2, 60, [task('Worked')])])).toBe(null);
    expect(submitProblems([entry(1, 0, [task(' ')])]).fields).toEqual({
      entries: 'Add at least one project before you submit.',
    });
    expect(submitProblems([entry(1, 0, []), entry(2, 60, [task('x')])]).fields).toEqual({
      'entries.1.tasks.0.title': 'Write at least 2 characters.',
    });
    // A dropped card doesn't count as the project being in the report twice.
    expect(submitProblems([entry(1, 0, []), entry(1, 60, [task('Worked')])])).toBe(null);
  });
});

describe('timerProblems with planned projects', () => {
  const summary = { projects: [{ projectId: 1, projectName: 'acme-app', roundedMinutes: 60 }] };

  it('skips a planned project without timer time, never a Done one', () => {
    expect(
      timerProblems([entry(1, 60, [task('A')]), entry(2, 0, [task('Plan')])], summary),
    ).toEqual({});
    expect(
      timerProblems([entry(1, 60, [task('A')]), entry(2, 0, [task('Shipped', 'done')])], summary),
    ).toEqual({ 'entries.1.hours': NO_TIMER_TIME });
  });

  it('still asks for the timer hours of a timed project left at 0', () => {
    expect(timerProblems([entry(1, 0, [task('Plan')])], summary)).toEqual({
      'entries.0.hours': 'Hours come from your timers (1h).',
    });
  });
});
