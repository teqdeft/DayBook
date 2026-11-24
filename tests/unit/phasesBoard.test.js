// The phases' rules (CONTRACT 22 and 27): the order of the tasks, the words beside them and a task
// as the board's cards read it (phasesView.js, which keeps nothing of the old Phases tab: the
// Board's columns are boardView.js's, tests/unit/boardView.test.js); the New task and Edit task
// window's rules (taskFormModel.js): who it offers as owner, its first values, the request a save
// sends and every sentence it says; and Delete with Undo's queue (undoQueue.js): sent when the toast
// ends, taken back by Undo, sent with keepalive when the page is left, and never sent twice.
import { describe, expect, it, vi } from 'vitest';
import * as phasesView from '@/app/(app)/projects/[id]/phasesView';
import {
  awayLabel,
  latestReportLabel,
  sortDoneTasks,
  sortOpenTasks,
  toBoardTask,
} from '@/app/(app)/projects/[id]/phasesView';
import {
  addedToast,
  closeQuestion,
  createBody,
  editBody,
  editable,
  initialValues,
  noteCount,
  ownerOptions,
  pausedLine,
  phaseOptions,
  saveError,
  saveRequest,
  savedResult,
  savedToast,
  titleError,
  uploadCounts,
  uploadingLabel,
} from '@/app/(app)/projects/[id]/_board/taskFormModel';
import { createDeleteQueue } from '@/app/(app)/projects/[id]/undoQueue';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

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
        createdByName: 'Riya Kapoor',
        doneByName: null,
        assignee: {
          id: 9,
          name: 'Neha Arora',
          status: 'active',
          isMember: false,
          role: 'employee',
          avatarUrl: null,
        },
        latestReport: { status: 'blocked', userId: 9, userName: 'Neha Arora', workDate: TODAY },
      },
      TODAY,
      2,
    );
    expect(row).toEqual({
      id: 4,
      title: 'Design the booking screens',
      details: 'Web and phone',
      priority: 'p1',
      status: 'open',
      phase: 'design',
      dueDate: '2026-11-13',
      assignee: { id: 9, name: 'Neha Arora', avatarUrl: null, away: 'Not on the project' },
      latest: 'Neha, today: Blocked',
      latestStatus: 'blocked',
      latestOn: TODAY,
      fileCount: 2,
      createdBy: { id: 7, name: 'Riya Kapoor' },
    });
  });

  it('copes with a task from before phases, for anyone, never reported, with no files', () => {
    const row = toBoardTask({ id: 1, title: 'Old', priority: 'p3', status: 'open' }, TODAY);
    expect(row).toMatchObject({
      phase: null,
      dueDate: null,
      assignee: null,
      latest: null,
      latestOn: null,
      fileCount: 0,
      createdBy: null,
    });
  });
});

describe('the task window: owners and phases', () => {
  const owners = [
    { id: 7, name: 'Riya Kapoor' },
    { id: 9, name: 'Neha Arora' },
  ];

  it('offers anyone, then the people who can be picked, the viewer as (you)', () => {
    expect(ownerOptions(owners, null, 7)).toEqual([
      { value: '', label: 'Anyone on the project' },
      { value: '7', label: 'Riya Kapoor (you)' },
      { value: '9', label: 'Neha Arora' },
    ]);
    expect(ownerOptions(owners, null)[1].label).toBe('Riya Kapoor');
  });

  it('keeps an owner who left the project, and says so', () => {
    const away = { assignee: { id: 12, name: 'Karan Mehta', away: 'Not on the project' } };
    expect(ownerOptions(owners, away).at(-1)).toEqual({
      value: '12',
      label: 'Karan Mehta (not on the project)',
    });
    expect(ownerOptions(owners, { assignee: { id: 9, name: 'Neha Arora' } })).toHaveLength(3);
  });

  it('lists No phase yet only when editing a task that has none', () => {
    expect(phaseOptions(null).map((option) => option.label)).toEqual(
      PROJECT_PHASES.map(({ label }) => label),
    );
    expect(phaseOptions({ phase: null }).at(-1)).toEqual({ value: '', label: 'No phase yet' });
    expect(phaseOptions({ phase: 'design' })).toHaveLength(6);
  });

  it('reads a card and the task window details alike', () => {
    const details = {
      id: 3,
      title: 'Fix the login page',
      details: null,
      priority: 'p1',
      phase: 'design',
      dueDate: null,
      assignee: { id: 9, name: 'Neha Arora', status: 'deactivated', isMember: true },
    };
    expect(editable(details).assignee).toEqual({ id: 9, name: 'Neha Arora', away: 'Deactivated' });
    expect(editable({ ...details, phase: 'old' }).phase).toBeNull();
  });
});

