// The people window (CONTRACT 28, The people window; Every message, People window and Share confirm
// (people window)): its rows for a PM and for an Admin who isn't on the project, the search, every
// share confirm text, when the confirm shows, "Give and share" sending `shareConfirmed: true`, and
// a server answer `fields.shareConfirmed` turning the foot (also the bulk bar's window) into the
// confirm. The components run as plain functions (tests/helpers/hookTree.js); peopleView.js is pure.
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findAll, render, resetHooks, textOf } from '../helpers/hookTree.js';

vi.mock('react', async (original) =>
  (await import('../helpers/hookTree.js')).reactWithHooks(await original()),
);
vi.mock('@/components/Dialog', () => ({
  default: ({ open, title, footer, children }) =>
    open === false
      ? null
      : createElement('section', { role: 'dialog', 'data-title': title }, children, footer),
}));
vi.mock('@/components/files/ShareConfirm', () => ({
  default: ({ text, confirmLabel, onBack, onConfirm, busy }) =>
    createElement(
      'div',
      { 'data-share': text },
      createElement('button', { onClick: onBack }, 'Back'),
      createElement('button', { onClick: onConfirm, 'data-busy': busy }, confirmLabel),
    ),
}));
vi.mock('@/app/(app)/projects/[id]/_board/PeoplePopover.jsx', () => ({
  default: ({ children }) => createElement('div', { 'data-popover': '' }, children),
}));

const { default: PeopleWindow, peopleTitle } =
  await import('@/app/(app)/projects/[id]/_board/PeopleWindow.jsx');
const { filterRows, peopleRows, peopleShareText, shareNeeded } =
  await import('@/app/(app)/projects/[id]/_board/peopleView.js');

const PROJECT = { id: 12, pmId: 3 };
const opt = (id, name, kind, extra = {}) => ({
  id,
  name,
  role: 'employee',
  status: 'active',
  kind,
  openHere: 0,
  ...extra,
});
const RIYA_ME = opt(3, 'Riya Kapoor', 'me', { role: 'pm', openHere: 3 });
const RIYA_PM = opt(3, 'Riya Kapoor', 'pm', { role: 'pm', openHere: 3 });
const SIMRAN = opt(5, 'Simran Kaur', 'member', {
  designation: 'Full stack developer',
  openHere: 4,
});
const VISHAL = opt(21, 'Vishal Saini', 'member', { designation: 'Frontend developer' });
const SNEHA = opt(7, 'Sneha Patil', 'member', { designation: 'QA engineer', openHere: 1 });
const MEERA = opt(30, 'Meera Pillai', 'member', { role: 'admin', designation: null });
const ARVIND_ME = opt(1, 'Arvind Menon', 'me', { role: 'admin' });
const PM_OPTIONS = [RIYA_ME, SNEHA, SIMRAN, VISHAL];
const ADMIN_OPTIONS = [ARVIND_ME, RIYA_PM, SIMRAN, SNEHA];

const task = (id, assignee = null, extra = {}) => ({
  id,
  title: `Task ${id}`,
  status: 'open',
  phase: 'development',
  assignee,
  privateLinkCount: 0,
  ...extra,
});
const SIMRAN_P = { id: 5, name: 'Simran Kaur', role: 'employee', status: 'active', away: null };

