// The Board tab (CONTRACT 27, Board tab), really rendered with the database-backed modules mocked:
// the manager's board; another PM who isn't on the project (no ticks, menus, paperclips or "With
// files"); a PM who is a member ('team' access with the member's file rights: paperclips and "With
// files" on their own and Anyone tasks, still no ticks or menus); a member (status dots, "For you",
// "Nothing for you yet", the muted line, their band counting every task); a Completed project (no
// Add); the away owner's visible label; the status line under the pills; ?show=critical. Client
// parts render their first state only: menus, dialogs, drags and toasts open in the browser
// (tests/e2e/project-board.spec.js). Also the New task window's pure rules (taskFormModel.js).
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

const listForProject = vi.fn();
const countsByPhase = vi.fn();
const countsForTasks = vi.fn();
let viewer = null;
let search = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => search,
}));
vi.mock('@/lib/session', () => ({ getSessionUser: async () => viewer }));
vi.mock('@/modules/projectTasks', () => ({
  projectTasks: {
    listForProject: (...args) => listForProject(...args),
    countsByPhase: (...args) => countsByPhase(...args),
  },
}));
vi.mock('@/modules/projectFiles', () => ({
  projectFiles: { countsForTasks: (...args) => countsForTasks(...args) },
}));

const { default: BoardTab } = await import('@/app/(app)/projects/[id]/BoardTab.jsx');

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

const ALL = [
  task(1, { title: 'Fix the login page', phase: 'design', assignee: person(VISHAL) }),
  task(2, {
    title: 'Checkout fix before client demo',
    priority: 'p1',
    dueDate: '2026-11-27',
    assignee: person({ id: 11, name: 'Simran Kaur' }),
    latestReport: {
      status: 'in_progress',
      userId: 11,
      userName: 'Simran Kaur',
      workDate: '2026-11-20',
    },
  }),
  task(3, {
    title: 'Payment settings page',
    dueDate: '2026-11-20',
    assignee: person(VISHAL),
    latestReport: {
      status: 'blocked',
      userId: 9,
      userName: 'Vishal Saini',
      workDate: '2026-11-20',
    },
  }),
  task(4, { title: 'Product image zoom', priority: 'p3' }),
  task(5, {
    title: 'Stock sync with the warehouse',
    assignee: person({ id: 12, name: 'Rohit Verma' }, { isMember: false }),
  }),
  task(6, { title: 'Wireframes', phase: 'design', status: 'done' }),
  task(7, { title: 'Acme testing round', phase: 'testing', priority: 'p1' }),
];
const FILE_COUNTS = { 2: 2, 3: 1, 4: 2 };

const head = (access, more = {}) => ({
  project: PROJECT,
  plan,
  today: TODAY,
  access,
  filesAccess: access === 'manage' ? 'manage' : 'none',
  forecast:
    access === 'member'
      ? undefined
      : {
          kind: 'off',
          title: 'Off track: will miss the deadline by about 12 days',
          body: 'At the current speed (2 tasks a week) the work ends around 28 Dec.',
        },
  ...more,
});

async function render(h) {
  return renderToStaticMarkup(await BoardTab({ head: h }));
}

const noTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const count = (html, text) => html.split(text).length - 1;

beforeEach(() => {
  viewer = PM;
  search = new URLSearchParams();
  listForProject.mockReset().mockResolvedValue(ALL);
  countsByPhase.mockReset();
  countsForTasks.mockReset().mockResolvedValue(FILE_COUNTS);
});

describe("the manager's board", () => {
  it('loads every task and the file counts the viewer may see', async () => {
    await render(head('manage'));
    expect(listForProject).toHaveBeenCalledWith({ viewer: PM, projectId: 5 });
    expect(countsForTasks).toHaveBeenCalledWith({ viewer: PM, tasks: ALL });
    expect(countsByPhase).not.toHaveBeenCalled();
  });

  it('draws the band: progress, the deadline with Change, Move to Testing and the forecast', async () => {
    const html = await render(head('manage'));
    const text = noTags(html);
    expect(html).toContain('aria-label="Progress and phases"');
    expect(text).toContain('Progress 14% 1 of 7 tasks done');
    expect(text).toContain('16 Dec 2026 23 days left Change deadline');
    expect(text).toContain('Move to Testing');
    expect(html).toContain('aria-label="More phase actions"');
    expect(html).toContain(
      'aria-label="Development, current phase, 0 of 4 tasks done. Show its column."',
    );
    expect(text).toContain(
      'Off track: will miss the deadline by about 12 days. At the current speed',
    );
  });

  it('has the pills with their counts, the round ticks, the menus and the paperclips', async () => {
    const html = await render(head('manage'));
    const text = noTags(html);
    expect(text).toContain('All open (6)');
    expect(text).toContain('Critical (2)');
    expect(text).toContain('With files (3)');
    expect(html).toContain('aria-label="Done: Checkout fix before client demo"');
    expect(html).toContain('aria-label="More for Checkout fix before client demo"');
    expect(html).toContain('aria-label="More for Development"');
    expect(html).toContain('role="img" aria-label="2 files"');
    expect(html).toContain('aria-label="1 file"');
    expect(count(html, 'Add task')).toBe(6); // a folded phase keeps its own, shown once opened
  });

  it('orders the columns, folds the done phases and keeps a past phase with open work', async () => {
    const html = await render(head('manage'));
    const text = noTags(html);
    expect(html).toContain('aria-label="Done phases"');
    expect(text).toContain('Requirement gathering Skipped No tasks');
    // Design is past but has an open task: a column with its actual dates and late note
    expect(text).toContain('Design 7 to 28 Oct · Ended 5 days late');
    expect(text).toContain('Development Current 26 Oct to 27 Nov');
    expect(text).toContain('No tasks in Launch yet.');
    expect(text).not.toContain('No phase yet');
  });

  it('writes each card as the prototype', async () => {
    const text = noTags(await render(head('manage')));
    expect(text).toContain('In progress · Fri, 20 Nov');
    expect(text).toContain('Blocked · Fri, 20 Nov');
    expect(text).toContain('Rohit Verma Not on the project');
    expect(text).toContain('Anyone on the project');
    expect(text).toContain('3 days late');
    // P1 first, then by due date
    expect(text.indexOf('Checkout fix before client demo')).toBeLessThan(
      text.indexOf('Payment settings page'),
    );
  });

  it('shows the status line and presses Critical from ?show=critical', async () => {
    search = new URLSearchParams('show=critical');
    const html = await render(head('manage'));
    expect(html).toContain('aria-pressed="true">Critical (2)');
    expect(noTags(html)).toContain('2 critical tasks highlighted.');
  });

  it('adds No phase yet last, without Add task, when an old task has none', async () => {
    listForProject.mockResolvedValue([...ALL, task(20, { title: 'Old login bug', phase: null })]);
    const text = noTags(await render(head('manage')));
    expect(text).toContain('No phase yet Tasks from before phases. Move each one to its phase.');
    expect(text.indexOf('No phase yet')).toBeGreaterThan(text.indexOf('Support'));
  });

  it('takes no new tasks on a completed project', async () => {
    const html = await render(head('manage', { project: { ...PROJECT, status: 'completed' } }));
    expect(noTags(html)).not.toContain('Add task');
    expect(html).toContain('aria-label="Done: Checkout fix before client demo"');
  });
});

