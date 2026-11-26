// The Board tab's rules (CONTRACT 27 and 28, Done phases rail and columns): the columns for a
// project with no phase yet, in a middle phase and in Support; the fold rule (a past phase with an
// open task stays a column, and folds into the rail once its last open task is done); a skipped
// phase; later empty phases as normal columns, with no width classes; No phase yet only when
// needed; the early notes; when the board fills the window; the order of the cards; the phone's
// steps; and the band (boardView.js, bandView.js): every part with a fill and a green layer, the
// ring, the plan shown right after a phase move. The filters are boardFilters.test.js's; moving a
// card with its Undo (boardMoves.js) is in boardMoves.test.js (split by CONTRACT 28).
import { describe, expect, it } from 'vitest';
import {
  bandParts,
  countByPhase,
  deadlineText,
  progressOf,
  ringIndex,
  shownPlan,
} from '@/app/(app)/projects/[id]/_board/bandView';
import {
  boardColumns,
  columnDates,
  fillsWindow,
  firstStep,
  foldsBetween,
  memberNote,
  phaseNote,
  phoneSteps,
  railHiddenText,
  stayText,
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
  ...more,
});

const keys = (list) => list.map((item) => item.key);
const ids = (list) => list.map((item) => item.id);
const byKey = (columns, key) => columns.find((column) => column.key === key);
const shown = (columns) => columns.filter((column) => !column.hidden).map((column) => column.key);

