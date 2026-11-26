// The task card and its menu (CONTRACT 28, Cards and the card menu; Data attributes; Every message,
// Card and Card menu), rendered with react-dom/server: the rows for a manager, another PM and a
// member; the number, P tag and status chip; the actions only for managers (Assign to me hidden on
// the viewer's own and done tasks, the grip only on open tasks); 2 file chips with pictures first
// and "+1"; time and updates only above 0; face labels, away labels, "For you" / "Anyone"; the DOM
// order tick, title, actions; the data attributes the motion reads; the card menu's items; the Move
// to phase window for several tasks. Browser checks: the review's screenshots in a copy.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({ actions: null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/12',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => () => {},
  useToastSlot: () => null,
}));
vi.mock('@/app/(app)/projects/[id]/_board/TaskActionsProvider.jsx', () => ({
  useTaskActions: () => page.actions,
  TaskActionsProvider: ({ children }) => children,
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ title, children }) => createElement('section', { 'data-dialog': title }, children),
}));

const { default: TaskCard } = await import('@/app/(app)/projects/[id]/_board/TaskCard.jsx');
const { cardMenuItems } = await import('@/app/(app)/projects/[id]/_board/CardMenu.jsx');
const { cardFilesOf } = await import('@/app/(app)/projects/[id]/_board/CardFiles.jsx');
const { default: MoveTaskDialog, moveRows } =
  await import('@/app/(app)/projects/[id]/_board/MoveTaskDialog.jsx');

const SIMRAN = { id: 5, name: 'Simran Kaur', role: 'employee', status: 'active', away: null };
const chip = (id, name, extra = {}) => ({
  id,
  name,
  ext: name.split('.').pop(),
  kind: 'pdf',
  isPicture: false,
  thumbUrl: null,
  viewUrl: `/api/project-files/${id}/view`,
  downloadUrl: `/api/project-files/${id}`,
  sizeBytes: 1000,
  ...extra,
});
const PICTURE = chip(71, 'card-payment-error.png', {
  kind: 'picture',
  isPicture: true,
  thumbUrl: '/api/project-files/71/thumb',
});

const TASK = {
  id: 8,
  title: 'Checkout fix before client demo',
  priority: 'p1',
  status: 'open',
  phase: 'development',
  dueDate: '2026-11-27',
  assignee: SIMRAN,
  statusChip: { status: 'in_progress', workDate: '2026-11-23' },
  files: { count: 3, chips: [chip(70, 'checkout-flow.pdf'), PICTURE] },
  minutes: 340,
  updateCount: 2,
  privateLinkCount: 0,
};

const board = (access, extra = {}) => ({
  access,
  viewerId: 3,
  today: '2026-11-24',
  projectId: 12,
  cardProps: () => ({ dimmed: false, highlighted: false, fileDrop: null }),
  openTask: () => {},
  editTask: () => {},
  askMove: () => {},
  deleteTask: () => {},
  batchFor: () => null,
  ...extra,
});
const html = (task, access = 'manage', extra) =>
  renderToStaticMarkup(createElement(TaskCard, { task, board: board(access, extra) }));
const FAKE_ACTIONS = { take: vi.fn(), openPeople: vi.fn(), assign: vi.fn() };

beforeEach(() => {
  page.actions = FAKE_ACTIONS;
});

