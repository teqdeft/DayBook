// The Board tab's rules (CONTRACT 27, Board tab): the columns for a project with no phase yet, in a
// middle phase and in Support; the fold rule (a past phase with an open task stays a column, and
// folds once its last open task is done); a skipped phase; slim widths; No phase yet only when
// needed and never a drop target; the order of the cards; dimming for Critical and With files; the
// phone's steps and the switcher's matches; the band; and moving a card with its Undo
// (boardView.js, bandView.js, boardMoves.js).
import { describe, expect, it } from 'vitest';
import {
  canDropOn,
  landingIndex,
  moveBody,
  moveOf,
  moveTargets,
  movedText,
  nextCardAfter,
  pendingMoves,
  undoOf,
  withMoves,
} from '@/app/(app)/projects/[id]/_board/boardMoves';
import {
  bandParts,
  countByPhase,
  deadlineText,
  progressOf,
} from '@/app/(app)/projects/[id]/_board/bandView';
import {
  boardColumns,
  columnDates,
  filterCounts,
  filterItems,
  filterOf,
  filterStatus,
  firstStep,
  isDimmed,
  memberNote,
  phoneSteps,
  reportLine,
  switcherText,
} from '@/app/(app)/projects/[id]/_board/boardView';
import { NO_PHASE } from '@/app/(app)/projects/[id]/phasesView';
import { PHASE_KEYS, PROJECT_PHASES } from '@/modules/projectPlan/phases';

const TODAY = '2026-11-23';

const planOf = (currentPhase, dates = {}) => ({
  currentPhase,
  deadline: null,
  phases: PROJECT_PHASES.map(({ key, label }) => ({
    key,
    label,
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    ...dates[key],
  })),
});

// Requirement gathering was skipped, Design ended late, Development is current.
const DATES = {
  design: {
    plannedStart: '2026-10-07',
    plannedEnd: '2026-10-23',
    actualStart: '2026-10-07',
    actualEnd: '2026-10-28',
  },
  development: {
    plannedStart: '2026-10-26',
    plannedEnd: '2026-11-27',
    actualStart: '2026-10-28',
  },
  testing: { plannedStart: '2026-11-30', plannedEnd: '2026-12-11' },
};

const task = (id, more = {}) => ({
  id,
  title: `Task ${id}`,
  priority: 'p2',
  status: 'open',
  phase: 'development',
  dueDate: null,
  fileCount: 0,
  ...more,
});

const keys = (list) => list.map((item) => item.key);
const ids = (list) => list.map((item) => item.id);
const byKey = (columns, key) => columns.find((column) => column.key === key);

