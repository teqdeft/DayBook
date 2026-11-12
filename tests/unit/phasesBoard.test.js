// The Phases tab's rules (CONTRACT 22): the sections in order and which one opens, the order of the
// tasks, the words in each section's header and rows (phasesView.js), who the add and edit row offers
// as owner, and Delete with Undo's queue (undoQueue.js): sent when the toast ends, taken back by
// Undo, sent with keepalive when the page is left, and never sent twice.
import { describe, expect, it, vi } from 'vitest';
import {
  NO_PHASE,
  actualText,
  awayLabel,
  doneToggleLabel,
  emptyTasksText,
  firstOpenSection,
  latestReportLabel,
  phaseSections,
  plannedText,
  sectionDates,
  sortDoneTasks,
  sortOpenTasks,
  taskCount,
  toBoardTask,
} from '@/app/(app)/projects/[id]/phasesView';
import { createDeleteQueue } from '@/app/(app)/projects/[id]/undoQueue';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { ownerOptions } = await import('@/app/(app)/projects/[id]/PhaseTaskForm.jsx');

const TODAY = '2026-10-30';

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

const task = (id, more = {}) => ({
  id,
  title: `Task ${id}`,
  priority: 'p2',
  status: 'open',
  phase: 'design',
  dueDate: null,
  ...more,
});

const titles = (list) => list.map((row) => row.title);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the sections', () => {
  it('has one per phase, in order, without No phase yet when every task has a phase', () => {
    const sections = phaseSections({ plan: planOf('design'), tasks: [task(1)] });
    expect(sections.map((section) => section.key)).toEqual(PROJECT_PHASES.map(({ key }) => key));
    expect(sections[1]).toMatchObject({ label: 'Design', status: 'current', total: 1 });
    expect(sections[0].status).toBe('skipped');
    expect(sections[2].status).toBe('later');
  });

  it('adds No phase yet last for tasks without a phase', () => {
    const sections = phaseSections({
      plan: planOf('design'),
      tasks: [task(1, { phase: null }), task(2, { phase: 'not_a_phase' }), task(3)],
    });
    const last = sections.at(-1);
    expect(sections).toHaveLength(7);
    expect(last).toMatchObject({ key: NO_PHASE, label: 'No phase yet', phase: null, status: null });
    expect(titles(last.open)).toEqual(['Task 1', 'Task 2']);
    expect(sectionDates(last, TODAY)).toEqual({ planned: null, actual: null, note: null });
  });

  it('splits open from done and counts both', () => {
    const [, design] = phaseSections({
      plan: planOf('design'),
      tasks: [task(1), task(2, { status: 'done' }), task(3, { status: 'done' })],
    });
    expect(titles(design.open)).toEqual(['Task 1']);
    expect(titles(design.done)).toEqual(['Task 2', 'Task 3']);
    expect(design.total).toBe(3);
  });

  it('opens the current phase, or the first with no phase yet', () => {
    expect(firstOpenSection('testing')).toBe('testing');
    expect(firstOpenSection(null)).toBe('requirement_gathering');
    expect(firstOpenSection('nonsense')).toBe('requirement_gathering');
  });
});

describe('the order of the tasks', () => {
  it('lists open tasks P1 first, then by due date with no date last, then by title', () => {
    const list = [
      task(1, { title: 'No date P1', priority: 'p1' }),
      task(2, { title: 'Late P2', dueDate: '2026-10-28' }),
      task(3, { title: 'Soon P1', priority: 'p1', dueDate: '2026-11-06' }),
      task(4, { title: 'B same day', priority: 'p1', dueDate: '2026-11-06' }),
      task(5, { title: 'P3', priority: 'p3', dueDate: '2026-10-01' }),
      task(6, { title: 'A no date P2' }),
    ];
    expect(titles(sortOpenTasks(list))).toEqual([
      'B same day',
      'Soon P1',
      'No date P1',
      'Late P2',
      'A no date P2',
      'P3',
    ]);
  });

  it('lists done tasks by due date, then by title', () => {
    const list = [
      task(1, { title: 'Later', dueDate: '2026-10-29' }),
      task(2, { title: 'No date' }),
      task(3, { title: 'Earlier', dueDate: '2026-10-07', priority: 'p3' }),
    ];
    expect(titles(sortDoneTasks(list))).toEqual(['Earlier', 'Later', 'No date']);
  });

  it('never changes the list it was given', () => {
    const list = [task(2, { priority: 'p3' }), task(1, { priority: 'p1' })];
    sortOpenTasks(list);
    expect(list.map((row) => row.id)).toEqual([2, 1]);
  });
});

