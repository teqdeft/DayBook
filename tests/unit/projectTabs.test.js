// The project page's frame (CONTRACT 22): the tab comes from the URL, old range links open Hours, and
// only the chosen tab is mounted, so only that tab loads its data. The tabs are stubbed here: they are
// async and renderToStaticMarkup can't wait for them (projectOverview.test.js renders them). Vite
// can't read JSX in page.js, so this renders ProjectView, which is all page.js renders.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  useSearchParams: () => searchParams,
}));
vi.mock('@/lib/session', () => ({ getSessionUser: async () => null }));
vi.mock('@/components/TopBar', () => ({
  default: ({ title, subtitle, breadcrumb }) =>
    createElement('header', null, breadcrumb.at(-1).label, title, subtitle),
}));
const stub = (name) => ({ default: () => createElement('main', null, name) });
vi.mock('@/app/(app)/projects/[id]/OverviewTab', () => stub('the overview tab'));
vi.mock('@/app/(app)/projects/[id]/PhasesTab', () => stub('the phases tab'));
vi.mock('@/app/(app)/projects/[id]/TimelineTab', () => stub('the timeline tab'));
vi.mock('@/app/(app)/projects/[id]/HoursTab', () => stub('the hours tab'));

const {
  default: ProjectTabs,
  PROJECT_TABS,
  chosenTab,
  tabHref,
} = await import('@/app/(app)/projects/[id]/ProjectTabs.jsx');
const { default: ProjectView } = await import('@/app/(app)/projects/[id]/ProjectView.jsx');
const { default: ProjectLoading } = await import('@/app/(app)/projects/[id]/ProjectLoading.jsx');
const { ProjectSkeleton, TabSkeleton } = await import('@/app/(app)/projects/[id]/TabSkeletons.jsx');

const HEAD = {
  project: {
    id: 5,
    name: 'Acme booking app',
    clientName: 'Acme Clinics',
    pmName: 'Riya Kapoor',
    color: 'blue',
    status: 'active',
    statusLabel: 'Active',
    isUrgent: false,
    urgentNote: null,
  },
  plan: { currentPhase: null, deadline: null, phases: [] },
  forecast: { kind: 'off', pill: 'Off track' },
  today: '2026-10-30',
  canManage: true,
};

const page = (query = {}, head = HEAD) =>
  renderToStaticMarkup(createElement(ProjectView, { user: { id: 7 }, head, query }));

describe('chosenTab', () => {
  it('opens Overview by default', () => {
    expect(chosenTab({})).toBe('overview');
    expect(chosenTab(undefined)).toBe('overview');
  });

  it.each(['overview', 'phases', 'timeline', 'hours'])('opens %s when the URL says so', (tab) => {
    expect(chosenTab({ tab })).toBe(tab);
  });

  it.each([
    [{ range: 'week' }],
    [{ range: 'custom', from: '2026-10-01', to: '2026-10-31' }],
    [{ from: '2026-10-01' }],
    [{ to: '2026-10-31' }],
  ])('opens Hours for an old range link: %j', (query) => {
    expect(chosenTab(query)).toBe('hours');
  });

  it('keeps the tab asked for when a range comes with it', () => {
    expect(chosenTab({ tab: 'timeline', range: 'week' })).toBe('timeline');
  });

  it('ignores a tab it does not know', () => {
    expect(chosenTab({ tab: 'nope' })).toBe('overview');
    expect(chosenTab({ tab: 'nope', range: 'week' })).toBe('hours');
  });

  it('reads the first of a repeated parameter', () => {
    expect(chosenTab({ tab: ['phases', 'hours'] })).toBe('phases');
    expect(chosenTab({ range: ['week', 'month'] })).toBe('hours');
  });
});

describe('ProjectTabs', () => {
  const html = () =>
    renderToStaticMarkup(createElement(ProjectTabs, { projectId: 5, tab: 'phases' }));

  it('links every tab in the design order', () => {
    expect(PROJECT_TABS.map((tab) => tab.label)).toEqual([
      'Overview',
      'Phases',
      'Timeline',
      'Hours',
    ]);
    expect(tabHref(5, 'phases')).toBe('/projects/5?tab=phases');
    for (const { key } of PROJECT_TABS) expect(html()).toContain(`href="/projects/5?tab=${key}"`);
  });

  it('marks only the chosen tab as current', () => {
    const current = html().match(/aria-current="page"/g);
    expect(current).toHaveLength(1);
    expect(html()).toMatch(/<a [^>]*aria-current="page"[^>]*>Phases<\/a>/);
  });
});

describe('the project page', () => {
  it.each([
    [{}, 'the overview tab'],
    [{ tab: 'phases' }, 'the phases tab'],
    [{ tab: 'timeline' }, 'the timeline tab'],
    [{ tab: 'hours' }, 'the hours tab'],
    [{ range: 'month' }, 'the hours tab'],
  ])('mounts only the chosen tab for %j', (query, shown) => {
    const html = page(query);
    expect(html).toContain(shown);
    const others = ['overview', 'phases', 'timeline', 'hours']
      .map((tab) => `the ${tab} tab`)
      .filter((tab) => tab !== shown);
    for (const tab of others) expect(html).not.toContain(tab);
  });

  it('shows the name, health pill and subtitle above the tabs', () => {
    const html = page();
    expect(html).toContain('Acme booking app');
    expect(html).toContain('Off track');
    expect(html).toContain('Acme Clinics · PM: Riya Kapoor · Active');
    expect(html).toContain('aria-label="Project sections"');
  });

  it('keeps the urgent note in the subtitle', () => {
    const project = { ...HEAD.project, isUrgent: true, urgentNote: 'Launch on Friday' };
    expect(page({}, { ...HEAD, project })).toContain('Urgent: Launch on Friday');
  });
});

describe('the skeletons', () => {
  it('draws the frame and Overview while the page loads', () => {
    const html = renderToStaticMarkup(createElement(ProjectSkeleton));
    expect(html).toContain('Loading the project');
    expect(html).toContain('Loading the overview');
  });

  it('draws the tab the URL asks for', () => {
    searchParams = new URLSearchParams('tab=timeline');
    expect(renderToStaticMarkup(createElement(ProjectLoading))).toContain('Loading the timeline');
    searchParams = new URLSearchParams('range=week');
    expect(renderToStaticMarkup(createElement(ProjectLoading))).toContain('Loading the hours');
    searchParams = new URLSearchParams();
    expect(renderToStaticMarkup(createElement(ProjectLoading))).toContain('Loading the overview');
  });

  it.each([
    ['overview', 'Loading the overview'],
    ['phases', 'Loading the phases'],
    ['timeline', 'Loading the timeline'],
    ['hours', 'Loading the hours'],
  ])('has one for the %s tab', (tab, text) => {
    expect(renderToStaticMarkup(createElement(TabSkeleton, { tab }))).toContain(text);
  });
});
