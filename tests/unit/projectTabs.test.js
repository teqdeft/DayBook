// The project page's frame (CONTRACT 27): the tab comes from the URL and the viewer's access
// (`phases` and `overview` open the Board, old range links open Hours in the PM view only, a member
// asking for Summary, Timeline or Hours gets the Board, `show` never changes the tab), and only the
// chosen tab is mounted, so only that tab loads its data. The PM view's header carries the health
// tag, the Urgent tag and "+ New task" (the project's PM and Admins, never on a Completed project);
// the New task window and the attach store are mounted for managers only, the task window for
// everyone. The tabs and providers are stubbed here: the tabs are async and renderToStaticMarkup
// can't wait for them (projectSummaryTab.test.js and the Board's own tests render them). Vite can't
// read JSX in page.js, so this renders ProjectView, which is all page.js renders for the PM view.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

let searchParams = new URLSearchParams();
const openNew = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  usePathname: () => '/projects/5',
  useSearchParams: () => searchParams,
}));
vi.mock('@/lib/session', () => ({ getSessionUser: async () => null }));
vi.mock('@/components/TopBar', () => ({
  default: ({ title, subtitle, breadcrumb, actions }) =>
    createElement('header', null, breadcrumb.at(-1).label, title, subtitle, actions),
}));
const stub = (name) => ({
  default: (props) =>
    createElement('main', { 'data-place': props.place ?? undefined }, `the ${name} tab`),
});
vi.mock('@/app/(app)/projects/[id]/BoardTab', () => stub('board'));
vi.mock('@/app/(app)/projects/[id]/SummaryTab', () => stub('summary'));
vi.mock('@/app/(app)/projects/[id]/FilesTab', () => stub('files'));
vi.mock('@/app/(app)/projects/[id]/TimelineTab', () => stub('timeline'));
vi.mock('@/app/(app)/projects/[id]/HoursTab', () => stub('hours'));
// The providers say what they were given, so the page's wiring shows in the markup.
const provider = (name, keys) =>
  function Provider(props) {
    const given = keys.map((key) => `${key}=${props[key]}`).join(',');
    return createElement('div', { 'data-provider': name, 'data-props': given }, props.children);
  };
vi.mock('@/app/(app)/projects/[id]/_board/TaskEditorProvider', () => ({
  TaskEditorProvider: provider('editor', ['projectId', 'viewerId']),
  useTaskEditor: () => ({ openNew }),
}));
vi.mock('@/components/files/TaskAttachProvider', () => ({
  TaskAttachProvider: provider('attach', ['projectId']),
  useTaskAttach: () => null,
}));
vi.mock('@/components/task/TaskWindowProvider', () => ({
  TaskWindowProvider: provider('window', ['mode', 'projectId']),
  useTaskWindow: () => null,
}));
// The page-wide file drop guard draws nothing; here it says where it is mounted.
vi.mock('@/app/(app)/projects/[id]/FileDropGuard', () => ({
  default: () => createElement('i', { 'data-drop-guard': 'on' }),
}));

const {
  default: ProjectTabs,
  MEMBER_TABS,
  PROJECT_TABS,
  chosenTab,
  tabHref,
  tabsFor,
} = await import('@/app/(app)/projects/[id]/ProjectTabs.jsx');
const { default: ProjectView } = await import('@/app/(app)/projects/[id]/ProjectView.jsx');
const { default: ProjectLoading } = await import('@/app/(app)/projects/[id]/ProjectLoading.jsx');
const { ProjectSkeleton, TabSkeleton } = await import('@/app/(app)/projects/[id]/TabSkeletons.jsx');

const LIMITS = { maxFileBytes: 524288000, maxTaskFiles: 20, pickMax: 50 };