describe('the words', () => {
  it('counts tasks', () => {
    expect(taskCount(3, 12)).toBe('3 of 12 tasks');
    expect(taskCount(0, 1)).toBe('0 of 1 task');
    expect(taskCount(0, 0)).toBe('No tasks yet');
  });

  it('shows and hides the done ones', () => {
    expect(doneToggleLabel(false, 10)).toBe('Show 10 done tasks');
    expect(doneToggleLabel(false, 1)).toBe('Show 1 done task');
    expect(doneToggleLabel(true, 10)).toBe('Hide done tasks');
  });

  it('says why no open task is listed', () => {
    expect(emptyTasksText(4)).toBe('All tasks are done.');
    expect(emptyTasksText(0)).toBe('No tasks yet.');
  });

  it('writes the planned dates, with one or none', () => {
    const dates = (plannedStart, plannedEnd) => plannedText({ plannedStart, plannedEnd }, TODAY);
    expect(dates('2026-10-06', '2026-10-23')).toBe('Planned 6 to 23 Oct');
    expect(dates('2026-12-16', '2027-01-15')).toBe('Planned 16 Dec to 15 Jan 2027');
    expect(dates('2026-10-06', null)).toBe('Planned from 6 Oct');
    expect(dates(null, '2026-10-23')).toBe('Planned until 23 Oct');
    expect(dates(null, null)).toBe('No planned dates');
  });

  it('writes the actual dates of the current and done phases only', () => {
    const ran = { actualStart: '2026-10-06', actualEnd: '2026-10-26' };
    expect(actualText('current', { actualStart: '2026-10-26' }, TODAY)).toBe('Started 26 Oct');
    expect(actualText('done', ran, TODAY)).toBe('Actual 6 to 26 Oct');
    expect(actualText('done', { actualEnd: '2026-10-26' }, TODAY)).toBe('Ended 26 Oct');
    expect(actualText('current', {}, TODAY)).toBeNull();
    expect(actualText('skipped', ran, TODAY)).toBeNull();
    expect(actualText('later', ran, TODAY)).toBeNull();
  });

  it('writes one day when both dates are the same', () => {
    expect(plannedText({ plannedStart: '2026-12-14', plannedEnd: '2026-12-14' }, TODAY)).toBe(
      'Planned 14 Dec',
    );
    const sameDay = { actualStart: '2026-10-30', actualEnd: '2026-10-30' };
    expect(actualText('done', sameDay, TODAY)).toBe('Actual 30 Oct');
  });

  it('takes the late note from planFormat', () => {
    const plan = planOf('design', {
      requirement_gathering: { plannedEnd: '2026-10-20', actualEnd: '2026-10-26' },
      design: { plannedStart: '2026-10-19', plannedEnd: '2026-10-23', actualStart: '2026-10-26' },
      development: { plannedStart: '2026-10-27' },
    });
    const [done, current, later] = phaseSections({ plan, tasks: [] });
    expect(sectionDates(done, TODAY)).toEqual({
      planned: 'Planned until 20 Oct',
      actual: 'Ended 26 Oct',
      note: { text: 'Ended 6 days late', tone: 'red' },
    });
    expect(sectionDates(current, TODAY)).toEqual({
      planned: 'Planned 19 to 23 Oct',
      actual: 'Started 26 Oct',
      note: { text: '7 days late', tone: 'red' },
    });
    expect(sectionDates(later, TODAY)).toEqual({
      planned: 'Planned from 27 Oct',
      actual: null,
      note: { text: 'Planned start was 3 days ago', tone: 'marigold' },
    });
  });

  it('leaves the start out when the note already says it started late', () => {
    const plan = planOf('design', {
      design: { plannedStart: '2026-10-19', plannedEnd: '2026-11-23', actualStart: '2026-10-26' },
    });
    expect(sectionDates(phaseSections({ plan, tasks: [] })[1], TODAY)).toEqual({
      planned: 'Planned 19 Oct to 23 Nov',
      actual: null,
      note: { text: 'Started 7 days late', tone: 'marigold' },
    });
  });

  it('names the latest report on a task', () => {
    const latest = (status, workDate) =>
      latestReportLabel({ status, userName: 'Neha Arora', workDate }, TODAY);
    expect(latest('in_progress', '2026-10-29')).toBe('Neha, yesterday: In progress');
    expect(latest('blocked', TODAY)).toBe('Neha, today: Blocked');
    expect(latest('done', '2026-10-20')).toBe('Neha, Tue, 20 Oct: Done');
    expect(latestReportLabel(null, TODAY)).toBeNull();
  });

  it('says when the owner can no longer work on it', () => {
    expect(awayLabel({ status: 'active', isMember: true })).toBeNull();
    expect(awayLabel({ status: 'active', isMember: false })).toBe('Not on the project');
    expect(awayLabel({ status: 'deactivated', isMember: true })).toBe('Deactivated');
    expect(awayLabel(null)).toBeNull();
  });
});

