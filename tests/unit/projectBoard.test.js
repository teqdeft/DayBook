// The Board tab (CONTRACT 28, Board toolbar; Done phases rail and columns; Completed note and
// Reopen; The member's board; Another PM), really rendered with the database-backed modules mocked:
// the manager's board (the toolbar's split Add task, Board | Table, search, Filter, Mine and the
// faces; the column "+", "⋯" and "Add task to Testing"; the rail); another PM (no Add task or Mine,
// faces, no "With files" without file rights, the read-only line); a member (no Add task, Mine or
// faces; the member line); a Completed project (the note, Reopen for managers only, no "+", no
// quick add, no forecast, no Move, the empty columns' sentence); `?show=critical`; `?view=table`
// and the remembered view; the remembered open rail; the filter line's status element; when the
// board fills the window and that it stays so; the phase confirm's "5 open tasks stay in
// Testing.". Client parts render their first state only: menus, dialogs, drags and toasts open in
// the browser (tests/e2e). The cards' own rows are C3's (taskCard.test.js).
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

const listForProject = vi.fn();
const countsByPhase = vi.fn();
const chipsForTasks = vi.fn();
const privateLinkCounts = vi.fn();
const minutesByTask = vi.fn();
const latestLinesFor = vi.fn();
let viewer = null;
let search = new URLSearchParams();
let cookieJar = {};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => search,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name) => (name in cookieJar ? { value: cookieJar[name] } : undefined),
  }),
}));
vi.mock('@/lib/session', () => ({ getSessionUser: async () => viewer }));
vi.mock('@/modules/projectTasks', () => ({
  projectTasks: {
    listForProject: (...args) => listForProject(...args),
    countsByPhase: (...args) => countsByPhase(...args),
    updateCountsFor: async () => ({ 2: 2 }),
    latestLinesFor: (...args) => latestLinesFor(...args),
  },
}));
vi.mock('@/modules/projectFiles', () => ({
  projectFiles: {
    chipsForTasks: (...args) => chipsForTasks(...args),
    privateLinkCounts: (...args) => privateLinkCounts(...args),
  },
}));
vi.mock('@/modules/timers', () => ({
  timers: { minutesByTask: (...args) => minutesByTask(...args) },
}));

const { default: BoardTab } = await import('@/app/(app)/projects/[id]/BoardTab.jsx');
const { default: FilterMenu } = await import('@/app/(app)/projects/[id]/_board/FilterMenu.jsx');
const { fillAfter } = await import('@/app/(app)/projects/[id]/_board/useBoardData.js');
const { stayFor } = await import('@/app/(app)/projects/[id]/_board/boardObject.js');
const { noFilters } = await import('@/app/(app)/projects/[id]/_board/boardFilters.js');

const TODAY = '2026-11-23';
const PM = { id: 7, name: 'Riya Kapoor', role: 'pm' };
const OTHER_PM = { id: 8, name: 'Vikram Sethi', role: 'pm' };
const VISHAL = { id: 9, name: 'Vishal Saini', role: 'employee' };
const PROJECT = { id: 5, name: 'acme-store', status: 'active', pmId: 7, pmName: 'Riya Kapoor' };

const plan = {
  currentPhase: 'development',
  deadline: '2026-12-16',
  phases: PROJECT_PHASES.map(({ key, label }) => ({
    key,
    label,
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    ...{
      design: {
        plannedStart: '2026-10-07',
        plannedEnd: '2026-10-23',
        actualStart: '2026-10-07',
        actualEnd: '2026-10-28',
      },
      development: { plannedStart: '2026-10-26', plannedEnd: '2026-11-27' },
      testing: { plannedStart: '2026-11-30', plannedEnd: '2026-12-11' },
    }[key],
  })),
};

const person = (who, more = {}) => ({ ...who, status: 'active', isMember: true, ...more });
const task = (id, more = {}) => ({
  id,
  title: `Task ${id}`,
  details: null,
  priority: 'p2',
  status: 'open',
  phase: 'development',
  dueDate: null,
  assignee: null,
  latestReport: null,
  createdBy: 7,
  createdByName: 'Riya Kapoor',
  ...more,
});