describe('a manager’s card', () => {
  it('has the number, the P tag and the status chip with its date', () => {
    const card = html(TASK);
    expect(card).toContain('<span class="_number_');
    expect(card).toMatch(/_number_[a-z0-9]+">#8</);
    expect(card).toContain('Priority 1, highest');
    expect(card).toMatch(/title="Mon, 23 Nov"[^>]*>In progress<span class="visually-hidden">, /);
    expect(card).toContain('Mon, 23 Nov</span>');
  });

  it('draws the tick, the title, then Assign to me, the grip and "⋯", in that order', () => {
    const card = html(TASK);
    const order = [
      'aria-label="Done: Checkout fix before client demo"',
      'data-card-title=""',
      'aria-label="Assign Checkout fix before client demo to me"',
      'aria-label="Move Checkout fix before client demo"',
      'aria-label="More for Checkout fix before client demo"',
      'Open picture card-payment-error.png',
      'Assigned to Simran Kaur. Change person',
    ].map((text) => card.indexOf(text));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(card).toContain('title="Assign to me"');
    expect(card).toMatch(/data-grip=""[^>]*aria-describedby="move-help"/);
  });

  it('carries the data attributes the motion reads, and is never draggable', () => {
    const card = html(TASK);
    expect(card).toMatch(/^<li id="board-card-8"[^>]*data-flip="card:8" data-open=""/);
    expect(card).toContain('data-card-actions=""');
    expect(card).toContain('data-face="5"');
    expect(card).toContain('data-face-button=""');
    expect(card).not.toContain('draggable="true"');
    expect(card).toContain('draggable="false"');
  });

  it("hides Assign to me on the viewer's own task, and on a done task the grip and the chip too", () => {
    const own = html({ ...TASK, assignee: { ...SIMRAN, id: 3, isViewer: true } });
    expect(own).not.toContain('to me"');
    expect(own).toContain('data-grip');
    const done = html({ ...TASK, status: 'done' });
    expect(done).not.toContain('to me"');
    expect(done).not.toContain('data-grip');
    expect(done).toContain('More for Checkout');
    expect(done).not.toContain('In progress');
    expect(done).not.toContain('data-open');
  });

  it('shows 2 chips, pictures first, then "+1" with the count in its title', () => {
    const card = html(TASK);
    expect(card.indexOf('Open picture')).toBeLessThan(card.indexOf('checkout-flow.pdf'));
    expect(card).toMatch(/title="3 files">\+(<!-- -->)?1</);
    expect(card).toMatch(/<img src="\/api\/project-files\/71\/thumb" alt="" loading="lazy"/);
    expect(cardFilesOf({ count: 2, chips: [chip(1, 'a.pdf'), chip(2, 'b.pdf')] }).more).toBe(0);
    expect(cardFilesOf({ count: 0, chips: [] })).toBeNull();
    expect(cardFilesOf(undefined)).toBeNull();
    expect(html({ ...TASK, files: { count: 0, chips: [] } })).not.toContain('files"');
  });

  it('shows time and updates only above zero, with their hidden words', () => {
    const card = html(TASK);
    expect(card).toContain('5h 40m<span class="visually-hidden"> from timers</span>');
    expect(card).toContain('2<span class="visually-hidden"> updates</span>');
    const one = html({ ...TASK, updateCount: 1, minutes: 0 });
    expect(one).toContain('1<span class="visually-hidden"> update</span>');
    expect(one).not.toContain('from timers');
    expect(html({ ...TASK, updateCount: 0, minutes: 0 })).not.toContain('update');
  });

  it("names the face button, Anyone's too, and shows an away person's label", () => {
    expect(html({ ...TASK, assignee: null })).toContain(
      'aria-label="Assigned to anyone on the project. Change person"',
    );
    const away = { ...SIMRAN, id: 40, name: 'Kavya Reddy', away: 'Not on the project' };
    const card = html({ ...TASK, assignee: away });
    expect(card).toContain('Kavya</span>');
    expect(card).toContain('Not on the project</span>');
    expect(card).toMatch(/aria-haspopup="dialog"/);
  });

  it('dims an open card for a filter, never a done one', () => {
    const dim = { cardProps: () => ({ dimmed: true }) };
    expect(html(TASK, 'manage', dim)).toMatch(/class="[^"]*_dim_/);
    expect(html({ ...TASK, status: 'done' }, 'manage', dim)).not.toMatch(/class="[^"]*_dim_/);
  });

  it('takes the grip from the pointer drag, its class merged with the card’s own', () => {
    const gripProps = { 'data-grip': '', 'aria-describedby': 'move-help', className: 'dragGrip' };
    const card = html(TASK, 'manage', { cardProps: () => ({ gripProps }) });
    expect(card).toMatch(/class="[^"]*_grip_[^"]* dragGrip"/);
  });
});

