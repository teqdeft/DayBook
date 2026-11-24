// The member's project page (CONTRACT 27): a person on the project opens it read only. The header
// has no health tag (only the Urgent tag, without the urgent note) and no "+ New task"; the tabs are
// Board and Files only (no Summary, Timeline or Hours, whatever the URL asks); the task window opens
// read only; the band, with "Your hours this month" and no forecast, is part of the Board tab only.
// loadProjectHead checks the membership before reading anything about the project, computes no
// forecast for a member and adds their hours this company month. The frame's tabs are stubbed
// (renderToStaticMarkup can't wait for async tabs); the Board tab itself is rendered for real
// (vi.importActual) with the database-backed modules mocked.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setNowForTests } from '@/lib/time';
import { PROJECT_PHASES } from '@/modules/projectPlan/phases';

const listForProject = vi.fn();
const countsByPhase = vi.fn();
const progressByProject = vi.fn();
const listAssigneeOptions = vi.fn();
const countsForTasks = vi.fn();
const viewerContext = vi.fn();
const limits = vi.fn();
const findById = vi.fn();
const isMember = vi.fn();
const getPlan = vi.fn();
const getMinutesByProject = vi.fn();
const todoTakesLines = vi.fn();
let viewer = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/session', () => ({ getSessionUser: async () => viewer }));
vi.mock('@/components/TopBar', () => ({
  default: ({ title, subtitle, breadcrumb, actions }) =>
    createElement('header', null, breadcrumb.at(-1).label, title, subtitle, actions),
}));
const stub = (name) => ({
  default: (props) =>
    createElement('main', { 'data-place': props.place ?? undefined }, `the ${name} tab`),
});
vi.mock('@/app/(app)/projects/[id]/BoardTab', () => stub('board'));
vi.mock('@/app/(app)/projects/[id]/FilesTab', () => stub('files'));
// The managers' providers say so if they are ever mounted on this page.
const managerProvider = (name) =>
  function Provider(props) {
    return createElement('div', { 'data-provider': name }, props.children);
  };
vi.mock('@/app/(app)/projects/[id]/_board/TaskEditorProvider', () => ({
  TaskEditorProvider: managerProvider('editor'),
  useTaskEditor: () => null,
  useSavedTask: () => null,
}));
vi.mock('@/components/files/TaskAttachProvider', () => ({
  TaskAttachProvider: managerProvider('attach'),
  useTaskAttach: () => null,
  useTaskBatch: () => null,
}));
vi.mock('@/components/task/TaskWindowProvider', () => ({
  TaskWindowProvider: ({ mode, projectId, todoOpen, children }) =>
    createElement(
      'div',
      { 'data-window': `${mode}:${projectId}`, 'data-todo-open': String(todoOpen) },
      children,
    ),
  useTaskWindow: () => null,
}));
vi.mock('@/modules/projectTasks', () => ({
  projectTasks: {
    listForProject: (...args) => listForProject(...args),
    countsByPhase: (...args) => countsByPhase(...args),
    progressByProject: (...args) => progressByProject(...args),
    listAssigneeOptions: (...args) => listAssigneeOptions(...args),
  },
}));
vi.mock('@/modules/projectFiles', () => ({
  projectFiles: {
    countsForTasks: (...args) => countsForTasks(...args),
    viewerContext: (...args) => viewerContext(...args),
    limits: (...args) => limits(...args),
  },
}));
vi.mock('@/modules/projects', () => ({
  projects: {
    findById: (...args) => findById(...args),
    isMember: (...args) => isMember(...args),
    canManage: (user, project) => user.role === 'admin' || project.pmId === user.id,
  },
}));
vi.mock('@/modules/projectPlan', () => ({
  projectPlan: { getPlan: (...args) => getPlan(...args) },
}));
vi.mock('@/modules/reports', () => ({
  reports: {
    getMinutesByProject: (...args) => getMinutesByProject(...args),
    todoTakesLines: (...args) => todoTakesLines(...args),
  },
}));
vi.mock('@/modules/settings', () => ({
  settings: { getAll: async () => ({ timezone: 'Asia/Kolkata' }) },
}));

const { default: MemberProjectView } =
  await import('@/app/(app)/projects/[id]/MemberProjectView.jsx');
const { loadProjectHead } = await import('@/app/(app)/projects/[id]/projectHead.js');
const { default: BoardTab } = await vi.importActual('@/app/(app)/projects/[id]/BoardTab.jsx');

const TODAY = '2026-11-23';
const VISHAL = { id: 9, name: 'Vishal Saini', role: 'employee', status: 'active' };
const NEHA = { id: 13, name: 'Neha Kapoor', role: 'hr', status: 'active' };