const HEAD = {
  project: {
    id: 5,
    name: 'acme-store',
    clientName: 'Acme Retail',
    pmName: 'Riya Kapoor',
    color: 'blue',
    status: 'active',
    statusLabel: 'Active',
    isUrgent: false,
    urgentNote: null,
  },
  plan: { currentPhase: 'development', deadline: null, phases: [] },
  forecast: { kind: 'off', pill: 'Off track' },
  today: '2026-11-23',
  canManage: true,
  access: 'manage',
  filesAccess: 'manage',
  limits: LIMITS,
  options: [{ id: 9, name: 'Vishal Saini' }],
};

const OTHER_PM = { ...HEAD, canManage: false, access: 'team', filesAccess: 'none' };
delete OTHER_PM.limits;
delete OTHER_PM.options;

const page = (query = {}, head = HEAD) =>
  renderToStaticMarkup(createElement(ProjectView, { user: { id: 7 }, head, query }));

const noTags = (html) => html.replace(/<[^>]*>/g, '');

describe('chosenTab', () => {
  it('opens the Board by default, for every view', () => {
    expect(chosenTab({})).toBe('board');
    expect(chosenTab(undefined)).toBe('board');
    for (const access of ['manage', 'team', 'member']) expect(chosenTab({}, access)).toBe('board');
  });

  it.each(['board', 'summary', 'files', 'timeline', 'hours'])(
    'opens %s in the PM view when the URL says so',
    (tab) => {
      expect(chosenTab({ tab }, 'manage')).toBe(tab);
      expect(chosenTab({ tab }, 'team')).toBe(tab);
    },
  );

  it.each(['phases', 'overview'])('opens the Board for the old %s tab', (tab) => {
    for (const access of ['manage', 'team', 'member', undefined]) {
      expect(chosenTab({ tab }, access)).toBe('board');
      expect(chosenTab({ tab, range: 'week' }, access)).toBe('board');
    }
  });

  it.each([
    [{ range: 'week' }],
    [{ range: 'custom', from: '2026-10-01', to: '2026-10-31' }],
    [{ from: '2026-10-01' }],
    [{ to: '2026-10-31' }],
  ])('opens Hours for an old range link in the PM view only: %j', (query) => {
    expect(chosenTab(query, 'manage')).toBe('hours');
    expect(chosenTab(query, 'team')).toBe('hours');
    expect(chosenTab(query, 'member')).toBe('board');
  });

  it.each(['summary', 'timeline', 'hours'])('gives a member asking for %s the Board', (tab) => {
    expect(chosenTab({ tab }, 'member')).toBe('board');
    expect(chosenTab({ tab, range: 'week' }, 'member')).toBe('board');
  });

  it('lets a member open Files', () => {
    expect(chosenTab({ tab: 'files' }, 'member')).toBe('files');
    expect(chosenTab({ tab: 'files', place: 'design' }, 'member')).toBe('files');
  });

  it('keeps the tab asked for when a range comes with it', () => {
    expect(chosenTab({ tab: 'timeline', range: 'week' }, 'manage')).toBe('timeline');
  });

  it('ignores show, the Board’s pills', () => {
    expect(chosenTab({ show: 'critical' }, 'manage')).toBe('board');
    expect(chosenTab({ tab: 'board', show: 'files' }, 'team')).toBe('board');
    expect(chosenTab({ tab: 'summary', show: 'critical' }, 'manage')).toBe('summary');
    expect(chosenTab({ show: 'critical' }, 'member')).toBe('board');
  });

  it('ignores a tab it does not know', () => {
    expect(chosenTab({ tab: 'nope' }, 'manage')).toBe('board');
    expect(chosenTab({ tab: 'nope', range: 'week' }, 'manage')).toBe('hours');
    expect(chosenTab({ tab: 'nope', range: 'week' }, 'member')).toBe('board');
  });

  it('reads the first of a repeated parameter', () => {
    expect(chosenTab({ tab: ['files', 'hours'] }, 'manage')).toBe('files');
    expect(chosenTab({ tab: ['phases', 'hours'] }, 'manage')).toBe('board');
    expect(chosenTab({ range: ['week', 'month'] }, 'manage')).toBe('hours');
  });
});