describe('the rows', () => {
  it("for the PM: Me first, Anyone, then the members A to Z with each one's line", () => {
    const rows = peopleRows(PM_OPTIONS, task(8, SIMRAN_P), 3);
    expect(rows.map((row) => [row.name, row.sub, row.checked])).toEqual([
      ['Me (Riya Kapoor)', 'Project manager · 3 open here', false],
      ['Anyone on the project', 'Everyone on the project sees it', false],
      ['Simran Kaur', 'Full stack developer · 4 open here', true],
      ['Sneha Patil', 'QA engineer · 1 open here', false],
      ['Vishal Saini', 'Frontend developer · 0 open here', false],
    ]);
  });

  it('for an Admin not on the project: Me (Admin), Anyone, the PM, the members', () => {
    const rows = peopleRows([...ADMIN_OPTIONS, MEERA], task(8, null), 1);
    expect(rows.map((row) => [row.name, row.sub])).toEqual([
      ['Me (Arvind Menon)', 'Admin · 0 open here'],
      ['Anyone on the project', 'Everyone on the project sees it'],
      ['Riya Kapoor', 'Project manager · 3 open here'],
      ['Meera Pillai', 'Admin · 0 open here'],
      ['Simran Kaur', 'Full stack developer · 4 open here'],
      ['Sneha Patil', 'QA engineer · 1 open here'],
    ]);
    expect(rows[1].checked).toBe(true);
  });

  it('adds an away current person last, checked and disabled', () => {
    const away = { id: 40, name: 'Kavya Reddy', status: 'active', isMember: false };
    const last = peopleRows(PM_OPTIONS, task(43, away), 3).at(-1);
    expect(last).toMatchObject({ name: 'Kavya Reddy', sub: 'Not on the project' });
    expect(last).toMatchObject({ checked: true, disabled: true });
    const gone = { id: 41, name: 'Ravi', status: 'deactivated', away: 'Deactivated' };
    expect(peopleRows(PM_OPTIONS, task(44, gone), 3).at(-1).sub).toBe('Deactivated');
  });

  it("shows the CEO's task to the PM with the CEO last and checked (Admin, can be kept)", () => {
    const ceo = { id: 1, name: 'Arvind Menon', role: 'admin', status: 'active', away: null };
    const rows = peopleRows(PM_OPTIONS, task(8, ceo), 3);
    expect(rows.at(-1)).toMatchObject({ name: 'Arvind Menon', sub: 'Admin', checked: true });
    expect(rows.at(-1).disabled).toBe(false);
    expect(rows.filter((row) => row.checked)).toHaveLength(1);
  });

  it('checks nothing for several tasks, and finds people by name', () => {
    const rows = peopleRows(PM_OPTIONS, null, 3);
    expect(rows.some((row) => row.checked)).toBe(false);
    expect(filterRows(rows, 'SIM').map((row) => row.name)).toEqual(['Simran Kaur']);
    expect(filterRows(rows, ' riya ').map((row) => row.name)).toEqual(['Me (Riya Kapoor)']);
    expect(filterRows(rows, 'zz')).toEqual([]);
    expect(filterRows(rows, '')).toBe(rows);
  });
});