describe('the columns', () => {
  it('with no phase yet: six columns, none folded, the empty ones slim', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf(null),
      tasks: [task(1, { phase: 'requirement_gathering' })],
      today: TODAY,
    });
    expect(tiles).toEqual([]);
    expect(keys(columns)).toEqual(PHASE_KEYS);
    expect(columns.every((column) => column.status === 'later' && !column.hidden)).toBe(true);
    expect(columns.map((column) => column.width)).toEqual([
      'normal',
      'slim',
      'slim',
      'slim',
      'slim',
      'slim',
    ]);
    expect(columns.some((column) => column.tag)).toBe(false);
  });

  it('in a middle phase: past phases without open tasks fold, later empty ones are slim', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf('development', DATES),
      tasks: [task(1, { phase: 'design', status: 'done' }), task(2), task(3, { phase: 'testing' })],
      today: TODAY,
    });
    expect(keys(tiles)).toEqual(['requirement_gathering', 'design']);
    expect(byKey(columns, 'design')).toMatchObject({ folded: true, hidden: true, tag: 'done' });
    expect(byKey(columns, 'development')).toMatchObject({ tag: 'current', width: 'current' });
    expect(byKey(columns, 'testing')).toMatchObject({ width: 'normal', slim: false });
    expect(byKey(columns, 'launch')).toMatchObject({ width: 'slim', slim: true });
    expect(byKey(columns, 'support').emptyText).toBe('No tasks in Support yet.');
  });

  it('in Support: every earlier phase folds when its tasks are done', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf('support'),
      tasks: [task(1, { phase: 'launch', status: 'done' })],
      today: TODAY,
    });
    expect(keys(tiles)).toEqual(PHASE_KEYS.slice(0, 5));
    expect(columns.filter((column) => !column.hidden).map((column) => column.key)).toEqual([
      'support',
    ]);
    expect(byKey(columns, 'support')).toMatchObject({ tag: 'current', width: 'current' });
  });

  it('keeps a past phase with an open task as a column, and folds it once it is done', () => {
    const tasks = [task(1, { phase: 'design', priority: 'p1' }), task(2, { phase: 'design' })];
    const before = boardColumns({ plan: planOf('development', DATES), tasks, today: TODAY });
    expect(keys(before.tiles)).toEqual(['requirement_gathering']);
    expect(byKey(before.columns, 'design')).toMatchObject({
      folded: false,
      hidden: false,
      tag: null,
      doneOpen: false,
      dates: '7 to 28 Oct',
      note: { text: 'Ended 5 days late', tone: 'red' },
    });
    const after = boardColumns({
      plan: planOf('development', DATES),
      tasks: tasks.map((one) => ({ ...one, status: 'done' })),
      today: TODAY,
    });
    expect(keys(after.tiles)).toEqual(['requirement_gathering', 'design']);
    expect(after.tiles[1]).toMatchObject({ text: '2 of 2 tasks', note: 'Ended 5 days late' });
  });

  it('opens a folded phase as a column with Done, its done cards unfolded', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf('development', DATES),
      tasks: [task(1, { phase: 'design', status: 'done' })],
      today: TODAY,
      opened: ['design'],
    });
    expect(tiles[1]).toMatchObject({ key: 'design', opened: true });
    expect(byKey(columns, 'design')).toMatchObject({ hidden: false, tag: 'done', doneOpen: true });
  });

  it('never marks a skipped phase done or checked', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf('development', DATES),
      tasks: [task(1, { phase: 'requirement_gathering', status: 'done' })],
      today: TODAY,
      opened: ['requirement_gathering'],
    });
    expect(tiles[0]).toMatchObject({ skipped: true, text: '1 of 1 task', note: null });
    expect(byKey(columns, 'requirement_gathering')).toMatchObject({
      status: 'skipped',
      tag: 'skipped',
      dates: 'Skipped',
      note: null,
    });
    // a skipped phase with an open task stays a column: no tag, its dates line "Skipped"
    const open = boardColumns({
      plan: planOf('development', DATES),
      tasks: [task(2, { phase: 'requirement_gathering' })],
      today: TODAY,
    });
    expect(byKey(open.columns, 'requirement_gathering')).toMatchObject({
      tag: null,
      dates: 'Skipped',
      hidden: false,
    });
  });

  it('writes each column’s dates and late note', () => {
    const plan = planOf('development', DATES);
    const row = (key) => plan.phases.find((phase) => phase.key === key);
    expect(columnDates('current', row('development'), TODAY)).toEqual({
      dates: '26 Oct to 27 Nov',
      note: { text: 'Started 2 days late', tone: 'marigold' },
    });
    expect(columnDates('later', row('testing'), TODAY)).toEqual({
      dates: '30 Nov to 11 Dec',
      note: null,
    });
    expect(columnDates('later', row('launch'), TODAY)).toEqual({ dates: null, note: null });
  });

  it('adds No phase yet last only when some task has no phase', () => {
    const plan = planOf('development', DATES);
    expect(keys(boardColumns({ plan, tasks: [task(1)], today: TODAY }).columns)).toEqual(
      PHASE_KEYS,
    );
    const { columns } = boardColumns({
      plan,
      tasks: [task(1), task(2, { phase: null }), task(3, { phase: 'old', status: 'done' })],
      today: TODAY,
    });
    expect(columns.at(-1)).toMatchObject({ key: NO_PHASE, kind: 'none', label: 'No phase yet' });
    expect(ids(columns.at(-1).open)).toEqual([2]);
    expect(ids(columns.at(-1).done)).toEqual([3]);
  });

  it('shows a member only the folded phases where they have tasks', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf('development', DATES),
      tasks: [task(1, { phase: 'design', status: 'done' })],
      member: true,
      today: TODAY,
    });
    expect(tiles).toEqual([expect.objectContaining({ key: 'design', text: '1 of yours, done' })]);
    expect(byKey(columns, 'testing').emptyText).toBe('Nothing for you yet');
  });
});

describe('the order of the cards', () => {
  it('puts open cards P1, P2, P3, then by due date, then by title', () => {
    const tasks = [
      task(1, { title: 'B', priority: 'p2', dueDate: '2026-11-30' }),
      task(2, { title: 'A', priority: 'p2', dueDate: '2026-11-30' }),
      task(3, { title: 'C', priority: 'p3', dueDate: '2026-11-24' }),
      task(4, { title: 'D', priority: 'p1' }),
      task(5, { title: 'E', priority: 'p2' }),
      task(6, { title: 'F', status: 'done' }),
    ];
    const { columns } = boardColumns({ plan: planOf('development'), tasks, today: TODAY });
    const development = byKey(columns, 'development');
    expect(ids(development.open)).toEqual([4, 2, 1, 5, 3]);
    expect(ids(development.done)).toEqual([6]);
  });
});

