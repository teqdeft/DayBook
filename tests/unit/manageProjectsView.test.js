// The projects table PMs and Admin see (ManageProjectsView, CONTRACT 16), really rendered with the
// database-backed modules mocked: the hours range sets the column's header, hours and queries, and
// every link and the custom form keep the range, the status tab and the search. TopBar is stubbed:
// it is async and renderToStaticMarkup can't wait for it.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { setNowForTests } from '@/lib/time';
import { projectReportPeriod } from '@/modules/dashboard/projectReportPeriods';

const WEDNESDAY = '2026-11-04T06:30:00Z'; // noon in Asia/Kolkata
const WEEK = { from: '2026-11-02', to: '2026-11-08' };
const MONTH = { from: '2026-11-01', to: '2026-11-30' };
const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
const ALL_TIME = { from: '2000-01-01', to: '2026-11-04' };
const BACKWARDS = { range: 'custom', from: '2026-10-31', to: '2026-10-01' };
const WRONG_ORDER = 'The start date must be on or before the end date.';
const PM = { id: 7, role: 'pm' };

const project = (id, name) => ({
  id,
  name,
  clientName: 'Acme',
  pmId: 7,
  pmName: 'Priya Nair',
  status: 'active',
  color: 'blue',
  isUrgent: false,
  urgentNote: null,
  members: [],
});
const PROJECTS = [project(1, 'Acme app'), project(2, 'Nova site')];

/** Project 1 has hours in the range; project 2 only has older ones. */
const someMinutes = async ({ from }) => (from === ALL_TIME.from ? { 1: 600, 2: 90 } : { 1: 105 });

const getAll = vi.fn();
const getMinutesByProject = vi.fn();
const list = vi.fn();
let counts;

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  useRouter: () => ({ replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/TopBar', () => ({
  default: ({ title, actions }) => createElement('header', null, title, actions),
}));
vi.mock('@/lib/session', () => ({ getSessionUser: async () => null }));
vi.mock('@/modules/projectTasks', () => ({ projectTasks: {} }));
vi.mock('@/modules/settings', () => ({ settings: { getAll: () => getAll() } }));
vi.mock('@/modules/reports', () => ({
  reports: { getMinutesByProject: (range) => getMinutesByProject(range) },
}));
vi.mock('@/modules/projects', () => ({
  projects: {
    countByStatus: async () => counts,
    list: (filters) => list(filters),
    listManagerOptions: async () => [],
    listPeopleOptions: async () => [],
    canManage: (user, row) => row.pmId === user.id,
  },
}));
vi.mock('@/modules/dashboard', async () => {
  const { projectReportPeriod } = await import('@/modules/dashboard/projectReportPeriods');
  return { dashboard: { projectReportPeriod } };
});

const { default: ManageProjectsView } = await import('@/app/(app)/projects/ManageProjectsView.jsx');
const { ManageProjectsSkeleton } = await import('@/app/(app)/projects/ProjectsSkeletons.jsx');

const page = async (params = {}) =>
  renderToStaticMarkup(await ManageProjectsView({ user: PM, params }));

const decode = (text) =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&amp;', '&');
function textOf(html) {
  const words = decode(html.replace(/<[^>]+>/g, ' '));
  return words.replace(/\s+/g, ' ').trim();
}
function attr(attributes, name) {
  const match = attributes.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decode(match[1]) : undefined;
}

/** Every link in some HTML: its text, where it goes and whether it is the current one. */
const linksIn = (html) =>
  [...html.matchAll(/<a(\s[^>]*)>(.*?)<\/a>/gs)].map(([, attributes, inner]) => ({
    text: textOf(inner),
    href: attr(attributes, 'href'),
    current: attr(attributes, 'aria-current') === 'page',
  }));
function group(html, label) {
  const pattern = new RegExp(`role="group" aria-label="${label}"[^>]*>(.*?)</div>`, 's');
  return linksIn(html.match(pattern)[1]);
}
const hrefs = (links) => links.map((link) => link.href);
const hrefOf = (html, text) => linksIn(html).find((link) => link.text === text)?.href;
const selected = (html, label) =>
  group(html, label)
    .filter((link) => link.current)
    .map((link) => link.text);
const rangeOnScreen = (html) => selected(html, 'Hours range');

/** The hours column's header: its full text, then the one narrow tables show. */
const hoursHeader = (html) =>
  [...html.matchAll(/<th\s[^>]*>(.*?)<\/th>/gs)]
    .map(([, inner]) => textOf(inner))
    .find((text) => /hours/i.test(text));

