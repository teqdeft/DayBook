// Today's to-do card's first state on the server (CONTRACT 24, todayTodo.js): only for people who
// write reports, read with the timer state the page already has, the picker as it is (or empty),
// the priority tasks by project with "For you", and Today still opening when the read fails.
import { afterEach, describe, expect, it, vi } from 'vitest';

const getTodo = vi.hoisted(() => vi.fn());
vi.mock('@/modules/reports', () => ({ reports: { getTodo } }));

const { loadTodo, priorityByProject } = await import('@/app/(app)/today/todayTodo.js');

const EMPLOYEE = { id: 7, role: 'employee', status: 'active' };
const PM = { id: 8, role: 'pm', status: 'active' };
const PICKER = { urgent: [], mine: [{ id: 5, name: 'Studio Ubique' }], others: [], requests: [] };
const ROWS = [
  { id: 41, projectId: 5, title: 'Update the sitemap', priority: 'p3', assigneeId: 7 },
  { id: 42, project: { id: 5 }, title: 'Write the FAQ', priority: 'p2', assigneeId: null },
  { id: 43, projectId: 12, title: 'Fix the form', priority: 'p1', assigneeId: 9 },
  { id: 44, title: 'No project', priority: 'p1' },
];

afterEach(() => getTodo.mockReset());

describe('the to-do card on the server', () => {
  it('groups the priority tasks by project, saying which are for the person', () => {
    expect(priorityByProject(ROWS, 7)).toEqual({
      5: [
        { id: 41, title: 'Update the sitemap', priority: 'p3', forYou: true },
        { id: 42, title: 'Write the FAQ', priority: 'p2', forYou: false },
      ],
      12: [{ id: 43, title: 'Fix the form', priority: 'p1', forYou: false }],
    });
    expect(priorityByProject(undefined, 7)).toEqual({});
  });

  it('reads the to-do with the timer state the page has', async () => {
    const state = { running: null, canUse: true };
    getTodo.mockResolvedValueOnce({ total: 0, groups: [] });
    const card = await loadTodo({
      user: EMPLOYEE,
      timerParts: Promise.resolve({ state }),
      pickerParts: Promise.resolve({ picker: PICKER, tasks: ROWS }),
    });
    expect(getTodo).toHaveBeenCalledWith({ user: EMPLOYEE, timerState: state });
    expect(card).toEqual({
      initialTodo: { total: 0, groups: [] },
      picker: PICKER,
      priority: priorityByProject(ROWS, 7),
    });
  });

  it('lets getTodo read the timers itself when the page has none, with an empty picker', async () => {
    getTodo.mockResolvedValueOnce({ total: 0, groups: [] });
    const card = await loadTodo({
      user: EMPLOYEE,
      timerParts: Promise.resolve({ state: null }),
      pickerParts: Promise.resolve({ picker: null, tasks: [] }),
    });
    expect(getTodo).toHaveBeenCalledWith({ user: EMPLOYEE, timerState: undefined });
    expect(card.picker).toEqual({ urgent: [], mine: [], others: [], requests: [] });
  });

  it('is null without report.self, and when the to-do cannot be read', async () => {
    const parts = {
      timerParts: Promise.resolve({ state: null }),
      pickerParts: Promise.resolve({ picker: PICKER, tasks: [] }),
    };
    expect(await loadTodo({ user: PM, ...parts })).toBeNull();
    expect(getTodo).not.toHaveBeenCalled();
    getTodo.mockRejectedValueOnce(new Error('database down'));
    expect(await loadTodo({ user: EMPLOYEE, ...parts })).toBeNull();
  });
});