describe('ProjectTabs', () => {
  const html = (access, tab = 'board') =>
    renderToStaticMarkup(createElement(ProjectTabs, { projectId: 5, tab, access }));

  it('links every PM tab in the design order', () => {
    expect(PROJECT_TABS.map((tab) => tab.label)).toEqual([
      'Board',
      'Summary',
      'Files',
      'Timeline',
      'Hours',
    ]);
    expect(tabsFor('manage')).toBe(PROJECT_TABS);
    expect(tabsFor('team')).toBe(PROJECT_TABS);
    expect(tabHref(5, 'files')).toBe('/projects/5?tab=files');
    for (const { key } of PROJECT_TABS)
      expect(html('manage')).toContain(`href="/projects/5?tab=${key}"`);
  });

  it('gives a member Board and Files only', () => {
    expect(MEMBER_TABS.map((tab) => tab.label)).toEqual(['Board', 'Files']);
    expect(tabsFor('member')).toBe(MEMBER_TABS);
    const member = noTags(html('member'));
    expect(member).toBe('BoardFiles');
    expect(html('member')).not.toContain('tab=summary');
    expect(html('member')).not.toContain('tab=hours');
  });

  it('marks only the chosen tab as current', () => {
    const current = html('manage', 'files').match(/aria-current="page"/g);
    expect(current).toHaveLength(1);
    expect(html('manage', 'files')).toMatch(/<a [^>]*aria-current="page"[^>]*>Files<\/a>/);
    expect(html('member', 'board')).toMatch(/<a [^>]*aria-current="page"[^>]*>Board<\/a>/);
  });
});

describe('the project page', () => {
  it.each([
    [{}, 'the board tab'],
    [{ tab: 'board' }, 'the board tab'],
    [{ tab: 'phases' }, 'the board tab'],
    [{ tab: 'overview' }, 'the board tab'],
    [{ tab: 'summary' }, 'the summary tab'],
    [{ tab: 'files' }, 'the files tab'],
    [{ tab: 'timeline' }, 'the timeline tab'],
    [{ tab: 'hours' }, 'the hours tab'],
    [{ range: 'month' }, 'the hours tab'],
    [{ show: 'critical' }, 'the board tab'],
  ])('mounts only the chosen tab for %j', (query, shown) => {
    const html = page(query);
    expect(html).toContain(shown);
    const others = ['board', 'summary', 'files', 'timeline', 'hours']
      .map((tab) => `the ${tab} tab`)
      .filter((tab) => tab !== shown);
    for (const tab of others) expect(html).not.toContain(tab);
  });

  it('hands the Files tab its place', () => {
    expect(page({ tab: 'files', place: 'design' })).toContain('data-place="design"');
    expect(page({ tab: 'files', place: ['tasks', 'design'] })).toContain('data-place="tasks"');
  });

  it('shows the name, health tag and subtitle above the tabs', () => {
    const html = page();
    expect(html).toContain('acme-store');
    expect(html).toContain('Off track');
    expect(html).toContain('Acme Retail · PM: Riya Kapoor · Active');
    expect(html).toContain('aria-label="Project sections"');
    expect(noTags(html)).not.toContain('Urgent');
  });

  it('adds the Urgent tag and keeps the urgent note in the subtitle', () => {
    const project = { ...HEAD.project, isUrgent: true, urgentNote: 'Checkout fix before demo' };
    const html = page({}, { ...HEAD, project });
    expect(html).toMatch(/<span class="[^"]*marigold[^"]*">Urgent<\/span>/);
    expect(html).toContain('Urgent: Checkout fix before demo');
  });

  it('offers "+ New task" to the project’s PM and Admins', () => {
    const html = page();
    expect(noTags(html)).toContain('New task');
    expect(html).toContain('lucide-plus');
  });

  it('has no "+ New task" on a Completed project or for another PM', () => {
    const completed = { ...HEAD.project, status: 'completed', statusLabel: 'Completed' };
    expect(noTags(page({}, { ...HEAD, project: completed }))).not.toContain('New task');
    expect(noTags(page({}, OTHER_PM))).not.toContain('New task');
  });

  it('mounts the New task window and the attach store for managers, around every tab', () => {
    for (const tab of ['board', 'summary', 'files', 'timeline', 'hours']) {
      const html = page({ tab });
      expect(html).toContain('data-provider="editor" data-props="projectId=5,viewerId=7"');
      expect(html).toContain('data-provider="attach" data-props="projectId=5"');
      expect(html).toContain('data-provider="window" data-props="mode=manage,projectId=5"');
    }
  });

  it('swallows files dropped off a card on every tab for managers, not only on the Board', () => {
    for (const tab of ['board', 'summary', 'files', 'timeline', 'hours']) {
      expect(page({ tab }).match(/data-drop-guard/g)).toHaveLength(1);
    }
  });

  it('gives another PM only the task window, read only', () => {
    const html = page({}, OTHER_PM);
    expect(html).not.toContain('data-provider="editor"');
    expect(html).not.toContain('data-provider="attach"');
    expect(html).not.toContain('data-drop-guard');
    expect(html).toContain('data-provider="window" data-props="mode=team,projectId=5"');
    expect(html).toContain('Off track');
    expect(noTags(html)).toContain('BoardSummaryFilesTimelineHours');
  });

  it('puts the header inside the providers, so "+ New task" opens the shared window', () => {
    const html = page();
    expect(html.indexOf('data-provider="editor"')).toBeLessThan(html.indexOf('<header>'));
    expect(html.indexOf('data-provider="window"')).toBeLessThan(html.indexOf('<header>'));
  });
});