const PROJECT = {
  id: 5,
  name: 'acme-store',
  clientName: 'Acme Retail',
  pmId: 7,
  pmName: 'Riya Kapoor',
  color: 'blue',
  status: 'active',
  isUrgent: true,
  urgentNote: 'Checkout fix before client demo',
  createdAt: new Date('2026-08-01T04:00:00Z'),
};

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
  })),
};

const HEAD = {
  project: { ...PROJECT, statusLabel: 'Active' },
  plan,
  today: TODAY,
  canManage: false,
  access: 'member',
  filesAccess: 'member',
  hoursThisMonth: 600,
};

const page = (query = {}, head = HEAD) =>
  renderToStaticMarkup(createElement(MemberProjectView, { head, query }));

const noTags = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('the member’s page frame', () => {
  it('has no health tag and no "+ New task"', () => {
    const html = page();
    expect(html).not.toContain('Off track');
    expect(html).not.toContain('On track');
    expect(noTags(html)).not.toContain('New task');
    expect(html).not.toContain('lucide-plus');
  });

  it('keeps no health tag even if a forecast slipped into the head', () => {
    const html = page({}, { ...HEAD, forecast: { kind: 'off', pill: 'Off track' } });
    expect(html).not.toContain('Off track');
  });

  it('shows the Urgent tag but not the urgent note', () => {
    const html = page();
    expect(html).toMatch(/<span class="[^"]*marigold[^"]*">Urgent<\/span>/);
    expect(noTags(html)).toContain('Acme Retail · PM: Riya Kapoor · Active');
    expect(html).not.toContain('Checkout fix before client demo');
  });

  it('has the tabs Board and Files only', () => {
    const html = page();
    expect(html).toContain('href="/projects/5?tab=board"');
    expect(html).toContain('href="/projects/5?tab=files"');
    for (const tab of ['summary', 'timeline', 'hours']) expect(html).not.toContain(`tab=${tab}`);
    expect(noTags(html)).not.toMatch(/Summary|Timeline|Hours/);
  });

  it.each([
    [{}, 'the board tab'],
    [{ tab: 'summary' }, 'the board tab'],
    [{ tab: 'timeline' }, 'the board tab'],
    [{ tab: 'hours' }, 'the board tab'],
    [{ range: 'week' }, 'the board tab'],
    [{ tab: 'phases' }, 'the board tab'],
    [{ tab: 'files' }, 'the files tab'],
  ])('mounts only the tab a member may open for %j', (query, shown) => {
    const html = page(query);
    expect(html).toContain(shown);
    const other = shown === 'the board tab' ? 'the files tab' : 'the board tab';
    expect(html).not.toContain(other);
  });

  it('hands the Files tab its place', () => {
    expect(page({ tab: 'files', place: 'tasks' })).toContain('data-place="tasks"');
  });

  it('opens the task window read only, and mounts nothing that changes tasks or files', () => {
    const html = page();
    expect(html).toContain('data-window="member:5"');
    expect(html).not.toContain('data-provider');
  });

  it('lets the task window offer "Add to to-do" only while today’s to-do takes lines', () => {
    expect(page({}, { ...HEAD, todoOpen: true })).toContain('data-todo-open="true"');
    expect(page({}, { ...HEAD, todoOpen: false })).toContain('data-todo-open="false"');
    expect(page()).toContain('data-todo-open="false"');
  });
});

describe('the member’s Board tab', () => {
  const task = (id, more = {}) => ({
    id,
    title: `Task ${id}`,
    details: null,
    priority: 'p2',
    status: 'open',
    phase: 'development',
    dueDate: null,
    assignee: { ...VISHAL, initials: 'VS', avatarUrl: null, isMember: true },
    latestReport: null,
    createdBy: 7,
    createdByName: 'Riya Kapoor',
    ...more,
  });
  const counts = Object.fromEntries([
    ['none', { total: 0, done: 0 }],
    ...PROJECT_PHASES.map(({ key }) => [key, { total: 0, done: 0 }]),
  ]);

  beforeEach(() => {
    viewer = VISHAL;
    listForProject.mockReset().mockResolvedValue([task(1), task(2, { assignee: null })]);
    countsByPhase.mockReset().mockResolvedValue({
      ...counts,
      design: { total: 8, done: 7 },
      development: { total: 12, done: 6 },
    });
    countsForTasks.mockReset().mockResolvedValue({ 1: 2 });
  });

  const board = async (more = {}) =>
    renderToStaticMarkup(await BoardTab({ head: { ...HEAD, ...more } }));

  it('draws the band with "Your hours this month" and every task counted', async () => {
    const html = await board();
    const text = noTags(html);
    expect(html).toContain('aria-label="Progress and phases"');
    expect(text).toContain('Your hours this month');
    expect(text).toContain('10h');
    expect(text).toContain('13 of 20 tasks done');
    expect(countsByPhase).toHaveBeenCalledWith(5);
  });

  it('leaves the hours out without report.self', async () => {
    const text = noTags(await board({ hoursThisMonth: null }));
    expect(text).not.toContain('Your hours this month');
  });

  it('has no forecast, no Change and no phase moves', async () => {
    const html = await board();
    const text = noTags(html);
    expect(text).not.toMatch(/Off track|On track|At risk|At the current speed/);
    expect(text).not.toContain('Change');
    expect(text).not.toContain('Move to');
    expect(html).not.toContain('More phase actions');
  });

  it('shows "Your tasks", the cards for them and the muted line', async () => {
    const text = noTags(await board());
    expect(text).toContain('Your tasks');
    expect(text).toContain('For you');
    expect(text).toContain('Anyone');
    expect(text).toContain('Only your tasks and tasks for anyone on the project are shown.');
  });
});

