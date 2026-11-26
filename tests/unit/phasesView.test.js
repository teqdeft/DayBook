// The phases' rules (CONTRACT 22, 27 and 28): the order of the tasks, the words beside them and a
// task as the board's cards and the Table read it, with the per-viewer status chip, files, minutes,
// updates and private links (phasesView.js, which keeps nothing of the old Phases tab: the
// Board's columns are boardView.js's, tests/unit/boardView.test.js); and Delete with Undo's queue
// (undoQueue.js): sent when the toast ends, taken back by Undo, sent with keepalive when the page
// is left, and never sent twice. The New task and Edit task window's rules are in
// taskFormModel.test.js (split from phasesBoard.test.js by CONTRACT 28, Files and owners).
import { describe, expect, it, vi } from 'vitest';
import * as phasesView from '@/app/(app)/projects/[id]/phasesView';
import {
  awayLabel,
  latestReportLabel,
  sortDoneTasks,
  sortOpenTasks,
  toBoardTask,
} from '@/app/(app)/projects/[id]/phasesView';
import { createDeleteQueue } from '@/app/(app)/projects/[id]/undoQueue';

const TODAY = '2026-10-30';

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

describe('phasesView', () => {
  it("keeps only what the Board reads, none of the old Phases tab's section helpers", () => {
    expect(Object.keys(phasesView).sort()).toEqual([
      'NO_PHASE',
      'NO_PHASE_LABEL',
      'awayLabel',
      'latestReportLabel',
      'sortDoneTasks',
      'sortOpenTasks',
      'toBoardTask',
    ]);
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
  const row = {
    id: 4,
    title: 'Design the booking screens',
    details: 'Web and phone',
    priority: 'p1',
    status: 'open',
    phase: 'design',
    dueDate: '2026-11-13',
    createdBy: 7,
    createdByName: 'Riya Kapoor',
    doneByName: null,
    assignee: {
      id: 9,
      name: 'Neha Arora',
      initials: 'NA',
      status: 'active',
      isMember: false,
      role: 'employee',
      avatarUrl: null,
    },
    latestReport: { status: 'in_progress', userId: 3, userName: 'Someone Else', workDate: TODAY },
  };
  const chips = [{ id: 31, name: 'brief.pdf' }];

  it('keeps what the board shows, with what BoardTab read for this viewer', () => {
    const board = toBoardTask(row, TODAY, {
      viewerId: 7,
      files: { count: 3, chips },
      line: { status: 'blocked', userId: 9, userName: 'Neha Arora', workDate: TODAY },
      minutes: 340,
      updateCount: 2,
      privateLinkCount: 1,
    });
    expect(board).toEqual({
      id: 4,
      title: 'Design the booking screens',
      details: 'Web and phone',
      priority: 'p1',
      status: 'open',
      phase: 'design',
      dueDate: '2026-11-13',
      assignee: {
        id: 9,
        name: 'Neha Arora',
        avatarUrl: null,
        initials: 'NA',
        role: 'employee',
        status: 'active',
        away: 'Not on the project',
        isViewer: false,
      },
      statusChip: { status: 'blocked', workDate: TODAY },
      latest: 'Neha, today: Blocked',
      files: { count: 3, chips },
      fileCount: 3,
      minutes: 340,
      updateCount: 2,
      privateLinkCount: 1,
      createdBy: { id: 7, name: 'Riya Kapoor' },
    });
  });

  it('takes the status chip only from latestLinesFor, never the 1.12 latest report', () => {
    expect(toBoardTask(row, TODAY).statusChip).toBeNull();
    expect(toBoardTask(row, TODAY).latest).toBeNull();
    const odd = toBoardTask(row, TODAY, { line: { status: 'odd', workDate: TODAY } });
    expect(odd.statusChip).toEqual({ status: 'in_progress', workDate: TODAY });
  });

  it("marks the viewer's own task, and a deactivated person", () => {
    expect(toBoardTask(row, TODAY, { viewerId: 9 }).assignee.isViewer).toBe(true);
    const gone = toBoardTask(
      { ...row, assignee: { ...row.assignee, status: 'deactivated', isMember: true } },
      TODAY,
    );
    expect(gone.assignee).toMatchObject({ status: 'deactivated', away: 'Deactivated' });
    expect(gone.assignee.isViewer).toBe(false);
  });

  it('copes with a task from before phases, for anyone, never reported, with no files', () => {
    const board = toBoardTask({ id: 1, title: 'Old', priority: 'p3', status: 'open' }, TODAY);
    expect(board).toMatchObject({
      phase: null,
      dueDate: null,
      assignee: null,
      statusChip: null,
      latest: null,
      files: { count: 0, chips: [] },
      fileCount: 0,
      minutes: 0,
      updateCount: 0,
      privateLinkCount: 0,
      createdBy: null,
    });
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
