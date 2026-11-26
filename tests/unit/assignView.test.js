// Giving a task to someone (CONTRACT 28, Cards and the card menu; The people window; Every message,
// Toasts and Told bodies): the toast's words and who was told, what the PATCH and its Undo send,
// when Undo is offered, the person laid over a task while its save runs, and a server answer that
// asks for the share confirm (assignView.js, pure); then useAssign.js run as a plain function
// (tests/helpers/hookTree.js): Assign to me with its face swap, focus on the face and Undo, Undo
// only when the earlier person can be picked, "Couldn't change the person" and "Couldn't undo".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findAll, hookState, render, resetHooks } from '../helpers/hookTree.js';

const page = vi.hoisted(() => ({
  patch: null,
  get: null,
  toasts: [],
  swaps: [],
  flashes: [],
  refresh: 0,
  windows: [],
  undos: [],
}));

vi.mock('react', async (original) =>
  (await import('../helpers/hookTree.js')).reactWithHooks(await original()),
);
vi.mock('react-dom', async (original) => ({ ...(await original()), flushSync: (fn) => fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => (page.refresh += 1) }),
}));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => (toast) => page.toasts.push(toast),
}));
vi.mock('@/lib/apiClient', () => ({
  api: { patch: (...args) => page.patch(...args), get: (...args) => page.get(...args) },
}));
vi.mock('@/lib/motion/animate', () => ({ flash: (el) => page.flashes.push(el) }));
vi.mock('@/app/(app)/projects/[id]/_board/PeopleWindow.jsx', () => ({
  default: (props) => {
    page.windows.push(props);
    return null;
  },
}));
vi.mock('@/app/(app)/projects/[id]/_board/MoveTaskDialog.jsx', () => ({ default: () => null }));
vi.mock('@/app/(app)/projects/[id]/UndoToast.jsx', () => ({
  default: (props) => {
    page.undos.push(props);
    return null;
  },
}));
vi.mock('@/app/(app)/projects/[id]/_board/boardMotion.js', () => ({
  swapFace: (card, change) => {
    page.swaps.push(card);
    change();
    return Promise.resolve();
  },
}));

const {
  asksShare,
  assignBody,
  assignToast,
  isViewersTask,
  shownPerson,
  toldText,
  undoBody,
  undoable,
  withPersons,
} = await import('@/app/(app)/projects/[id]/_board/assignView.js');
const { useAssign } = await import('@/app/(app)/projects/[id]/_board/useAssign.js');
const { TaskActionsProvider } =
  await import('@/app/(app)/projects/[id]/_board/TaskActionsProvider.jsx');

const TASK = { id: 8, title: 'Checkout fix before client demo' };
const RIYA = { id: 3, name: 'Riya Kapoor' };
const VISHAL = { id: 21, name: 'Vishal Saini' };

describe('toldText: who a save reached (Told bodies)', () => {
  it('names the person and the earlier person together', () => {
    expect(
      toldText({ told: 'person', toldName: 'Vishal Saini', toldEarlierName: 'Simran Kaur' }),
    ).toBe('Vishal Saini and Simran Kaur get a notification.');
  });

  it('names the person alone, or the earlier person alone', () => {
    expect(toldText({ told: 'person', toldName: 'Vishal Saini', toldEarlierName: null })).toBe(
      'Vishal Saini gets a notification.',
    );
    expect(toldText({ told: null, toldName: null, toldEarlierName: 'Simran Kaur' })).toBe(
      'Simran Kaur gets a notification.',
    );
    expect(toldText({ toldEarlierName: 'Simran Kaur' })).toBe('Simran Kaur gets a notification.');
  });

  it('says everyone on the project, with an earlier non-member when there is one', () => {
    expect(toldText({ told: 'members', toldName: null, toldEarlierName: null })).toBe(
      'Everyone on the project gets a notification.',
    );
    expect(toldText({ told: 'members', toldName: null, toldEarlierName: 'Riya Kapoor' })).toBe(
      'Everyone on the project and Riya Kapoor get a notification.',
    );
  });

  it('says nothing when nobody was told, or a person without a name', () => {
    expect(toldText({ told: null, toldName: null, toldEarlierName: null })).toBeNull();
    expect(toldText({})).toBeNull();
    expect(toldText()).toBeNull();
    expect(toldText({ told: 'person', toldName: null, toldEarlierName: null })).toBeNull();
    expect(toldText({ told: 'person', toldName: '', toldEarlierName: '' })).toBeNull();
  });
});