describe('another PM and a member', () => {
  it('another PM: the face and first name, not a button; no tick, actions or grip', () => {
    const card = html(TASK, 'team');
    expect(card).toContain('Simran</span>');
    expect(card).not.toContain('Change person');
    expect(card).not.toContain('data-card-actions');
    expect(card).not.toContain('Done: ');
    expect(card).toContain('role="img" aria-label="Open"');
    expect(card).toContain(' from timers</span>');
  });

  it('a member: "For you" or "Anyone", their own time, no actions', () => {
    const own = html({ ...TASK, assignee: { ...SIMRAN, id: 3, isViewer: true } }, 'member');
    expect(own).toContain('For you');
    expect(own).toContain(' of your time from timers</span>');
    expect(own).not.toContain('data-card-actions');
    expect(html({ ...TASK, assignee: null }, 'member')).toContain('Anyone</span>');
  });
});

describe('the card menu', () => {
  const labels = (items) => items.map((item) => item.label);
  const b = board('manage');

  it('lists Assign to me first, then Assign to…, Open, Edit, Move to phase… and Delete', () => {
    expect(labels(cardMenuItems({ task: TASK, board: b, actions: FAKE_ACTIONS }))).toEqual([
      'Assign to me',
      'Assign to…',
      'Open',
      'Edit',
      'Move to phase…',
      'Delete',
    ]);
    const items = cardMenuItems({ task: TASK, board: b, actions: FAKE_ACTIONS });
    expect(items.at(-1).tone).toBe('danger');
    // a line above Delete only, as the prototype
    expect(items.filter((item) => item.separator).map((item) => item.label)).toEqual(['Delete']);
  });

  it("leaves Assign to me out on the viewer's own task and on a done one", () => {
    const own = { ...TASK, assignee: { ...SIMRAN, id: 3 } };
    expect(labels(cardMenuItems({ task: own, board: b, actions: FAKE_ACTIONS }))[0]).toBe(
      'Assign to…',
    );
    const done = { ...TASK, status: 'done' };
    expect(labels(cardMenuItems({ task: done, board: b, actions: FAKE_ACTIONS }))[0]).toBe(
      'Assign to…',
    );
  });

  it('takes the task and opens the people window as a window', () => {
    const take = vi.fn();
    const openPeople = vi.fn();
    vi.stubGlobal('document', { getElementById: () => null });
    const items = cardMenuItems({ task: TASK, board: b, actions: { take, openPeople } });
    items[0].onSelect();
    items[1].onSelect();
    vi.unstubAllGlobals();
    expect(take).toHaveBeenCalledWith(TASK, { origin: null });
    expect(openPeople).toHaveBeenCalledWith({ tasks: [TASK] });
  });
});

describe('Move to phase… for several tasks', () => {
  it('is titled "Move 2 tasks" and marks a phase "(here now)" only when all are in it', () => {
    const two = [TASK, { ...TASK, id: 9, phase: 'testing' }];
    expect(moveRows(two, {}).filter((row) => row.here)).toEqual([]);
    const both = [TASK, { ...TASK, id: 9 }];
    expect(moveRows(both, {}).find((row) => row.here).label).toBe('Development (here now)');
    expect(moveRows([TASK], null).every((row) => row.count === null)).toBe(true);
    const window = renderToStaticMarkup(
      createElement(MoveTaskDialog, {
        tasks: two,
        counts: {},
        onMove: () => {},
        onClose: () => {},
      }),
    );
    expect(window).toContain('data-dialog="Move 2 tasks"');
  });
});