const SIMRAN = { id: 11, name: 'Simran Kaur' };
const ALL = [
  task(1, { title: 'Fix the login page', phase: 'design', assignee: person(VISHAL) }),
  task(2, {
    title: 'Checkout fix before client demo',
    priority: 'p1',
    dueDate: '2026-11-27',
    assignee: person(SIMRAN),
  }),
  task(3, { title: 'Payment settings page', dueDate: '2026-11-20', assignee: person(VISHAL) }),
  task(4, { title: 'Product image zoom', priority: 'p3' }),
  task(5, { title: 'Stock sync', assignee: person(PM) }),
  task(6, { title: 'Wireframes', phase: 'requirement_gathering', status: 'done' }),
  task(7, { title: 'Acme testing round', phase: 'testing', priority: 'p1' }),
];
const LINES = { 3: { status: 'blocked', workDate: '2026-11-20', userId: 9, userName: 'Vishal' } };
const chip = (id, name) => ({ id, name, ext: 'pdf', kind: 'pdf', isPicture: false });
const CHIPS = { 2: { count: 2, chips: [chip(31, 'brief.pdf'), chip(32, 'flow.pdf')] } };

const head = (access, more = {}) => ({
  project: PROJECT,
  plan,
  today: TODAY,
  access,
  filesAccess: access === 'manage' ? 'manage' : 'none',
  viewerId: viewer?.id ?? null,
  viewerName: viewer?.name ?? null,
  forecast:
    access === 'member'
      ? undefined
      : {
          kind: 'off',
          pill: 'Off track',
          title: 'Off track: will miss the deadline by about 12 days',
          body: 'At the current speed (2 tasks a week) the work ends around 28 Dec.',
        },
  ...more,
});

async function render(h, query) {
  return renderToStaticMarkup(await BoardTab({ head: h, query }));
}

const noTags = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
const count = (html, text) => html.split(text).length - 1;

beforeEach(() => {
  viewer = PM;
  search = new URLSearchParams();
  cookieJar = {};
  listForProject.mockReset().mockResolvedValue(ALL);
  countsByPhase.mockReset();
  chipsForTasks.mockReset().mockResolvedValue(CHIPS);
  privateLinkCounts.mockReset().mockResolvedValue({ 2: 1 });
  minutesByTask.mockReset().mockResolvedValue({ 2: 340 });
  latestLinesFor.mockReset().mockResolvedValue(LINES);
});