describe('assignToast', () => {
  it('says the task is yours, with the body from the answer', () => {
    expect(
      assignToast(TASK, RIYA, 3, { told: null, toldName: null, toldEarlierName: 'Simran Kaur' }),
    ).toEqual({
      title: 'Checkout fix before client demo is now yours.',
      body: 'Simran Kaur gets a notification.',
    });
  });

  it("says who it is for now, or anyone on the project, and has no body when nobody's told", () => {
    expect(
      assignToast(TASK, VISHAL, 3, {
        told: 'person',
        toldName: 'Vishal Saini',
        toldEarlierName: 'Simran Kaur',
      }),
    ).toEqual({
      title: 'Checkout fix before client demo is now for Vishal Saini.',
      body: 'Vishal Saini and Simran Kaur get a notification.',
    });
    expect(assignToast(TASK, null, 3, { told: 'members' })).toEqual({
      title: 'Checkout fix before client demo is now for anyone on the project.',
      body: 'Everyone on the project gets a notification.',
    });
    expect(assignToast(TASK, VISHAL, 3, { told: null })).toEqual({
      title: 'Checkout fix before client demo is now for Vishal Saini.',
    });
    expect(assignToast(TASK, { id: '3', name: 'Riya Kapoor' }, 3)).toEqual({
      title: 'Checkout fix before client demo is now yours.',
    });
  });

  it('covers every combination of told, toldName and toldEarlierName', () => {
    const tolds = [null, 'person', 'members'];
    const names = [null, 'Vishal Saini'];
    const earlier = [null, 'Simran Kaur'];
    const seen = new Set();
    for (const told of tolds)
      for (const toldName of names)
        for (const toldEarlierName of earlier) {
          const { body } = assignToast(TASK, VISHAL, 3, { told, toldName, toldEarlierName });
          expect(body ?? null).toBe(toldText({ told, toldName, toldEarlierName }));
          seen.add(body ?? 'none');
        }
    expect([...seen].sort()).toEqual(
      [
        'Everyone on the project and Simran Kaur get a notification.',
        'Everyone on the project gets a notification.',
        'Simran Kaur gets a notification.',
        'Vishal Saini and Simran Kaur get a notification.',
        'Vishal Saini gets a notification.',
        'none',
      ].sort(),
    );
  });
});

describe('what the PATCH and its Undo send', () => {
  it('sends the person, null for anyone, and the confirm with the person it named', () => {
    expect(assignBody(21)).toEqual({ assigneeId: 21 });
    expect(assignBody(null)).toEqual({ assigneeId: null });
    expect(assignBody(undefined)).toEqual({ assigneeId: null });
    expect(assignBody(21, { shareConfirmed: true })).toEqual({
      assigneeId: 21,
      shareConfirmed: true,
      shareWith: 21,
    });
    expect(assignBody(null, { shareConfirmed: true })).toEqual({
      assigneeId: null,
      shareConfirmed: true,
      shareWith: '',
    });
    expect(assignBody(21, { shareConfirmed: true, shareWith: 21 }).shareWith).toBe(21);
    expect(assignBody(21, { shareConfirmed: false, shareWith: 21 })).toEqual({ assigneeId: 21 });
  });

  it('always confirms the share on an Undo (the earlier person could open the files)', () => {
    expect(undoBody(21)).toEqual({ assigneeId: 21, shareConfirmed: true, shareWith: 21 });
    expect(undoBody(null)).toEqual({ assigneeId: null, shareConfirmed: true, shareWith: '' });
  });
});