/** What a column's cells say, row by row (data-label is the name narrow tables show). */
const cells = (html, label) =>
  [...html.matchAll(/<td(\s[^>]*)>(.*?)<\/td>/gs)]
    .filter(([, attributes]) => attr(attributes, 'data-label') === label)
    .map(([, , inner]) => textOf(inner));

/** The custom range form, or null when it isn't on the page. */
function rangeForm(html) {
  const match = html.match(/<form(\s[^>]*action="\/projects"[^>]*)>(.*?)<\/form>/s);
  if (!match) return null;
  const [, attributes, inner] = match;
  const inputs = [...inner.matchAll(/<input(\s[^>]*)\/>/g)].map(([, input]) => input);
  const named = (name) => inputs.find((input) => attr(input, 'name') === name);
  const hidden = inputs.filter((input) => attr(input, 'type') === 'hidden');
  const alerts = [...inner.matchAll(/<p\s[^>]*role="alert"[^>]*>(.*?)<\/p>/gs)];
  return {
    method: attr(attributes, 'method'),
    hidden: Object.fromEntries(hidden.map((input) => [attr(input, 'name'), attr(input, 'value')])),
    from: attr(named('from'), 'value'),
    to: attr(named('to'), 'value'),
    max: attr(named('from'), 'max'),
    errors: alerts.map(([, text]) => textOf(text)),
  };
}

const queries = () => getMinutesByProject.mock.calls.map(([range]) => range);

beforeEach(() => {
  setNowForTests(WEDNESDAY);
  counts = { active: 2, on_hold: 3, completed: 4 };
  getAll.mockReset().mockResolvedValue({ timezone: 'Asia/Kolkata' });
  getMinutesByProject.mockReset().mockImplementation(someMinutes);
  list.mockReset().mockResolvedValue({ rows: PROJECTS, total: 2 });
});

afterEach(() => {
  setNowForTests(null);
  vi.restoreAllMocks();
});

describe('the hours range', () => {
  it('opens on this week, Monday to Sunday, with all time under it', async () => {
    const html = await page();
    expect(hoursHeader(html)).toBe('Hours this week This week');
    expect(rangeOnScreen(html)).toEqual(['This week']);
    expect(queries()).toEqual([WEEK, ALL_TIME]);
    expect(cells(html, 'Hours this week')).toEqual(['1h 45m 10h total', '0h 1h 30m total']);
    expect(rangeForm(html)).toBeNull();
  });

  it("takes the week from the company's day", async () => {
    setNowForTests('2026-11-08T18:00:00Z'); // 11:30 PM on Sunday in Asia/Kolkata
    await page();
    expect(queries()).toEqual([WEEK, { from: ALL_TIME.from, to: '2026-11-08' }]);

    getMinutesByProject.mockClear();
    setNowForTests('2026-11-08T19:00:00Z'); // past midnight, already Monday
    await page();
    expect(queries()).toEqual([
      { from: '2026-11-09', to: '2026-11-15' },
      { from: ALL_TIME.from, to: '2026-11-09' },
    ]);
  });

  it('shows this month', async () => {
    const html = await page({ range: 'month' });
    expect(hoursHeader(html)).toBe('Hours this month This month');
    expect(rangeOnScreen(html)).toEqual(['This month']);
    expect(queries()).toEqual([MONTH, ALL_TIME]);
    expect(cells(html, 'Hours this month')).toEqual(['1h 45m 10h total', '0h 1h 30m total']);
    expect(rangeForm(html)).toBeNull();
  });

  it('shows all time with one query and no total line', async () => {
    const html = await page({ range: 'all' });
    expect(hoursHeader(html)).toBe('Total hours Total');
    expect(rangeOnScreen(html)).toEqual(['All time']);
    expect(queries()).toEqual([ALL_TIME]);
    expect(cells(html, 'Total hours')).toEqual(['10h', '1h 30m']);
    expect(textOf(html)).not.toMatch(/\d[hm] total/);
    expect(rangeForm(html)).toBeNull();
  });

  it('shows a custom range with its dates in the form', async () => {
    const html = await page({ range: 'custom', ...OCTOBER });
    expect(hoursHeader(html)).toBe('Hours in range In range');
    expect(rangeOnScreen(html)).toEqual(['Custom']);
    expect(queries()).toEqual([OCTOBER, ALL_TIME]);
    expect(cells(html, 'Hours in range')).toEqual(['1h 45m 10h total', '0h 1h 30m total']);
    expect(rangeForm(html)).toMatchObject({
      method: 'get',
      from: OCTOBER.from,
      to: OCTOBER.to,
      max: '2026-11-04',
      errors: [],
    });
  });

  it('reads dates without range=custom as a custom range', async () => {
    const html = await page(OCTOBER);
    expect(hoursHeader(html)).toBe('Hours in range In range');
    expect(rangeOnScreen(html)).toEqual(['Custom']);
    expect(queries()).toEqual([OCTOBER, ALL_TIME]);
  });

  it('leaves the total out when it says the same as the range', async () => {
    getMinutesByProject.mockReset().mockResolvedValue({ 1: 105 });
    const html = await page({ range: 'month' });
    expect(cells(html, 'Hours this month')).toEqual(['1h 45m', '0h']);
  });

  it('lists every project whatever the range', async () => {
    const ranges = [{}, { range: 'month' }, { range: 'all' }, { range: 'custom', ...OCTOBER }];
    for (const params of ranges) {
      list.mockClear();
      const html = await page(params);
      expect(list.mock.calls).toEqual([[{ status: 'active', q: '', limit: 100, offset: 0 }]]);
      for (const { name } of PROJECTS) expect(textOf(html)).toContain(name);
    }
  });
});