describe('loadProjectHead for a member', () => {
  beforeEach(() => {
    setNowForTests('2026-11-23T06:30:00Z'); // noon in Asia/Kolkata
    findById.mockReset().mockResolvedValue(PROJECT);
    isMember.mockReset().mockResolvedValue(true);
    getPlan.mockReset().mockResolvedValue(plan);
    progressByProject.mockReset();
    listAssigneeOptions.mockReset();
    limits.mockReset();
    viewerContext.mockReset().mockResolvedValue({
      projectId: 5,
      userId: 9,
      active: true,
      manages: false,
      member: true,
    });
    getMinutesByProject.mockReset().mockResolvedValue({ 5: 600, 6: 120 });
    todoTakesLines.mockReset().mockResolvedValue(true);
  });

  afterEach(() => setNowForTests(null));

  it('checks the membership first and gives the member view', async () => {
    const head = await loadProjectHead(5, VISHAL);
    expect(isMember).toHaveBeenCalledWith({ projectId: 5, userId: 9 });
    expect(isMember.mock.invocationCallOrder[0]).toBeLessThan(findById.mock.invocationCallOrder[0]);
    expect(head.access).toBe('member');
    expect(head.canManage).toBe(false);
    expect(head.filesAccess).toBe('member');
    expect(head.today).toBe(TODAY);
    expect(head.plan).toBe(plan);
  });

  it('computes no forecast for a member', async () => {
    const head = await loadProjectHead(5, VISHAL);
    expect(head).not.toHaveProperty('forecast');
    expect(progressByProject).not.toHaveBeenCalled();
  });

  it('adds their own minutes this company month', async () => {
    const head = await loadProjectHead(5, VISHAL);
    expect(head.hoursThisMonth).toBe(600);
    expect(getMinutesByProject).toHaveBeenCalledWith({
      from: '2026-11-01',
      to: '2026-11-30',
      userId: 9,
    });
  });

  it('reads 0 hours when they logged none on this project', async () => {
    getMinutesByProject.mockResolvedValue({ 6: 120 });
    expect((await loadProjectHead(5, VISHAL)).hoursThisMonth).toBe(0);
  });

  it('leaves the hours out when the reports can’t be read', async () => {
    getMinutesByProject.mockRejectedValue(new Error('down'));
    expect((await loadProjectHead(5, VISHAL)).hoursThisMonth).toBeNull();
  });

  it('gives HR on the project the member view', async () => {
    const head = await loadProjectHead(5, NEHA);
    expect(head.access).toBe('member');
    expect(head.hoursThisMonth).toBe(600);
  });

  it('says whether the task window offers "Add to to-do" (today’s to-do takes lines)', async () => {
    expect((await loadProjectHead(5, VISHAL)).todoOpen).toBe(true);
    expect(todoTakesLines).toHaveBeenCalledWith({ user: VISHAL });
    todoTakesLines.mockResolvedValue(false); // the report is in
    expect((await loadProjectHead(5, VISHAL)).todoOpen).toBe(false);
    todoTakesLines.mockRejectedValue(new Error('down'));
    expect((await loadProjectHead(5, VISHAL)).todoOpen).toBe(false);
  });

  it('gives no limits or people list to a member', async () => {
    const head = await loadProjectHead(5, VISHAL);
    expect(head).not.toHaveProperty('limits');
    expect(head).not.toHaveProperty('options');
    expect(limits).not.toHaveBeenCalled();
    expect(listAssigneeOptions).not.toHaveBeenCalled();
  });

  it.each([
    ['an employee', VISHAL],
    ['HR', NEHA],
  ])('answers null for %s who isn’t on the project, reading nothing about it', async (_, user) => {
    isMember.mockResolvedValue(false);
    expect(await loadProjectHead(5, user)).toBeNull();
    expect(findById).not.toHaveBeenCalled();
    expect(getPlan).not.toHaveBeenCalled();
    expect(viewerContext).not.toHaveBeenCalled();
  });

  it('answers null for a member when the project is gone', async () => {
    findById.mockResolvedValue(null);
    expect(await loadProjectHead(5, VISHAL)).toBeNull();
  });
});