describe('the task window: values and requests', () => {
  const task = editable({
    id: 3,
    title: 'Fix the login page',
    details: 'Steps in the brief',
    priority: 'p2',
    phase: 'design',
    dueDate: '2026-11-25',
    assignee: { id: 9, name: 'Neha Arora', away: null },
  });

  it('presets a new task to the column, else the current phase, else the first', () => {
    const preset = { phase: 'testing', title: 'Go' };
    expect(initialValues({ preset, currentPhase: 'design' })).toEqual({
      title: 'Go',
      details: '',
      owner: '',
      dueDate: '',
      phase: 'testing',
      priority: 'p2',
    });
    expect(initialValues({ currentPhase: 'design' }).phase).toBe('design');
    expect(initialValues({ currentPhase: null }).phase).toBe('requirement_gathering');
    expect(initialValues({ task, currentPhase: 'launch' })).toMatchObject({
      owner: '9',
      phase: 'design',
      details: 'Steps in the brief',
    });
  });

  it('sends everything for a new task, with its held files', () => {
    const values = { ...initialValues({ currentPhase: 'design' }), title: ' Fix it ', owner: '9' };
    expect(createBody(values, ['a'.repeat(32)])).toEqual({
      title: 'Fix it',
      details: null,
      assigneeId: 9,
      phase: 'design',
      dueDate: null,
      priority: 'p2',
      uploadKeys: ['a'.repeat(32)],
    });
  });

  it('sends only what changed for an edit, plus the files added and removed', () => {
    const values = initialValues({ task, currentPhase: 'design' });
    expect(editBody(values, task)).toEqual({});
    expect(editBody({ ...values, details: '', priority: 'p1' }, task)).toEqual({
      details: null,
      priority: 'p1',
    });
    expect(editBody(values, task, { addUploadKeys: ['k1'], removeFileIds: [4] })).toEqual({
      addUploadKeys: ['k1'],
      removeFileIds: [4],
    });
  });

  it("posts a new task, patches an edit, and drops the files when the task's didn't load", () => {
    const values = initialValues({ task, currentPhase: 'design' });
    const files = { readyKeys: ['k1'], removedIds: [4] };
    const [method, path, body] = saveRequest({
      task: null,
      projectId: 5,
      values: { ...values, title: 'New one' },
      ...files,
      attachedError: false,
    });
    expect([method, path, body.title, body.uploadKeys]).toEqual([
      'post',
      '/api/projects/5/tasks',
      'New one',
      ['k1'],
    ]);
    const edit = { task, projectId: 5, values, ...files };
    expect(saveRequest({ ...edit, attachedError: false })).toEqual([
      'patch',
      '/api/project-tasks/3',
      { addUploadKeys: ['k1'], removeFileIds: [4] },
    ]);
    expect(saveRequest({ ...edit, attachedError: true })).toEqual([
      'patch',
      '/api/project-tasks/3',
      {},
    ]);
  });

  it('hands the editor the saved task, whether it was an edit, and the toast of who was told', () => {
    const told = { told: 'person', toldName: 'Simran Kaur' };
    expect(
      savedResult({
        data: { id: 8, ...told },
        task: null,
        body: { phase: 'design', uploadKeys: ['k1'] },
      }),
    ).toEqual({
      id: 8,
      edited: false,
      toast: {
        title: 'Task added to Design.',
        body: 'Simran Kaur gets a notification with the file name.',
      },
    });
    expect(
      savedResult({ data: told, task, body: { addUploadKeys: ['k1', 'k2'], removeFileIds: [4] } }),
    ).toEqual({
      id: 3,
      edited: true,
      toast: { title: 'Changes saved.', body: '2 files added and 1 removed. Simran Kaur is told.' },
    });
    expect(savedResult({ data: null, task, body: { priority: 'p1' } })).toEqual({
      id: 3,
      edited: true,
      toast: { title: 'Changes saved.' },
    });
  });

  it('checks the title and counts the note past 800 characters', () => {
    expect(titleError(' a ')).toBe('Write a title of at least 2 characters.');
    expect(titleError('Ok')).toBeNull();
    expect(noteCount('x'.repeat(800))).toBeNull();
    expect(noteCount('x'.repeat(812))).toBe('812 of 1,000');
  });

  it('puts an error under its field, under Files, or in a toast', () => {
    expect(saveError({ fields: { title: 'Too short' }, message: 'Check' })).toEqual({
      field: 'title',
      files: null,
      message: 'Too short',
    });
    const held = "brief.pdf couldn't be added. Add it again.";
    expect(saveError({ fields: { uploadKeys: held } }).files).toBe(held);
    expect(saveError({ message: 'Offline' })).toEqual({
      field: null,
      files: null,
      message: 'Offline',
    });
  });
});