describe("the manager's board", () => {
  it('loads the tasks and, per task, the chips, minutes, lines and private links', async () => {
    await render(head('manage'));
    expect(listForProject).toHaveBeenCalledWith({ viewer: PM, projectId: 5 });
    expect(chipsForTasks).toHaveBeenCalledWith({ viewer: PM, tasks: ALL });
    expect(minutesByTask).toHaveBeenCalledWith({ taskIds: [1, 2, 3, 4, 5, 6, 7], userId: null });
    expect(privateLinkCounts).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6, 7]);
    expect(countsByPhase).not.toHaveBeenCalled();
  });

  it('has the toolbar: the split Add task, Board | Table, search, Filter, Mine and the faces', async () => {
    const html = await render(head('manage'));
    const text = noTags(html);
    expect(html).toContain('role="group" aria-label="Task tools"');
    expect(html).toContain('id="board-add-task"');
    expect(html).toContain('More ways to add a task');
    expect(html).toContain('role="group" aria-label="View"');
    expect(html).toMatch(/aria-pressed="true"><svg[^]*?<\/svg>Board<\/button>/);
    expect(html).toContain('placeholder="Search tasks or #number"');
    expect(html).toContain('aria-label="Search tasks"');
    expect(text).toContain('Filter');
    expect(text).toContain('Mine (1)');
    expect(html).toContain('aria-label="Show one person&#x27;s tasks"');
    // the PM first, then A to Z; Anyone apart
    const faces = [...html.matchAll(/aria-label="Show only ([^"]+?)&#x27;s tasks \((\d)\)"/g)];
    expect(faces.map((face) => `${face[1]} ${face[2]}`)).toEqual([
      'Riya Kapoor 1',
      'Simran Kaur 1',
      'Vishal Saini 2',
    ]);
    expect(html).toContain('aria-label="Show only tasks for anyone on the project (2)"');
    // no header button on the Board tab (the toolbar's Add task is its one add)
    expect(text).not.toContain('New task Board');
  });

  it('draws the band: progress, the deadline, Move to Testing, one ring and the forecast', async () => {
    const html = await render(head('manage'));
    const text = noTags(html);
    // the copy that counts up, then its hidden twin with the final number
    expect(text).toMatch(/Progress 14% ?14% 1 of 7 tasks done/);
    expect(html).toContain('<span data-pct="" aria-hidden="true">14%</span>');
    expect(html).toContain('<span class="visually-hidden" data-pct-final="">14%</span>');
    expect(text).toContain('16 Dec 2026 23 days left Change deadline');
    expect(text).toContain('Move to Testing');
    expect(html).toContain('aria-label="More phase actions"');
    expect(count(html, 'data-ring=""')).toBe(1);
    expect(html).toContain('style="--i:2"');
    expect(html).toContain('data-fill="design" style="--share:1"');
    expect(html).toContain('data-fill="development" style="--share:0"');
    expect(text).toContain('Off track: will miss the deadline by about 12 days.');
  });

  it('draws the columns: the rail, "+", "⋯", the counts and "Add task to Testing"', async () => {
    const html = await render(head('manage'));
    const text = noTags(html);
    expect(html).toContain('aria-label="Done phases"');
    expect(text).toContain('Done phases 1 : Requirement gathering. Show them.');
    expect(html).toContain('aria-label="New task in Testing"');
    expect(html).toContain('aria-label="More for Testing"');
    expect(html).toContain('data-cards="testing"');
    expect(html).toContain('title="1 open"');
    expect(text).toContain('Add task to Testing');
    // Design is past but has an open task: a column with its actual dates and late note
    expect(text).toContain('Design 1 open 7 to 28 Oct · Ended 5 days late');
    expect(text).toContain('Development 4 open Current 26 Oct to 27 Nov');
    expect(text).toContain('Launch 0 open No tasks yet');
    // the folded phase is drawn, but hidden (a step on a phone)
    expect(html).toMatch(/data-column="requirement_gathering" hidden=""/);
    // no width classes any more
    expect(html).not.toMatch(/_slim_/);
  });

  it('draws the rail open when it was left open', async () => {
    cookieJar = { 'daybook.board.rail': 'open' };
    const html = await render(head('manage'));
    expect(html).toMatch(/data-flip="rail" data-open=""/);
    expect(html).toContain('aria-label="Fold the done phases"');
    expect(noTags(html)).toContain(
      'Requirement gathering Skipped 1 of 1 task Show Requirement gathering tasks',
    );
  });

  it('ticks Critical from ?show=critical, and says what matches', async () => {
    const html = await render(head('manage'), { show: 'critical' });
    expect(html).toMatch(/Filter<span[^>]*>1<\/span><span class="visually-hidden">, 1 on<\/span>/);
    expect(noTags(html)).toContain('2 tasks match. The others are faded. Clear all');
  });

  it('keeps the filter line’s status element while nothing is filtered', async () => {
    const html = await render(head('manage'));
    expect(html).toMatch(/<div class="_line_[0-9a-f]+"><span role="status"><\/span><\/div>/);
  });

  it('opens the Table from ?view=table or the remembered view, ?view= first', async () => {
    const board = await render(head('manage'));
    expect(board).toContain('data-view="board"');
    expect(await render(head('manage'), { view: 'table' })).toContain('data-view="table"');
    cookieJar = { 'daybook.board.view': 'table' };
    expect(await render(head('manage'))).toContain('data-view="table"');
    expect(await render(head('manage'), { view: 'board' })).toContain('data-view="board"');
  });

  it('adds No phase yet last, without "+", "⋯" or Add task', async () => {
    listForProject.mockResolvedValue([...ALL, task(20, { title: 'Old login bug', phase: null })]);
    const html = await render(head('manage'));
    const text = noTags(html);
    expect(text).toContain(
      'No phase yet 1 open Tasks from before phases. Move each one to its phase.',
    );
    expect(text.indexOf('No phase yet')).toBeGreaterThan(text.indexOf('Support'));
    expect(html).not.toContain('New task in No phase yet');
    expect(html).not.toContain('More for No phase yet');
    expect(text).not.toContain('Add task to No phase yet');
  });
});