describe('the share confirm texts (Every message)', () => {
  const linked = (id, n, who = null) => task(id, who, { privateLinkCount: n });

  it('for one task, to a person or to anyone', () => {
    expect(peopleShareText([linked(8, 1)], 'Simran Kaur', 5)).toBe(
      'This task has a file only for PM and Admins. Simran Kaur will be able to open it from this task.',
    );
    expect(peopleShareText([linked(8, 2)], 'Simran Kaur', 5)).toBe(
      'This task has 2 files only for PM and Admins. Simran Kaur will be able to open them from this task.',
    );
    expect(peopleShareText([linked(8, 1, SIMRAN_P)], null, null)).toBe(
      'This task has a file only for PM and Admins. Everyone on the project will be able to open it from this task.',
    );
    expect(peopleShareText([linked(8, 2, SIMRAN_P)], null, null)).toBe(
      'This task has 2 files only for PM and Admins. Everyone on the project will be able to open them from this task.',
    );
  });

  it('for several tasks: one of them, then two or more', () => {
    const tasks = [linked(9, 0), linked(41, 1)];
    expect(peopleShareText(tasks, 'Sneha Patil', 7)).toBe(
      '1 of these tasks has a file only for PM and Admins. Sneha Patil will be able to open it from that task.',
    );
    expect(peopleShareText([linked(9, 0), linked(41, 2)], 'Sneha Patil', 7)).toBe(
      '1 of these tasks has 2 files only for PM and Admins. Sneha Patil will be able to open them from that task.',
    );
    expect(peopleShareText([linked(9, 1), linked(41, 2)], 'Sneha Patil', 7)).toBe(
      '2 of these tasks have files only for PM and Admins. Sneha Patil will be able to open them from those tasks.',
    );
    expect(peopleShareText([linked(9, 1, SIMRAN_P), linked(41, 2, SIMRAN_P)], null, null)).toBe(
      '2 of these tasks have files only for PM and Admins. Everyone on the project will be able to open them from those tasks.',
    );
    expect(peopleShareText([linked(9, 1), linked(41, 0)], null, null)).toBe(
      '1 of these tasks has a file only for PM and Admins. Everyone on the project will be able to open it from that task.',
    );
  });

  it('leaves out a task already for the picked person', () => {
    const sneha = { id: 7, name: 'Sneha Patil', role: 'employee', status: 'active' };
    const tasks = [linked(9, 1, sneha), linked(41, 1)];
    expect(peopleShareText(tasks, 'Sneha Patil', 7)).toMatch(/^1 of these tasks has a file/);
  });

  it('asks only when a task with a private link goes to someone who is not a manager', () => {
    const one = [linked(8, 1, SIMRAN_P)];
    const employee = { id: 21, role: 'employee', status: 'active' };
    expect(shareNeeded(one, employee, PROJECT)).toBe(true);
    expect(shareNeeded(one, null, PROJECT)).toBe(true);
    expect(shareNeeded(one, { id: 3, role: 'pm', status: 'active' }, PROJECT)).toBe(false);
    expect(shareNeeded(one, { id: 30, role: 'admin', status: 'active' }, PROJECT)).toBe(false);
    expect(shareNeeded(one, { id: 30, role: 'admin', status: 'deactivated' }, PROJECT)).toBe(true);
    expect(shareNeeded([linked(8, 0)], employee, PROJECT)).toBe(false);
    expect(shareNeeded([linked(8, 1, { ...employee, name: 'V' })], employee, PROJECT)).toBe(false);
  });
});

/** Renders the window; `onPick` records its calls. */
function show(props) {
  return render(PeopleWindow, {
    options: PM_OPTIONS,
    viewerId: 3,
    project: PROJECT,
    onClose: vi.fn(),
    onPick: vi.fn(),
    ...props,
  });
}
const rowOf = (tree, key) => findAll(tree, (p) => p['data-person'] === key)[0];
const buttonNamed = (tree, words) =>
  findAll(tree, (p) => typeof p.onClick === 'function').find((el) => textOf(el) === words);