describe('a wrong range', () => {
  it('keeps a backwards range in the form, with the error, and shows this week', async () => {
    const html = await page(BACKWARDS);
    expect(rangeForm(html)).toMatchObject({
      from: BACKWARDS.from,
      to: BACKWARDS.to,
      errors: [WRONG_ORDER],
    });
    expect(hoursHeader(html)).toBe('Hours this week This week');
    expect(rangeOnScreen(html)).toEqual(['Custom']);
    expect(queries()).toEqual([WEEK, ALL_TIME]);
    expect(cells(html, 'Hours this week')).toEqual(['1h 45m 10h total', '0h 1h 30m total']);
  });

  it('carries none of it in the tab links', async () => {
    const html = await page(BACKWARDS);
    expect(hrefs(group(html, 'Project status'))).toEqual([
      '/projects',
      '/projects?status=on_hold',
      '/projects?status=completed',
    ]);
    expect(hrefs(group(html, 'Hours range'))).toEqual([
      '/projects',
      '/projects?range=month',
      '/projects?range=all',
      '/projects?range=custom&from=2026-11-02&to=2026-11-04',
    ]);
  });

  it('asks for the dates a custom range is missing', async () => {
    const html = await page({ range: 'custom' });
    expect(rangeForm(html)).toMatchObject({
      from: '',
      to: '',
      errors: ['Pick a start and an end date.'],
    });
    expect(hoursHeader(html)).toBe('Hours this week This week');
    expect(rangeOnScreen(html)).toEqual(['Custom']);
  });

  it('shows this week, without the form, for an unknown range', async () => {
    const html = await page({ range: 'year' });
    expect(rangeForm(html)).toBeNull();
    expect(hoursHeader(html)).toBe('Hours this week This week');
    expect(rangeOnScreen(html)).toEqual(['This week']);
    expect(hrefs(group(html, 'Hours range'))[1]).toBe('/projects?range=month');
  });
});