describe('another PM who is not on the project', () => {
  beforeEach(() => {
    viewer = OTHER_PM;
  });

  it('loads no file counts and draws no ticks, menus, paperclips or With files', async () => {
    const html = await render(head('team', { filesAccess: 'none' }));
    const text = noTags(html);
    expect(countsForTasks).not.toHaveBeenCalled();
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).not.toContain('files"');
    expect(text).not.toContain('With files');
    expect(text).not.toContain('Add task');
    expect(text).not.toContain('Change');
    expect(text).not.toContain('Move to');
    expect(text).toContain('Only Riya Kapoor and Admins can change tasks and phases.');
    expect(text).toContain('All open (6)');
    expect(text).toContain('Off track');
    expect(html).toContain('role="img" aria-label="Open"');
  });

  it('reads ?show=files as All open: no files line and no dimmed cards without the pill', async () => {
    search = new URLSearchParams('show=files');
    const html = await render(head('team', { filesAccess: 'none' }));
    const text = noTags(html);
    expect(countsForTasks).not.toHaveBeenCalled();
    expect(html).toContain('aria-pressed="true">All open (6)');
    expect(text).not.toContain('No tasks with files.');
    expect(text).not.toContain('with files');
    expect(html).not.toMatch(/class="_card_[0-9a-f]+ _dim_/);
  });
});

describe('a PM who is a member of the project', () => {
  it('has paperclips and With files from the files they may see, still no ticks or menus', async () => {
    viewer = OTHER_PM;
    countsForTasks.mockResolvedValue({ 4: 2 }); // their own and Anyone tasks only
    const html = await render(head('team', { filesAccess: 'member' }));
    expect(countsForTasks).toHaveBeenCalledWith({ viewer: OTHER_PM, tasks: ALL });
    expect(noTags(html)).toContain('With files (1)');
    expect(html).toContain('aria-label="2 files"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('aria-haspopup="menu"');
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
    countsForTasks.mockResolvedValue({ 3: 1, 4: 2 });
    countsByPhase.mockResolvedValue({
      none: { total: 0, done: 0 },
      requirement_gathering: { total: 6, done: 6 },
      design: { total: 8, done: 7 },
      development: { total: 12, done: 6 },
      testing: { total: 3, done: 0 },
      launch: { total: 1, done: 0 },
      support: { total: 0, done: 0 },
    });
  });

  it('counts every task in the band but shows only theirs and Anyone tasks', async () => {
    const html = await render(head('member', { filesAccess: 'member', hoursThisMonth: 600 }));
    const text = noTags(html);
    expect(countsByPhase).toHaveBeenCalledWith(5);
    expect(text).toContain('Progress 63% 19 of 30 tasks done');
    expect(text).toContain('Your hours this month 10h');
    expect(text).toContain('Your tasks');
    expect(text).toContain(
      'Only your tasks and tasks for anyone on the project are shown. Progress counts all 30 tasks.',
    );
    expect(text).not.toContain('Off track');
    expect(text).not.toContain('All open');
    expect(text).not.toContain('Change');
  });

  it('draws status dots, For you and Anyone, and Nothing for you yet', async () => {
    const html = await render(head('member', { filesAccess: 'member' }));
    const text = noTags(html);
    expect(html).toContain('role="img" aria-label="Open"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(text).toContain('For you');
    expect(text).toContain('Anyone');
    expect(text).toContain('Nothing for you yet');
    expect(text).not.toContain('Add task');
    expect(html).toContain('aria-label="2 files"');
    expect(text).not.toContain('Your hours this month'); // no report.self: left out
  });

  it('says so when nothing is for them', async () => {
    listForProject.mockResolvedValue([]);
    const text = noTags(await render(head('member', { filesAccess: 'member' })));
    expect(text).toContain('Nothing for you on this project yet.');
    expect(text).toContain(
      'Your PM adds tasks here. Tasks for anyone on the project show here too.',
    );
    expect(text).toContain('Progress');
  });
});