describe('a Completed project', () => {
  const completed = { project: { ...PROJECT, status: 'completed' } };

  it('says so once, offers Reopen project to managers, and takes no new tasks', async () => {
    const html = await render(head('manage', completed));
    const text = noTags(html);
    expect(text).toContain(
      "This project is completed, so new tasks can't be added. Use Reopen project to add tasks again.",
    );
    expect(text).toContain('Reopen project');
    expect(count(html, 'id="project-reopen"')).toBe(1); // where its Undo's focus goes
    expect(html).not.toContain('id="board-add-task"');
    expect(html).not.toContain('aria-label="New task in');
    expect(text).not.toContain('Add task to');
    expect(text).not.toContain('Move to Testing');
    expect(html).not.toContain('More phase actions');
    expect(text).not.toContain('Off track');
    expect(text).toContain('Launch 0 open No tasks here. This project is completed.');
    // ticks and menus still work
    expect(html).toContain('aria-label="More for Testing"');
  });

  it('gives another PM and a member the sentence only', async () => {
    viewer = OTHER_PM;
    const team = noTags(await render(head('team', completed)));
    expect(team).toContain("This project is completed, so new tasks can't be added.");
    expect(team).not.toContain('Use Reopen project');
    expect(team).not.toContain('Reopen project');
    viewer = VISHAL;
    countsByPhase.mockResolvedValue({});
    const member = noTags(await render(head('member', { ...completed, filesAccess: 'member' })));
    expect(member).toContain("This project is completed, so new tasks can't be added.");
    expect(member).not.toContain('Reopen project');
  });
});

describe('another PM who is not on the project', () => {
  beforeEach(() => {
    viewer = OTHER_PM;
  });

  it('reads only: faces, no Add task or Mine, no file reads, the read-only line', async () => {
    const html = await render(head('team', { filesAccess: 'none' }));
    const text = noTags(html);
    expect(chipsForTasks).not.toHaveBeenCalled();
    expect(privateLinkCounts).not.toHaveBeenCalled();
    expect(html).not.toContain('id="board-add-task"');
    expect(text).not.toContain('Mine (');
    expect(html).toContain('aria-label="Show one person&#x27;s tasks"');
    expect(html).not.toContain('type="checkbox"');
    expect(text).not.toContain('Move to');
    expect(text).toContain('Only Riya Kapoor and Admins can change tasks and phases.');
    expect(html).toContain('role="img" aria-label="Open"');
  });

  it('has no "With files" in the Filter menu without file rights', async () => {
    const board = {
      filesAccess: 'none',
      filters: { counts: { critical: 2, files: 0, overdue: 1, blocked: 1 }, state: noFilters() },
    };
    const labels = FilterMenu({ board }).props.items.map((item) => item.label);
    expect(labels).toEqual(['Critical (2)', 'Overdue (1)', 'Blocked (1)', 'Show done tasks']);
    const withFiles = FilterMenu({ board: { ...board, filesAccess: 'member' } }).props.items;
    expect(withFiles[1]).toMatchObject({ label: 'With files (0)', checked: false, keepOpen: true });
  });

  it('reads ?show=files as nothing ticked without file rights', async () => {
    const html = await render(head('team', { filesAccess: 'none' }), { show: 'files' });
    expect(noTags(html)).not.toContain('match');
    expect(html).not.toMatch(/, \d on</);
  });
});