describe('the filters', () => {
  const tasks = [
    task(1, { priority: 'p1', fileCount: 2 }),
    task(2, { priority: 'p1' }),
    task(3, { fileCount: 1 }),
    task(4, { priority: 'p1', status: 'done', fileCount: 3 }),
    task(5),
  ];

  it('counts open tasks only', () => {
    const counts = filterCounts(tasks);
    expect(counts).toEqual({ all: 4, critical: 2, files: 2 });
    expect(filterItems(counts).map((item) => item.label)).toEqual([
      'All open (4)',
      'Critical (2)',
      'With files (2)',
    ]);
    expect(filterItems(counts, { files: false }).map((item) => item.value)).toEqual([
      'all',
      'critical',
    ]);
  });

  it('dims every other card and every done card, and hides none', () => {
    expect(tasks.filter((one) => isDimmed(one, 'critical')).map((one) => one.id)).toEqual([
      3, 4, 5,
    ]);
    expect(tasks.filter((one) => isDimmed(one, 'files')).map((one) => one.id)).toEqual([2, 4, 5]);
    expect(tasks.some((one) => isDimmed(one, 'all'))).toBe(false);
  });

  it('says what changed under the pills', () => {
    expect(filterStatus('all', { critical: 4, files: 4 })).toBe('');
    expect(filterStatus('critical', { critical: 4 })).toBe('4 critical tasks highlighted.');
    expect(filterStatus('critical', { critical: 1 })).toBe('1 critical task highlighted.');
    expect(filterStatus('critical', { critical: 0 })).toBe('No critical tasks open.');
    expect(filterStatus('files', { files: 4 })).toBe('4 tasks with files highlighted.');
    expect(filterStatus('files', { files: 0 })).toBe('No tasks with files.');
  });

  it('reads ?show= from the Summary tab', () => {
    expect(filterOf('critical')).toBe('critical');
    expect(filterOf(['files'])).toBe('files');
    expect(filterOf('everything')).toBe('all');
    expect(filterOf(undefined)).toBe('all');
  });
});

describe('the phone', () => {
  it('steps through the six phases, then No phase yet', () => {
    const plan = planOf('development', DATES);
    const { columns } = boardColumns({
      plan,
      tasks: [task(1, { phase: null })],
      today: TODAY,
    });
    expect(phoneSteps(columns)).toEqual([...PHASE_KEYS, NO_PHASE]);
    expect(firstStep('development')).toBe('development');
    expect(firstStep(null)).toBe('requirement_gathering');
  });

  it('names the phase shown, with the matches of a pressed filter', () => {
    const { columns } = boardColumns({
      plan: planOf('development'),
      tasks: [
        task(1, { priority: 'p1', fileCount: 1 }),
        task(2, { priority: 'p1' }),
        task(3, { status: 'done' }),
      ],
      today: TODAY,
    });
    const development = byKey(columns, 'development');
    expect(switcherText(development, 'all')).toBe('Development · 1 of 3');
    expect(switcherText(development, 'critical')).toBe('Development · 1 of 3 · 2 critical');
    expect(switcherText(development, 'files')).toBe('Development · 1 of 3 · 1 with files');
    expect(switcherText(byKey(columns, 'launch'), 'all')).toBe('Launch · No tasks yet');
  });
});