describe('the task window: what it says', () => {
  it('toasts who was told after adding', () => {
    const vishal = { told: 'person', toldName: 'Vishal Saini' };
    expect(addedToast({ phase: 'development', ...vishal, files: 2 })).toEqual({
      title: 'Task added to Development.',
      body: 'Vishal Saini gets a notification with the 2 file names.',
    });
    expect(addedToast({ phase: 'development', ...vishal }).body).toBe(
      'Vishal Saini gets a notification.',
    );
    expect(addedToast({ phase: 'design', told: 'members', files: 1 }).body).toBe(
      'Everyone on the project gets a notification with the file name.',
    );
    expect(addedToast({ phase: 'design', told: null, files: 2 })).toEqual({
      title: 'Task added to Design.',
    });
  });

  it('toasts what happened to the files after an edit', () => {
    const told = { told: 'person', toldName: 'Simran Kaur' };
    expect(savedToast({ ...told, added: 2 }).body).toBe('2 files added. Simran Kaur is told.');
    expect(savedToast({ ...told, removed: 1 }).body).toBe('1 file removed.');
    expect(savedToast({ ...told, added: 2, removed: 1 }).body).toBe(
      '2 files added and 1 removed. Simran Kaur is told.',
    );
    expect(savedToast({ told: null, added: 1 }).body).toBe('1 file added.');
    expect(savedToast({ told: 'person' })).toEqual({ title: 'Changes saved.' });
  });

  it('counts the files on their way and asks before closing', () => {
    const items = [
      { state: 'uploading', name: 'a.pdf' },
      { state: 'waiting', name: 'b.pdf' },
      { state: 'done', name: 'c.pdf' },
      { state: 'paused', name: 'brief.pdf' },
      { state: 'error', name: 'big.mov' },
    ];
    const counts = uploadCounts(items);
    expect(counts).toMatchObject({ running: 2, unsaved: 4, paused: items[3] });
    expect(uploadingLabel(2)).toBe('Uploading 2 files…');
    expect(closeQuestion(counts)).toBe('4 files are still uploading. Close anyway?');
    expect(closeQuestion({ unsaved: 2, running: 0 })).toBe(
      "2 files aren't saved yet. Close anyway?",
    );
    expect(closeQuestion({ unsaved: 1, running: 0 })).toBe("1 file isn't saved yet. Close anyway?");
    expect(pausedLine('brief.pdf')).toBe(
      "brief.pdf didn't finish uploading. Press Retry or remove it.",
    );
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