describe("a member's board", () => {
  const MINE = [
    ALL[0],
    ALL[2],
    ALL[3],
    task(6, { title: 'Wireframes', phase: 'design', status: 'done', assignee: person(VISHAL) }),
  ];

  beforeEach(() => {
    viewer = VISHAL;
    listForProject.mockResolvedValue(MINE);
    countsByPhase.mockResolvedValue({
      requirement_gathering: { total: 6, done: 6 },
      design: { total: 8, done: 7 },
      development: { total: 12, done: 6 },
      testing: { total: 3, done: 0 },
      launch: { total: 1, done: 0 },
    });
  });

  it('counts every task in the band, with only their own minutes and lines', async () => {
    const html = await render(head('member', { filesAccess: 'member', hoursThisMonth: 600 }));
    const text = noTags(html);
    expect(countsByPhase).toHaveBeenCalledWith(5);
    expect(minutesByTask).toHaveBeenCalledWith({ taskIds: [1, 3, 4, 6], userId: 9 });
    expect(privateLinkCounts).not.toHaveBeenCalled();
    expect(text).toMatch(/Progress 63% ?63% 19 of 30 tasks done/);
    expect(text).toContain('Your hours this month 10h');
    expect(text).toContain(
      'Only your tasks and tasks for anyone on the project are shown. Progress counts all 30 tasks.',
    );
    expect(text).not.toContain('Off track');
    expect(text).not.toContain('Change');
  });

  it('has Board | Table, the search and Filter, but no Add task, Mine or faces', async () => {
    const html = await render(head('member', { filesAccess: 'member' }));
    const text = noTags(html);
    expect(html).toContain('aria-label="View"');
    expect(html).toContain('placeholder="Search tasks or #number"');
    expect(text).toContain('Filter');
    expect(html).not.toContain('id="board-add-task"');
    expect(text).not.toContain('Mine (');
    expect(html).not.toContain("Show one person's tasks");
    expect(html).not.toContain('type="checkbox"');
    expect(text).toContain('Nothing for you yet');
    expect(text).not.toContain('Add task');
  });

  it('says so when nothing is for them', async () => {
    listForProject.mockResolvedValue([]);
    const text = noTags(await render(head('member', { filesAccess: 'member' })));
    expect(text).toContain('Nothing for you on this project yet.');
    expect(text).toContain('Progress');
  });
});

describe('when the board fills the window', () => {
  it('fills once a column shows 4 cards, and stays so after the viewer’s own move', () => {
    const start = fillAfter({ view: 'board', fill: false }, { view: 'board', wants: true });
    expect(start).toEqual({ view: 'board', fill: true });
    // the 4th card moved out: the column has 3 now, the board still fills
    expect(fillAfter(start, { view: 'board', wants: false })).toEqual({
      view: 'board',
      fill: true,
    });
  });

  it('is worked out again on a switch to the Table and back, and never for the Table', () => {
    const table = fillAfter({ view: 'board', fill: true }, { view: 'table', wants: true });
    expect(table).toEqual({ view: 'table', fill: false });
    expect(fillAfter(table, { view: 'board', wants: false })).toEqual({
      view: 'board',
      fill: false,
    });
  });

  it('draws data-fill on the view from the first paint', async () => {
    const many = [1, 2, 3, 4].map((id) => task(30 + id, { title: `Busy ${id}` }));
    listForProject.mockResolvedValue([...ALL, ...many]);
    const html = await render(head('manage'));
    expect(html).toMatch(/<section class="_view_[0-9a-f]+" data-fill="" aria-label="Tasks">/);
    listForProject.mockResolvedValue(ALL.slice(0, 3));
    expect(await render(head('manage'))).toMatch(/<section class="_view_[0-9a-f]+" aria-label/);
  });
});

describe("the phase move confirm's line", () => {
  const columns = [{ key: 'testing', open: [1, 2, 3, 4, 5] }];
  const testing = { currentPhase: 'testing' };

  it('says how many open tasks stay in the phase left', () => {
    expect(stayFor(testing, columns)('launch')).toBe('5 open tasks stay in Testing.');
    expect(stayFor(testing, [{ key: 'testing', open: [1] }])('support')).toBe(
      '1 open task stays in Testing.',
    );
  });

  it('says nothing at 0, going back, or with no current phase', () => {
    expect(stayFor(testing, [{ key: 'testing', open: [] }])('launch')).toBeNull();
    expect(stayFor(testing, columns)('design')).toBeNull();
    expect(stayFor({ currentPhase: null }, columns)('design')).toBeNull();
  });
});