describe('the links', () => {
  it('keep the range and the search on the status tabs', async () => {
    const html = await page({ status: 'on_hold', q: 'acme app', range: 'month' });
    expect(selected(html, 'Project status')).toEqual(['On hold (3)']);
    expect(hrefs(group(html, 'Project status'))).toEqual([
      '/projects?q=acme+app&range=month',
      '/projects?status=on_hold&q=acme+app&range=month',
      '/projects?status=completed&q=acme+app&range=month',
    ]);
  });

  it('keep a custom range with its dates on the status tabs', async () => {
    const html = await page({ range: 'custom', ...OCTOBER });
    expect(hrefs(group(html, 'Project status'))).toEqual([
      '/projects?range=custom&from=2026-10-01&to=2026-10-31',
      '/projects?status=on_hold&range=custom&from=2026-10-01&to=2026-10-31',
      '/projects?status=completed&range=custom&from=2026-10-01&to=2026-10-31',
    ]);
  });

  it('keep the status tab and the search on the range control', async () => {
    const html = await page({ status: 'completed', q: 'acme', range: 'all' });
    expect(hrefs(group(html, 'Hours range'))).toEqual([
      '/projects?status=completed&q=acme',
      '/projects?status=completed&q=acme&range=month',
      '/projects?status=completed&q=acme&range=all',
      '/projects?status=completed&q=acme&range=custom&from=2026-11-01&to=2026-11-04',
    ]);
  });

  it('keep the range on Clear search', async () => {
    list.mockResolvedValue({ rows: [], total: 0 });
    const month = await page({ status: 'completed', q: 'nothing', range: 'month' });
    expect(textOf(month)).toContain('No projects match your search');
    expect(hrefOf(month, 'Clear search')).toBe('/projects?status=completed&range=month');

    const custom = await page({ q: 'nothing', range: 'custom', ...OCTOBER });
    expect(hrefOf(custom, 'Clear search')).toBe(
      '/projects?range=custom&from=2026-10-01&to=2026-10-31',
    );

    const week = await page({ q: 'nothing' });
    expect(hrefOf(week, 'Clear search')).toBe('/projects');
  });

  it('keep the range on See active projects', async () => {
    list.mockResolvedValue({ rows: [], total: 0 });
    const all = await page({ status: 'completed', range: 'all' });
    expect(textOf(all)).toContain('No completed projects');
    expect(hrefOf(all, 'See active projects')).toBe('/projects?range=all');

    const custom = await page({ status: 'on_hold', range: 'custom', ...OCTOBER });
    expect(hrefOf(custom, 'See active projects')).toBe(
      '/projects?range=custom&from=2026-10-01&to=2026-10-31',
    );

    const week = await page({ status: 'on_hold' });
    expect(hrefOf(week, 'See active projects')).toBe('/projects');
  });

  it('keep the range on the pager, and go back to the first page from the tabs', async () => {
    list.mockResolvedValue({ rows: PROJECTS, total: 250 });
    const html = await page({ status: 'on_hold', q: 'acme', range: 'month', page: '2' });
    expect(list.mock.calls[0][0].offset).toBe(100);
    expect(hrefOf(html, 'Previous')).toBe('/projects?status=on_hold&q=acme&range=month');
    expect(hrefOf(html, 'Next')).toBe('/projects?status=on_hold&q=acme&range=month&page=3');
    for (const { href } of [...group(html, 'Project status'), ...group(html, 'Hours range')]) {
      expect(href).not.toContain('page=');
    }
  });
});

describe('the custom form', () => {
  it('carries the status tab and the search through hidden inputs', async () => {
    const html = await page({ status: 'completed', q: 'acme "co" & sons', ...BACKWARDS });
    expect(rangeForm(html).hidden).toEqual({
      status: 'completed',
      q: 'acme "co" & sons',
      range: 'custom',
    });
  });

  it('leaves out the defaults and the page', async () => {
    expect(rangeForm(await page({ range: 'custom', ...OCTOBER, page: '2' })).hidden).toEqual({
      range: 'custom',
    });
    expect(rangeForm(await page({ q: 'acme', range: 'custom', ...OCTOBER })).hidden).toEqual({
      q: 'acme',
      range: 'custom',
    });
  });
});

describe('when the hours fail to load', () => {
  it('still renders the table, with no hours', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    getMinutesByProject.mockReset().mockRejectedValue(new Error('Database is down'));
    for (const [params, label] of [
      [{}, 'Hours this week'],
      [{ range: 'all' }, 'Total hours'],
      [{ range: 'custom', ...OCTOBER }, 'Hours in range'],
    ]) {
      warn.mockClear();
      const html = await page(params);
      expect(cells(html, label)).toEqual(['0h', '0h']);
      for (const { name } of PROJECTS) expect(textOf(html)).toContain(name);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toBe('projects: could not load project hours');
    }
  });
});

describe('when the settings fail to load', () => {
  it('still renders the table and the hours, on the default time zone', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    getAll.mockRejectedValue(new Error('settings table timeout'));
    setNowForTests('2026-11-08T19:00:00Z'); // past midnight in Asia/Kolkata, already Monday
    const html = await page();
    expect(queries()).toEqual([
      { from: '2026-11-09', to: '2026-11-15' },
      { from: ALL_TIME.from, to: '2026-11-09' },
    ]);
    expect(cells(html, 'Hours this week')).toEqual(['1h 45m 10h total', '0h 1h 30m total']);
    for (const { name } of PROJECTS) expect(textOf(html)).toContain(name);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe('projects: could not load the time zone');
  });
});

describe('the loading shape', () => {
  const skeleton = (props) => renderToStaticMarkup(createElement(ManageProjectsSkeleton, props));

  it('holds the place of the custom form only when the page will show it', () => {
    expect(skeleton()).not.toContain('height:98px');
    expect(skeleton({ custom: true })).toContain('height:98px');
  });
});

describe('the dashboard module', () => {
  // The render above mocks it, so this is what ties the view to the real thing.
  it('exposes the period the view reads', async () => {
    const { dashboard } = await vi.importActual('@/modules/dashboard');
    expect(dashboard.projectReportPeriod).toBe(projectReportPeriod);
  });
});