describe('a task on the board', () => {
  it('keeps what the board shows and leaves the rest', () => {
    const row = toBoardTask(
      {
        id: 4,
        title: 'Design the booking screens',
        details: 'Web and phone',
        priority: 'p1',
        status: 'open',
        phase: 'design',
        dueDate: '2026-11-13',
        createdBy: 7,
        doneByName: null,
        assignee: {
          id: 9,
          name: 'Neha Arora',
          status: 'active',
          isMember: false,
          role: 'employee',
        },
        latestReport: { status: 'blocked', userId: 9, userName: 'Neha Arora', workDate: TODAY },
      },
      TODAY,
    );
    expect(row).toEqual({
      id: 4,
      title: 'Design the booking screens',
      details: 'Web and phone',
      priority: 'p1',
      status: 'open',
      phase: 'design',
      dueDate: '2026-11-13',
      assignee: { id: 9, name: 'Neha Arora', away: 'Not on the project' },
      latest: 'Neha, today: Blocked',
      latestStatus: 'blocked',
    });
  });

  it('copes with a task from before phases, for anyone, never reported', () => {
    const row = toBoardTask({ id: 1, title: 'Old', priority: 'p3', status: 'open' }, TODAY);
    expect(row).toMatchObject({ phase: null, dueDate: null, assignee: null, latest: null });
  });
});

describe('owners in the add and edit row', () => {
  const owners = [
    { id: 7, name: 'Riya Kapoor' },
    { id: 9, name: 'Neha Arora' },
  ];

  it('offers anyone, then the people who can be picked', () => {
    expect(ownerOptions(owners, null)).toEqual([
      { value: '', label: 'Anyone on the project' },
      { value: '7', label: 'Riya Kapoor' },
      { value: '9', label: 'Neha Arora' },
    ]);
  });

  it('keeps an owner who left the project, and says so', () => {
    const away = { assignee: { id: 12, name: 'Karan Mehta', away: 'Not on the project' } };
    expect(ownerOptions(owners, away).at(-1)).toEqual({
      value: '12',
      label: 'Karan Mehta (not on the project)',
    });
    expect(ownerOptions(owners, { assignee: { id: 9, name: 'Neha Arora' } })).toHaveLength(3);
  });
});