describe('the window', () => {
  beforeEach(() => {
    resetHooks();
    vi.stubGlobal('requestAnimationFrame', (fn) => fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is titled by the task, or "Give 2 tasks to" for the bulk bar, with Cancel', () => {
    expect(peopleTitle([task(8)])).toBe('Assign Task 8');
    expect(peopleTitle([task(9), task(41)])).toBe('Give 2 tasks to');
    const tree = show({ tasks: [task(9), task(41)] });
    expect(findAll(tree, (p) => p.role === 'dialog')[0].props['data-title']).toBe(
      'Give 2 tasks to',
    );
    expect(buttonNamed(tree, 'Cancel')).toBeTruthy();
    expect(textOf(tree)).toContain('Find a person');
  });

  it('draws "No one matches." when the search finds nobody', () => {
    let tree = show({ tasks: [task(8)] });
    findAll(tree, (p) => p.placeholder === 'Find a person')[0].props.onChange({
      target: { value: 'zz' },
    });
    tree = show({ tasks: [task(8)] });
    expect(textOf(tree)).toContain('No one matches.');
    expect(findAll(tree, (p) => p['data-person'])).toHaveLength(0);
  });

  it('presses the current person and closes without a save when it is picked again', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const tree = show({ tasks: [task(8, SIMRAN_P)], onPick, onClose });
    expect(rowOf(tree, '5').props['aria-pressed']).toBe(true);
    expect(rowOf(tree, '21').props['aria-pressed']).toBe(false);
    rowOf(tree, '5').props.onClick();
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith({ picked: false });
  });

  it('saves at once and closes when no share is needed (the PM on a task with a private file)', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const linked = task(8, SIMRAN_P, { privateLinkCount: 1 });
    show({ tasks: [linked], onPick, onClose });
    const tree = show({ tasks: [linked], onPick, onClose });
    rowOf(tree, '3').props.onClick();
    expect(onPick).toHaveBeenCalledWith(3, { shareConfirmed: false, tasks: [linked] });
    expect(onClose).toHaveBeenCalledWith({ picked: true });
  });

  it('turns the foot into the share confirm first, and "Give and share" confirms it', () => {
    const onPick = vi.fn();
    const linked = task(8, SIMRAN_P, { privateLinkCount: 1 });
    let tree = show({ tasks: [linked], onPick });
    rowOf(tree, '21').props.onClick();
    expect(onPick).not.toHaveBeenCalled();
    tree = show({ tasks: [linked], onPick });
    const confirm = findAll(tree, (p) => p['data-share'])[0];
    expect(confirm.props['data-share']).toBe(
      'This task has a file only for PM and Admins. Vishal Saini will be able to open it from this task.',
    );
    expect(buttonNamed(tree, 'Cancel')).toBeUndefined();
    buttonNamed(tree, 'Give and share').props.onClick();
    expect(onPick).toHaveBeenCalledWith(21, { shareConfirmed: true, tasks: [linked] });
  });

  it('goes back to the list with Back', () => {
    const linked = task(8, SIMRAN_P, { privateLinkCount: 2 });
    let tree = show({ tasks: [linked] });
    rowOf(tree, 'anyone').props.onClick();
    tree = show({ tasks: [linked] });
    expect(findAll(tree, (p) => p['data-share'])[0].props['data-share']).toContain(
      'Everyone on the project will be able to open them from this task.',
    );
    buttonNamed(tree, 'Back').props.onClick();
    tree = show({ tasks: [linked] });
    expect(findAll(tree, (p) => p['data-share'])).toHaveLength(0);
    expect(buttonNamed(tree, 'Cancel')).toBeTruthy();
  });

  it('opens straight in the confirm when the server asked for it (a stale count)', () => {
    const tree = show({ tasks: [task(8, null, { privateLinkCount: 1 })], ask: { assigneeId: 7 } });
    expect(findAll(tree, (p) => p['data-share'])[0].props['data-share']).toBe(
      'This task has a file only for PM and Admins. Sneha Patil will be able to open it from this task.',
    );
  });

  it("turns the bulk bar's window into the confirm with the tasks read again, and stays open", async () => {
    const fresh = [task(9, null, { privateLinkCount: 1 }), task(41)];
    const ask = Object.assign(new Error('A task you picked has a file only for PM and Admins.'), {
      fields: {
        shareConfirmed:
          'A task you picked has a file only for PM and Admins. Confirm to share it with the new person.',
      },
      tasks: fresh,
    });
    const onPick = vi.fn().mockRejectedValueOnce(ask).mockResolvedValueOnce({});
    const onClose = vi.fn();
    const tasks = [task(9), task(41)];
    let tree = show({ tasks, onPick, onClose });
    rowOf(tree, '7').props.onClick();
    tree = show({ tasks, onPick, onClose });
    expect(rowOf(tree, '7').props['aria-busy']).toBe(true);
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    await new Promise((done) => setTimeout(done, 0));
    tree = show({ tasks, onPick, onClose });
    expect(onClose).not.toHaveBeenCalled();
    expect(findAll(tree, (p) => p['data-share'])[0].props['data-share']).toBe(
      '1 of these tasks has a file only for PM and Admins. Sneha Patil will be able to open it from that task.',
    );
    buttonNamed(tree, 'Give and share').props.onClick();
    expect(onPick).toHaveBeenLastCalledWith(7, { shareConfirmed: true, tasks: fresh });
    await new Promise((done) => setTimeout(done, 0));
    expect(onClose).toHaveBeenCalledWith({ picked: true });
  });

  it("shows the server's own words when the tasks couldn't be read again", async () => {
    const words =
      'A task you picked has a file only for PM and Admins. Confirm to share it with the new person.';
    const ask = Object.assign(new Error(words), { fields: { shareConfirmed: words } });
    const onPick = vi.fn().mockRejectedValueOnce(ask).mockResolvedValueOnce({});
    const tasks = [task(9), task(41)];
    let tree = show({ tasks, onPick });
    rowOf(tree, '7').props.onClick();
    await new Promise((done) => setTimeout(done, 0));
    tree = show({ tasks, onPick });
    expect(findAll(tree, (p) => p['data-share'])[0].props['data-share']).toBe(words);
    buttonNamed(tree, 'Give and share').props.onClick();
    expect(onPick).toHaveBeenLastCalledWith(7, { shareConfirmed: true, tasks });
  });

  it('waits on "Give and share", and asks again with the task read again when the server does', async () => {
    const linked = task(8, SIMRAN_P, { privateLinkCount: 1 });
    const fresh = task(8, { ...SIMRAN_P, id: 7, name: 'Sneha Patil' }, { privateLinkCount: 2 });
    const again = Object.assign(new Error('This task is now for someone else.'), {
      fields: {
        shareConfirmed: 'This task is now for someone else. Check who it is for and confirm again.',
      },
      tasks: [fresh],
    });
    const onPick = vi.fn().mockRejectedValueOnce(again).mockResolvedValueOnce({});
    const onClose = vi.fn();
    let tree = show({ tasks: [linked], onPick, onClose });
    rowOf(tree, '21').props.onClick();
    tree = show({ tasks: [linked], onPick, onClose });
    buttonNamed(tree, 'Give and share').props.onClick();
    tree = show({ tasks: [linked], onPick, onClose });
    expect(buttonNamed(tree, 'Give and share').props['data-busy']).toBe(true);
    await new Promise((done) => setTimeout(done, 0));
    tree = show({ tasks: [linked], onPick, onClose });
    expect(onClose).not.toHaveBeenCalled();
    expect(findAll(tree, (p) => p['data-share'])[0].props['data-share']).toBe(
      'This task has 2 files only for PM and Admins. Vishal Saini will be able to open them from this task.',
    );
    expect(rowOf(tree, '7').props['aria-pressed']).toBe(true);
    buttonNamed(tree, 'Give and share').props.onClick();
    expect(onPick).toHaveBeenLastCalledWith(21, { shareConfirmed: true, tasks: [fresh] });
    await new Promise((done) => setTimeout(done, 0));
    expect(onClose).toHaveBeenCalledWith({ picked: true });
  });

  it('builds the bulk confirm from the rows it has when they know the private files', async () => {
    const ask = Object.assign(new Error('x'), { fields: { shareConfirmed: 'Server words.' } });
    const onPick = vi.fn().mockRejectedValueOnce(ask);
    const tasks = [task(9, null, { privateLinkCount: 1 }), task(41, null, { privateLinkCount: 2 })];
    let tree = show({ tasks, onPick });
    rowOf(tree, '7').props.onClick();
    tree = show({ tasks, onPick });
    expect(findAll(tree, (p) => p['data-share'])[0].props['data-share']).toBe(
      '2 of these tasks have files only for PM and Admins. Sneha Patil will be able to open them from those tasks.',
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it('never picks a disabled (away) person', () => {
    const away = { id: 40, name: 'Kavya Reddy', status: 'active', isMember: false };
    const onPick = vi.fn();
    const tree = show({ tasks: [task(43, away)], onPick });
    expect(rowOf(tree, '40').props['aria-disabled']).toBe(true);
    rowOf(tree, '40').props.onClick();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('is a popover with the "Assign to" heading when a face opened it on a computer', () => {
    const tree = show({ tasks: [task(8, SIMRAN_P)], anchor: { nodeType: 1 } });
    expect(findAll(tree, (p) => 'data-popover' in p)).toHaveLength(1);
    expect(findAll(tree, (p) => p.className?.includes?.('heading'))[0]).toBeTruthy();
    expect(textOf(tree)).toContain('Assign to');
    expect(buttonNamed(tree, 'Cancel')).toBeUndefined();
  });
});