describe('the skeletons', () => {
  it('draws the frame and the Board while the page loads', () => {
    const html = renderToStaticMarkup(createElement(ProjectSkeleton));
    expect(html).toContain('Loading the project');
    expect(html).toContain('Loading the board');
  });

  it('draws the tab the URL asks for', () => {
    searchParams = new URLSearchParams('tab=timeline');
    expect(renderToStaticMarkup(createElement(ProjectLoading))).toContain('Loading the timeline');
    searchParams = new URLSearchParams('tab=phases');
    expect(renderToStaticMarkup(createElement(ProjectLoading))).toContain('Loading the board');
    searchParams = new URLSearchParams('range=week');
    expect(renderToStaticMarkup(createElement(ProjectLoading))).toContain('Loading the hours');
    searchParams = new URLSearchParams('tab=files&place=design');
    expect(renderToStaticMarkup(createElement(ProjectLoading))).toContain('Loading the files');
    searchParams = new URLSearchParams();
    expect(renderToStaticMarkup(createElement(ProjectLoading))).toContain('Loading the board');
  });

  it.each([
    ['board', 'Loading the board'],
    ['summary', 'Loading the summary'],
    ['files', 'Loading the files'],
    ['timeline', 'Loading the timeline'],
    ['hours', 'Loading the hours'],
  ])('has one for the %s tab', (tab, text) => {
    expect(renderToStaticMarkup(createElement(TabSkeleton, { tab }))).toContain(text);
  });

  it('draws five tabs for the PM view and two for a member', () => {
    const tabs = (access) =>
      /_tabs_[^"]*"[^>]*>(.*?)<\/div>/
        .exec(renderToStaticMarkup(createElement(ProjectSkeleton, { access })))[1]
        .match(/<span/g);
    expect(tabs('manage')).toHaveLength(5);
    expect(tabs(undefined)).toHaveLength(5);
    expect(tabs('member')).toHaveLength(2);
  });
});