describe('the band', () => {
  const counts = countByPhase([
    task(1, { phase: 'design', status: 'done' }),
    task(2, { phase: 'design', status: 'done' }),
    task(3),
    task(4, { status: 'done' }),
    task(5, { phase: 'testing' }),
    task(6, { phase: null }),
  ]);

  it('counts every task per phase and in all', () => {
    expect(counts).toEqual({
      design: { total: 2, done: 2 },
      development: { total: 2, done: 1 },
      testing: { total: 1, done: 0 },
      none: { total: 1, done: 0 },
    });
    expect(progressOf(counts)).toEqual({ done: 3, total: 6, pct: 50 });
    expect(progressOf({})).toEqual({ done: 0, total: 0, pct: 0 });
  });

  it('draws six parts: done, skipped, current with its share, later', () => {
    const parts = bandParts({ plan: planOf('development', DATES), counts });
    expect(parts.map((part) => part.status)).toEqual([
      'skipped',
      'done',
      'current',
      'later',
      'later',
      'later',
    ]);
    expect(parts.map((part) => part.text)).toEqual([
      'Skipped',
      '2 of 2',
      '1 of 2',
      '0 of 1',
      'No tasks yet',
      'No tasks yet',
    ]);
    expect(parts[2]).toMatchObject({
      share: 50,
      ariaLabel: 'Development, current phase, 1 of 2 tasks done. Show its column.',
    });
    expect(parts[0].ariaLabel).toBe(
      'Requirement gathering, skipped, no tasks yet. Show its column.',
    );
    expect(parts[3].ariaLabel).toBe('Testing, later, 0 of 1 task done. Show its column.');
  });

  it('writes the deadline', () => {
    expect(deadlineText('2026-12-16', TODAY)).toEqual({
      date: '16 Dec 2026',
      left: '23 days left',
      late: false,
    });
    expect(deadlineText(TODAY, TODAY)).toMatchObject({ left: 'Due today', late: true });
    expect(deadlineText('2026-11-18', TODAY)).toMatchObject({ left: '5 days late', late: true });
    expect(deadlineText(null, TODAY)).toEqual({ date: null, left: 'No deadline', late: false });
  });

  it('writes the member’s note and a card’s report line', () => {
    expect(memberNote(29)).toBe(
      'Only your tasks and tasks for anyone on the project are shown. Progress counts all 29 tasks.',
    );
    const line = (latestStatus, status = 'open') =>
      reportLine({ status, latestStatus, latestOn: '2026-11-20' });
    expect(line('blocked')).toEqual({ text: 'Blocked · Fri, 20 Nov', tone: 'red' });
    expect(line('in_progress')).toEqual({ text: 'In progress · Fri, 20 Nov', tone: 'primary' });
    expect(line('blocked', 'done')).toBeNull();
    expect(reportLine({ status: 'open', latestStatus: null, latestOn: null })).toBeNull();
  });
});

describe('moving a card', () => {
  const card = task(7, { title: 'Fix the login page', phase: 'design' });

  it('takes a drop only on another phase column, never on No phase yet or Done phases', () => {
    expect(canDropOn(card, 'testing')).toBe(true);
    expect(canDropOn(card, 'design')).toBe(false);
    expect(canDropOn(card, NO_PHASE)).toBe(false);
    expect(canDropOn(card, 'done-phases')).toBe(false);
    expect(canDropOn({ ...card, status: 'done' }, 'testing')).toBe(false);
    expect(canDropOn({ ...card, phase: null }, 'design')).toBe(true);
  });

  it('lists the six phases, its own as here now', () => {
    const rows = moveTargets(card, { design: { total: 8, done: 7 } });
    expect(rows).toHaveLength(6);
    expect(rows[1]).toEqual({
      key: 'design',
      label: 'Design (here now)',
      count: '7 of 8',
      here: true,
    });
    expect(rows[5]).toEqual({
      key: 'support',
      label: 'Support',
      count: 'No tasks yet',
      here: false,
    });
  });

  it('moves at once and takes it back with Undo', () => {
    const move = moveOf(card, 'testing');
    expect(move).toEqual({ taskId: 7, from: 'design', to: 'testing' });
    expect(movedText(move.to)).toBe('Moved to Testing.');
    expect(undoOf(move)).toEqual({ taskId: 7, from: 'testing', to: 'design' });
    expect(moveBody(undoOf(move))).toEqual({ phase: 'design' });
    const fromNone = moveOf({ id: 8, phase: null }, 'design');
    expect(moveBody(undoOf(fromNone))).toEqual({ phase: null });

    const moves = new Map([[7, 'testing']]);
    expect(withMoves([card], moves)[0].phase).toBe('testing');
    expect(pendingMoves(moves, [card])).toBe(moves);
    expect(pendingMoves(moves, [{ ...card, phase: 'testing' }]).size).toBe(0);
  });

  it('finds where a dragged card lands and what to focus after it leaves', () => {
    const column = [task(1, { priority: 'p1' }), task(2, { title: 'A' }), task(3, { title: 'Z' })];
    expect(landingIndex(column, { ...card, priority: 'p2', title: 'M' })).toBe(2);
    expect(landingIndex(column, { ...card, priority: 'p1', title: 'A' })).toBe(0);
    expect(nextCardAfter(column, 2)).toBe(3);
    expect(nextCardAfter(column, 3)).toBe(2);
    expect(nextCardAfter([task(1)], 1)).toBeNull();
  });
});