describe('the delete queue', () => {
  function queueWith(send = vi.fn().mockResolvedValue({})) {
    const sendOnLeave = vi.fn();
    const onSent = vi.fn();
    const onFailed = vi.fn();
    const queue = createDeleteQueue({ send, sendOnLeave });
    queue.listen({ onSent, onFailed });
    return { queue, send, sendOnLeave, onSent, onFailed };
  }
  const item = (id) => ({ key: `task:${id}`, url: `/api/project-tasks/${id}`, label: 'Deleted.' });

  it('waits for the toast to end, then sends the delete once', async () => {
    const { queue, send, onSent } = queueWith();
    const entry = queue.hold(item(1));
    expect(send).not.toHaveBeenCalled();
    expect(queue.end(entry.toast)).toBe(entry);
    expect(queue.end(entry.toast)).toBeNull();
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].url).toBe('/api/project-tasks/1');
    expect(onSent).toHaveBeenCalledWith(entry);
    expect(queue.hold(item(1))).toBeNull();
  });

  it('never sends what Undo took back', async () => {
    const { queue, send, sendOnLeave } = queueWith();
    const entry = queue.hold(item(1));
    expect(queue.undo(entry.toast)).toBe(entry);
    expect(queue.end(entry.toast)).toBeNull();
    queue.leave();
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(sendOnLeave).not.toHaveBeenCalled();
  });

  it('sends the waiting delete at once when another takes the toast', async () => {
    const { queue, send } = queueWith();
    const first = queue.hold(item(1));
    const second = queue.hold(item(2));
    expect(second.toast).toBeGreaterThan(first.toast);
    expect(queue.undo(first.toast)).toBeNull(); // too late: its toast is gone
    await flush();
    expect(send.mock.calls.map(([entry]) => entry.key)).toEqual(['task:1']);
    expect(queue.pending).toBe(second);
  });

  it('ignores a second delete of the row it is waiting on', () => {
    const { queue } = queueWith();
    const entry = queue.hold(item(1));
    expect(queue.hold(item(1))).toBeNull();
    expect(queue.pending).toBe(entry);
  });

  it('sends with keepalive when the page is left, once', async () => {
    const { queue, send, sendOnLeave } = queueWith();
    const entry = queue.hold(item(1));
    expect(queue.leave()).toBe(entry);
    expect(queue.leave()).toBeNull();
    expect(queue.end(entry.toast)).toBeNull();
    await flush();
    expect(sendOnLeave).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(queue.hold(item(1))).toBeNull();
  });

  it('says when a delete failed, and lets it be tried again', async () => {
    const error = Object.assign(new Error('Offline'), { status: 0 });
    const { queue, send, onFailed, onSent } = queueWith(vi.fn().mockRejectedValueOnce(error));
    const entry = queue.hold(item(1));
    queue.end(entry.toast);
    await flush();
    expect(onFailed).toHaveBeenCalledWith(entry, error);
    expect(onSent).not.toHaveBeenCalled();
    send.mockResolvedValue({});
    const again = queue.hold(item(1));
    expect(again).not.toBeNull();
    queue.end(again.toast);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(onSent).toHaveBeenCalledWith(again);
  });

  it('sends the waiting delete as usual when the board goes away, and says how it went', async () => {
    const { queue, send, sendOnLeave, onSent } = queueWith();
    expect(queue.sendNow()).toBeNull();
    const entry = queue.hold(item(1));
    expect(queue.sendNow()).toBe(entry);
    expect(queue.sendNow()).toBeNull();
    expect(queue.end(entry.toast)).toBeNull();
    expect(queue.undo(entry.toast)).toBeNull();
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(sendOnLeave).not.toHaveBeenCalled();
    expect(onSent).toHaveBeenCalledWith(entry);
    expect(queue.hold(item(1))).toBeNull();
  });

  it('tells a board that has gone how a failed delete went, so the next tab can be fixed', async () => {
    const error = Object.assign(new Error('Not found'), { status: 404 });
    const { queue, onFailed } = queueWith(vi.fn().mockRejectedValue(error));
    const entry = queue.hold(item(1));
    queue.sendNow();
    await flush();
    expect(onFailed).toHaveBeenCalledWith(entry, error);
  });

  it('tells nobody once its listener is taken away', async () => {
    const { queue, onSent } = queueWith();
    const entry = queue.hold(item(1));
    queue.end(entry.toast);
    queue.listen(null);
    await flush();
    expect(onSent).not.toHaveBeenCalled();
  });
});