describe('Undo is offered only when the earlier person can be picked now', () => {
  const options = [
    { id: 3, kind: 'me' },
    { id: 4, kind: 'pm' },
    { id: 21, kind: 'member' },
  ];

  it('offers it for anyone on the project and for a row of head.options', () => {
    expect(undoable(null, options)).toBe(true);
    expect(undoable(undefined, options)).toBe(true);
    expect(undoable(21, options)).toBe(true);
    expect(undoable('3', options)).toBe(true);
  });

  it('never for someone away or an Admin who is not on the project and not the viewer', () => {
    expect(undoable(40, options)).toBe(false);
    expect(undoable(1, options)).toBe(false);
    expect(undoable(21, [])).toBe(false);
  });
});

describe('the person shown while the save runs', () => {
  it('draws the picked person as a card draws an assignee', () => {
    expect(
      shownPerson(
        { id: 21, name: 'Vishal Saini', initials: 'VS', avatarUrl: null, role: 'employee' },
        3,
      ),
    ).toEqual({
      id: 21,
      name: 'Vishal Saini',
      avatarUrl: null,
      initials: 'VS',
      role: 'employee',
      status: 'active',
      away: null,
      isViewer: false,
    });
    expect(shownPerson({ id: 3, name: 'Riya Kapoor', role: 'pm' }, 3).isViewer).toBe(true);
    expect(shownPerson({ id: 9, name: 'Kavya', status: 'deactivated' }, 3).away).toBe(
      'Deactivated',
    );
    expect(shownPerson(null, 3)).toBeNull();
  });

  it('lays the persons on their way over the tasks, and keeps the array when nothing changes', () => {
    const tasks = [
      { id: 8, title: 'A', assignee: { id: 5, name: 'Simran Kaur' } },
      { id: 9, title: 'B', assignee: null },
    ];
    const shown = new Map([
      [8, { assignee: { id: 3, name: 'Riya Kapoor' } }],
      [9, { assignee: null }],
    ]);
    const next = withPersons(tasks, shown);
    expect(next).not.toBe(tasks);
    expect(next[0].assignee).toEqual({ id: 3, name: 'Riya Kapoor' });
    expect(next[1]).toBe(tasks[1]);
    expect(withPersons(tasks, new Map())).toBe(tasks);
    expect(withPersons(tasks, new Map([[9, { assignee: null }]]))).toBe(tasks);
    expect(withPersons(tasks, null)).toBe(tasks);
    const toAnyone = withPersons(tasks, new Map([[8, { assignee: null }]]));
    expect(toAnyone[0].assignee).toBeNull();
  });
});

describe('small rules', () => {
  it("knows the viewer's own task", () => {
    expect(isViewersTask({ assignee: { id: 3, isViewer: true } }, 99)).toBe(true);
    expect(isViewersTask({ assignee: { id: 3, isViewer: false } }, 3)).toBe(false);
    expect(isViewersTask({ assignee: { id: 3 } }, 3)).toBe(true);
    expect(isViewersTask({ assignee: { id: 3 } }, '3')).toBe(true);
    expect(isViewersTask({ assignee: { id: 3 } }, undefined)).toBe(false);
    expect(isViewersTask({ assignee: null }, 3)).toBe(false);
  });

  it('reads a server answer that asks for the share confirm', () => {
    const ask = { fields: { shareConfirmed: 'This task has a file only for PM and Admins.' } };
    expect(asksShare(ask)).toBe(true);
    expect(asksShare({ fields: { assigneeId: 'Pick someone.' } })).toBe(false);
    expect(asksShare(null)).toBe(false);
  });
});