describe('the columns', () => {
  it('with no phase yet: all six show, none folds, none has a width of its own', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf(null),
      tasks: [task(1, { phase: 'requirement_gathering' })],
      today: TODAY,
    });
    expect(tiles).toEqual([]);
    expect(keys(columns)).toEqual(PHASE_KEYS);
    expect(columns.every((column) => column.status === 'later' && !column.hidden)).toBe(true);
    expect(columns.some((column) => 'width' in column || 'slim' in column)).toBe(false);
    expect(columns.some((column) => column.tag || column.current)).toBe(false);
    expect(byKey(columns, 'design').emptyText).toBe('No tasks yet');
  });

  it('with no tasks at all: six columns, each saying so', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf('design', DATES),
      tasks: [],
      today: TODAY,
    });
    expect(keys(tiles)).toEqual(['requirement_gathering']);
    expect(shown(columns)).toEqual(PHASE_KEYS.slice(1));
    expect(columns.every((column) => column.open.length === 0 && column.total === 0)).toBe(true);
  });

  it('in a middle phase: past phases without open tasks fold into the rail', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf('development', DATES),
      tasks: [task(1, { phase: 'design', status: 'done' }), task(2), task(3, { phase: 'testing' })],
      today: TODAY,
    });
    expect(keys(tiles)).toEqual(['requirement_gathering', 'design']);
    expect(byKey(columns, 'design')).toMatchObject({
      folded: true,
      finished: true,
      hidden: true,
      tag: 'done',
    });
    expect(byKey(columns, 'development')).toMatchObject({ tag: 'current', current: true });
    // later empty phases are normal columns with their empty line
    expect(byKey(columns, 'launch')).toMatchObject({ hidden: false, finished: false, total: 0 });
    expect(byKey(columns, 'support').emptyText).toBe('No tasks yet');
    expect(shown(columns)).toEqual(['development', 'testing', 'launch', 'support']);
  });

  it('in Support: every earlier phase folds when its tasks are done', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf('support'),
      tasks: [task(1, { phase: 'launch', status: 'done' })],
      today: TODAY,
    });
    expect(keys(tiles)).toEqual(PHASE_KEYS.slice(0, 5));
    expect(shown(columns)).toEqual(['support']);
    expect(byKey(columns, 'support')).toMatchObject({ tag: 'current' });
  });

  it('keeps a past phase with an open task as a column, and folds it once it is done', () => {
    const tasks = [task(1, { phase: 'design', priority: 'p1' }), task(2, { phase: 'design' })];
    const before = boardColumns({ plan: planOf('development', DATES), tasks, today: TODAY });
    expect(keys(before.tiles)).toEqual(['requirement_gathering']);
    expect(byKey(before.columns, 'design')).toMatchObject({
      folded: false,
      finished: false,
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
    expect(railHiddenText(after.tiles)).toBe(': Requirement gathering, Design. Show them.');
  });

  it('opens a folded phase as a column with Done, its done cards unfolded', () => {
    const { tiles, columns } = boardColumns({
      plan: planOf('development', DATES),
      tasks: [task(1, { phase: 'design', status: 'done' })],
      today: TODAY,
      opened: ['design'],
    });
    expect(tiles[1]).toMatchObject({ key: 'design', opened: true });
    expect(byKey(columns, 'design')).toMatchObject({
      hidden: false,
      tag: 'done',
      doneOpen: true,
      finished: true,
    });
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
      skipped: true,
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

  it('adds muted early notes for the board: ended early, started early', () => {
    const early = {
      plannedStart: '2026-10-26',
      plannedEnd: '2026-11-27',
      actualStart: '2026-10-26',
      actualEnd: '2026-11-23',
    };
    expect(phaseNote('done', early, TODAY)).toEqual({ text: 'Ended 4 days early', tone: 'muted' });
    const started = {
      plannedStart: '2026-11-30',
      plannedEnd: '2026-12-11',
      actualStart: '2026-11-23',
    };
    expect(phaseNote('current', started, TODAY)).toEqual({
      text: 'Started 7 days early',
      tone: 'muted',
    });
    expect(columnDates('current', started, TODAY)).toEqual({
      dates: '30 Nov to 11 Dec',
      note: { text: 'Started 7 days early', tone: 'muted' },
    });
    // a late note wins, and a phase on time says nothing
    const late = { ...started, plannedEnd: '2026-11-20' };
    expect(phaseNote('current', late, TODAY)).toEqual({ text: '3 days late', tone: 'red' });
    const onTime = { ...early, actualEnd: '2026-11-27' };
    expect(phaseNote('done', onTime, TODAY)).toBeNull();
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
    expect(columns.at(-1)).toMatchObject({
      key: NO_PHASE,
      kind: 'none',
      label: 'No phase yet',
      hidden: false,
      finished: false,
      tag: null,
      doneOpen: false,
    });
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

  it('says so in every empty column of a Completed project', () => {
    for (const member of [false, true]) {
      const { columns } = boardColumns({
        plan: planOf('testing', DATES),
        tasks: [],
        member,
        today: TODAY,
        completed: true,
      });
      expect(byKey(columns, 'launch').emptyText).toBe('No tasks here. This project is completed.');
    }
  });
});

describe('when the board fills the window', () => {
  const plan = planOf('development', DATES);
  const closed = () => false;
  it('fills with 4 cards in a shown column, open plus an opened fold', () => {
    const three = [task(1), task(2), task(3), task(4, { status: 'done' })];
    const { columns } = boardColumns({ plan, tasks: three, today: TODAY });
    expect(fillsWindow(columns, closed)).toBe(false);
    expect(fillsWindow(columns, () => true)).toBe(true);
    const four = boardColumns({ plan, tasks: [...three, task(5)], today: TODAY });
    expect(fillsWindow(four.columns, closed)).toBe(true);
  });

  it('never counts a folded phase that is hidden in the rail', () => {
    const done = [1, 2, 3, 4].map((id) => task(id, { phase: 'design', status: 'done' }));
    const { columns } = boardColumns({ plan, tasks: done, today: TODAY });
    expect(fillsWindow(columns, () => true)).toBe(false);
  });
});

describe('a phase move', () => {
  it('names the phases that fold and whether the rail is new', () => {
    const tasks = [task(1, { phase: 'requirement_gathering', status: 'done' }), task(2)];
    const plan = planOf('requirement_gathering');
    const before = boardColumns({ plan, tasks, today: TODAY });
    const after = boardColumns({ plan: shownPlan(plan, 'design', TODAY), tasks, today: TODAY });
    expect(foldsBetween(before, after)).toEqual({
      folds: ['requirement_gathering'],
      railIsNew: true,
    });
    const back = boardColumns({ plan: shownPlan(plan, 'design', TODAY), tasks, today: TODAY });
    expect(foldsBetween(back, back)).toEqual({ folds: [], railIsNew: false });
  });

  it('says how many open tasks stay behind', () => {
    expect(stayText(5, 'Testing')).toBe('5 open tasks stay in Testing.');
    expect(stayText(1, 'Testing')).toBe('1 open task stays in Testing.');
    expect(stayText(0, 'Testing')).toBeNull();
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

  it('names the phase shown with its count', () => {
    const { columns } = boardColumns({
      plan: planOf('development'),
      tasks: [
        task(1, { priority: 'p1' }),
        task(2, { priority: 'p1' }),
        task(3, { status: 'done' }),
      ],
      today: TODAY,
    });
    expect(switcherText(byKey(columns, 'development'))).toBe('Development · 1 of 3');
    expect(switcherText(byKey(columns, 'launch'))).toBe('Launch · No tasks yet');
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

  it('draws six parts, each with a fill and a green layer: a done part is full', () => {
    const parts = bandParts({ plan: planOf('development', DATES), counts });
    expect(parts.map((part) => part.status)).toEqual([
      'skipped',
      'done',
      'current',
      'later',
      'later',
      'later',
    ]);
    expect(parts.map((part) => part.share)).toEqual([0, 100, 50, 0, 0, 0]);
    expect(parts.map((part) => part.doneLayer)).toEqual([false, true, false, false, false, false]);
    expect(parts.map((part) => part.text)).toEqual([
      'Skipped',
      '2 of 2',
      '1 of 2',
      '0 of 1',
      'No tasks yet',
      'No tasks yet',
    ]);
    expect(parts[2].ariaLabel).toBe(
      'Development, current phase, 1 of 2 tasks done. Show its column.',
    );
    expect(parts[0].ariaLabel).toBe(
      'Requirement gathering, skipped, no tasks yet. Show its column.',
    );
    expect(parts[3].ariaLabel).toBe('Testing, later, 0 of 1 task done. Show its column.');
    // a done phase with no tasks is still full
    expect(bandParts({ plan: planOf('development', DATES), counts: {} })[1].share).toBe(100);
  });

  it('puts the one ring on the current phase, and none without one', () => {
    expect(ringIndex('development')).toBe(2);
    expect(ringIndex('requirement_gathering')).toBe(0);
    expect(ringIndex(null)).toBeNull();
  });

  it('shows the plan as the server writes it after a move, forward and back', () => {
    const plan = planOf('development', DATES);
    const forward = shownPlan(plan, 'testing', TODAY);
    const row = (one, key) => one.phases.find((phase) => phase.key === key);
    expect(forward.currentPhase).toBe('testing');
    expect(row(forward, 'development')).toMatchObject({ actualEnd: TODAY });
    expect(row(forward, 'testing')).toMatchObject({ actualStart: TODAY, actualEnd: null });
    expect(bandParts({ plan: forward, counts })[2]).toMatchObject({ status: 'done', share: 100 });
    const back = shownPlan(plan, 'design', TODAY);
    expect(row(back, 'design')).toMatchObject({ actualStart: '2026-10-07', actualEnd: null });
    expect(row(back, 'development')).toMatchObject({ actualStart: null, actualEnd: null });
    expect(shownPlan(plan, 'development', TODAY)).toBe(plan);
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

  it('writes the member’s note', () => {
    expect(memberNote(29)).toBe(
      'Only your tasks and tasks for anyone on the project are shown. Progress counts all 29 tasks.',
    );
  });
});