describe('useAssign: Assign to me, the people window picks and Undo', () => {
  const RIYA_OPTION = { id: 3, name: 'Riya Kapoor', role: 'pm', status: 'active', kind: 'me' };
  const SIMRAN_OPTION = { id: 5, name: 'Simran Kaur', role: 'employee', status: 'active' };
  const OPTIONS = [RIYA_OPTION, SIMRAN_OPTION];
  const SIMRAN = { id: 5, name: 'Simran Kaur', role: 'employee', status: 'active', away: null };
  const CARD_TASK = { id: 8, title: 'Checkout fix before client demo', assignee: SIMRAN };
  const FAILED = 'Pick someone who is on this project, or anyone on the project.';
  let face;
  let card;

  // The hook runs as a plain function over hookTree's store (called through a variable, so the
  // hooks lint rule doesn't take the test helper for a component).
  const assignHook = useAssign;
  const run = () => {
    hookState.index = 0;
    return assignHook({ options: OPTIONS, viewer: RIYA_OPTION });
  };
  const shownFor = (hook) => hook.apply([CARD_TASK])[0].assignee;

  beforeEach(() => {
    resetHooks();
    Object.assign(page, { toasts: [], swaps: [], flashes: [], refresh: 0 });
    face = { focus: vi.fn() };
    card = { querySelector: (selector) => (selector === '[data-face-button]' ? face : null) };
    vi.stubGlobal('requestAnimationFrame', (fn) => fn());
    vi.stubGlobal('document', {
      querySelector: (selector) => (selector === '[data-flip="card:8"]' ? card : null),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('swaps the face, focuses it, saves, and offers Undo with who was told', async () => {
    page.patch = vi.fn().mockResolvedValue({
      data: { id: 8, told: null, toldName: null, toldEarlierName: 'Simran Kaur' },
    });
    await run().take(CARD_TASK, { origin: { closest: () => null } });
    expect(page.swaps).toEqual([card]);
    expect(face.focus).toHaveBeenCalled();
    expect(page.patch).toHaveBeenCalledWith('/api/project-tasks/8', { assigneeId: 3 });
    const hook = run();
    expect(shownFor(hook)).toMatchObject({ id: 3, name: 'Riya Kapoor', isViewer: true });
    expect(hook.undo.pending).toMatchObject({
      title: 'Checkout fix before client demo is now yours.',
      body: 'Simran Kaur gets a notification.',
    });
    expect(page.refresh).toBe(1);
    expect(page.toasts).toEqual([]);
  });

  it('gives the task back with Undo (shareConfirmed, shareWith), silently', async () => {
    page.patch = vi.fn().mockResolvedValue({ data: { id: 8 } });
    await run().take(CARD_TASK, {});
    await run().undo.run();
    expect(page.patch).toHaveBeenLastCalledWith('/api/project-tasks/8', {
      assigneeId: 5,
      shareConfirmed: true,
      shareWith: 5,
    });
    const hook = run();
    expect(hook.undo.pending).toBeNull();
    expect(shownFor(hook)).toMatchObject({ id: 5, name: 'Simran Kaur' });
    expect(page.toasts).toEqual([]);
    expect(page.swaps).toHaveLength(2);
  });

  it('offers no Undo when the earlier person is away (a plain toast instead)', async () => {
    page.patch = vi.fn().mockResolvedValue({ data: { told: null } });
    const away = { id: 40, name: 'Kavya Reddy', status: 'active', away: 'Not on the project' };
    await run().take({ ...CARD_TASK, assignee: away }, {});
    expect(run().undo.pending).toBeNull();
    expect(page.toasts).toEqual([{ title: 'Checkout fix before client demo is now yours.' }]);
  });

  it('puts the face back with "Couldn\'t change the person" when the save fails', async () => {
    page.patch = vi.fn().mockRejectedValue(new Error(FAILED));
    expect(await run().take(CARD_TASK, {})).toBeNull();
    expect(shownFor(run())).toBe(SIMRAN);
    expect(page.toasts).toEqual([
      { title: "Couldn't change the person", body: FAILED, tone: 'error' },
    ]);
  });

  it('keeps the new person with "Couldn\'t undo" when the Undo fails', async () => {
    page.patch = vi
      .fn()
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error(FAILED));
    await run().take(CARD_TASK, {});
    await run().undo.run();
    expect(shownFor(run())).toMatchObject({ id: 3 });
    expect(page.toasts).toEqual([{ title: "Couldn't undo", body: FAILED, tone: 'error' }]);
  });

  it('hands a server answer that asks for the share confirm to the people window', async () => {
    const ask = Object.assign(new Error('Confirm to share it.'), {
      fields: { shareConfirmed: 'This task has a file only for PM and Admins.' },
    });
    page.patch = vi.fn().mockRejectedValue(ask);
    const onShareAsk = vi.fn();
    await run().assign(CARD_TASK, null, { onShareAsk });
    expect(onShareAsk).toHaveBeenCalledWith(ask);
    expect(page.toasts).toEqual([]);
    expect(shownFor(run())).toBe(SIMRAN);
  });

  it('only flashes a Table row, and changes nothing when the person is the same', async () => {
    // The table's copy is hidden (a phone): the shown copy of the row flashes.
    const shown = (on) => ({ isConnected: true, getClientRects: () => (on ? [{}] : []) });
    const row = { id: 'row 8', ...shown(true) };
    const rows = (selector) => (selector === '[data-flip="row:8"]' ? [shown(false), row] : []);
    vi.stubGlobal('document', {
      querySelector: (selector) => rows(selector)[0] ?? null,
      querySelectorAll: rows,
    });
    page.patch = vi.fn().mockResolvedValue({ data: {} });
    await run().assign(CARD_TASK, null);
    expect(page.swaps).toEqual([]);
    expect(page.flashes).toEqual([row]);
    expect(page.patch).toHaveBeenCalledWith('/api/project-tasks/8', { assigneeId: null });
    expect(run().undo.pending.title).toBe(
      'Checkout fix before client demo is now for anyone on the project.',
    );
    page.patch.mockClear();
    expect(await run().assign(CARD_TASK, 5)).toBe(CARD_TASK);
    expect(page.patch).not.toHaveBeenCalled();
  });
});

describe("TaskActionsProvider: the page's people window and its picks", () => {
  const OPTIONS = [
    { id: 3, name: 'Riya Kapoor', role: 'pm', status: 'active', kind: 'me' },
    { id: 21, name: 'Vishal Saini', role: 'employee', status: 'active', kind: 'member' },
  ];
  const SIMRAN = { id: 5, name: 'Simran Kaur', role: 'employee', status: 'active', away: null };
  const SNEHA = { id: 7, name: 'Sneha Patil', role: 'employee', status: 'active', isMember: true };
  const CARD_TASK = {
    id: 8,
    title: 'Checkout fix before client demo',
    assignee: SIMRAN,
    privateLinkCount: 1,
  };
  const STALE = 'This task is now for someone else. Check who it is for and confirm again.';
  const asking = () =>
    Object.assign(new Error(STALE), { fields: { shareConfirmed: STALE }, status: 400 });
  const props = {
    projectId: 12,
    project: { id: 12, pmId: 3 },
    options: OPTIONS,
    viewerId: 3,
    viewerName: 'Riya Kapoor',
    children: null,
  };
  const draw = () => render(TaskActionsProvider, props);
  const actionsOf = (tree) => findAll(tree, (p) => p.value?.openPeople)[0].props.value;
  const lastWindow = () => page.windows[page.windows.length - 1];
  const settle = () => new Promise((done) => setTimeout(done, 0));

  beforeEach(() => {
    resetHooks();
    Object.assign(page, {
      toasts: [],
      swaps: [],
      flashes: [],
      refresh: 0,
      windows: [],
      undos: [],
    });
    vi.stubGlobal('requestAnimationFrame', (fn) => fn());
    page.get = vi.fn().mockResolvedValue({
      data: {
        id: 8,
        title: 'Checkout fix before client demo',
        assignee: SNEHA,
        privateLinkCount: 2,
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens the window for one task and saves a plain pick at once (it closes)', async () => {
    page.patch = vi
      .fn()
      .mockResolvedValue({ data: { id: 8, told: 'person', toldName: 'Vishal Saini' } });
    actionsOf(draw()).openPeople({ tasks: [CARD_TASK], anchor: null });
    draw();
    const window = lastWindow();
    expect(window.tasks).toEqual([CARD_TASK]);
    expect(window.project).toEqual({ id: 12, pmId: 3 });
    expect(window.onPick(21, { shareConfirmed: false, tasks: [CARD_TASK] })).toBeUndefined();
    await settle();
    expect(page.patch).toHaveBeenCalledWith('/api/project-tasks/8', { assigneeId: 21 });
  });

  it('waits on "Give and share" and hands back the task read again when the server asks again', async () => {
    page.patch = vi.fn().mockRejectedValue(asking());
    actionsOf(draw()).openPeople({ tasks: [CARD_TASK], anchor: null });
    draw();
    const result = lastWindow().onPick(21, { shareConfirmed: true, tasks: [CARD_TASK] });
    await expect(result).rejects.toMatchObject({
      fields: { shareConfirmed: STALE },
      tasks: [{ id: 8, assignee: SNEHA, privateLinkCount: 2 }],
    });
    expect(page.patch).toHaveBeenCalledWith('/api/project-tasks/8', {
      assigneeId: 21,
      shareConfirmed: true,
      shareWith: 21,
    });
    expect(page.get).toHaveBeenCalledWith('/api/project-tasks/8');
    expect(page.toasts).toEqual([]);
  });

  it('resolves "Give and share" once the save is done (Anyone sends shareWith "")', async () => {
    page.patch = vi.fn().mockResolvedValue({ data: { id: 8, told: 'members' } });
    actionsOf(draw()).openPeople({ tasks: [CARD_TASK], anchor: null });
    draw();
    await expect(
      lastWindow().onPick(null, { shareConfirmed: true, tasks: [CARD_TASK] }),
    ).resolves.toBeUndefined();
    expect(page.patch).toHaveBeenCalledWith('/api/project-tasks/8', {
      assigneeId: null,
      shareConfirmed: true,
      shareWith: '',
    });
  });

  it('opens the window again on the confirm when a plain pick meets a stale count', async () => {
    page.patch = vi.fn().mockRejectedValue(asking());
    actionsOf(draw()).openPeople({ tasks: [CARD_TASK], anchor: null });
    draw();
    lastWindow().onPick(21, { shareConfirmed: false, tasks: [CARD_TASK] });
    await settle();
    await settle();
    draw();
    expect(lastWindow().ask).toEqual({ assigneeId: 21 });
    expect(lastWindow().tasks).toEqual([
      expect.objectContaining({ id: 8, assignee: SNEHA, privateLinkCount: 2 }),
    ]);
    expect(page.toasts).toEqual([]);
  });

  it('draws who was told under the Undo toast after Assign to me', async () => {
    page.patch = vi.fn().mockResolvedValue({
      data: { id: 8, told: null, toldName: null, toldEarlierName: 'Vishal Saini' },
    });
    const vishal = { id: 21, name: 'Vishal Saini', role: 'employee', status: 'active', away: null };
    await actionsOf(draw()).take({ ...CARD_TASK, assignee: vishal }, {});
    draw();
    // UndoToast draws the body on the line under the title (tests/unit/undoToastBody.test.js).
    const { pending } = page.undos[page.undos.length - 1];
    expect(pending).toMatchObject({
      title: 'Checkout fix before client demo is now yours.',
      body: 'Vishal Saini gets a notification.',
    });
  });

  it("gives the bulk bar's own pick to its window", () => {
    const onPick = vi.fn();
    actionsOf(draw()).openPeople({ tasks: [CARD_TASK, { ...CARD_TASK, id: 9 }], onPick });
    draw();
    expect(lastWindow().onPick).toBe(onPick);
  });
});
