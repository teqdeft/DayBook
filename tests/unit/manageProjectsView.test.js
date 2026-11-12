// The projects table PMs and Admin see (ManageProjectsView, CONTRACT 16 and 22), really rendered with
// the database-backed modules mocked: each project's health, phase, progress and deadline, sorted
// with the forecast's rank; the hours range sets the column's header, hours and queries; and every
// link and the custom form keep the range, the status tab and the search. The forecast is the real
// one. TopBar is stubbed: it is async and renderToStaticMarkup can't wait for it. Menu is stubbed so
// its closed list can be read.
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
const listPlans = vi.fn();
const progressByProject = vi.fn();
let counts;

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  useRouter: () => ({ replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/TopBar', () => ({
  default: ({ title, subtitle, actions }) =>
    createElement('header', null, title, createElement('p', null, subtitle), actions),
}));
vi.mock('@/components/Menu', () => ({
  default: ({ items }) =>
    items.map((item) =>
      createElement(item.href ? 'a' : 'button', { key: item.label, href: item.href }, item.label),
    ),
}));
vi.mock('@/modules/projectPlan', () => ({
  projectPlan: { listPlans: (ids) => listPlans(ids) },
}));
vi.mock('@/modules/projectTasks', () => ({
  projectTasks: { progressByProject: (ids, options) => progressByProject(ids, options) },
}));
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
const { default: HoursCard } = await import('@/app/(app)/team/HoursCard.jsx');

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

const subtitleOf = (html) => textOf(html.match(/<p>(.*?)<\/p>/s)[1]);

/** The table's column headers, in order. */
const headers = (html) =>
  [...html.matchAll(/<th\s[^>]*>(.*?)<\/th>/gs)].map(([, inner]) => textOf(inner));

/** The class of the health tag in each row. */
const healthTags = (html) =>
  [...html.matchAll(/<td(\s[^>]*)>(.*?)<\/td>/gs)]
    .filter(([, attributes]) => attr(attributes, 'data-label') === 'Health')
    .map(([, , inner]) => attr(inner.match(/<span(\s[^>]*)>/)[1], 'class'));

/**
 * The page lists these projects, each with its own plan and tasks.
 * @param {Array<{ id: number, name: string, status?: string, phase?: string, deadline?: string,
 *   tasks?: [number, number, number[]], extra?: object }>} specs tasks: [total, done, doneByWeek];
 *   extra: more fields on the project
 * @param {number} [total] the rows in the tab, when there are more than these
 */
function plan(specs, total = specs.length) {
  const rows = specs.map(({ id, name, status = 'active', extra }) => ({
    ...project(id, name),
    status,
    ...extra,
  }));
  list.mockResolvedValue({ rows, total });
  const byId = (read) => Object.fromEntries(specs.map((spec) => [spec.id, read(spec)]));
  listPlans.mockResolvedValue(
    byId(({ phase = null, deadline = null }) => ({ currentPhase: phase, deadline })),
  );
  progressByProject.mockResolvedValue(
    byId(({ tasks: [all, done, doneByWeek] = [0, 0, [0, 0, 0]] }) => ({
      total: all,
      done,
      doneByWeek,
    })),
  );
}

// Today is 4 Nov 2026, and with no createdAt all 3 weeks count.
const OFF = { deadline: '2026-12-15', tasks: [20, 4, [1, 1, 1]] }; // 16 left, ends 24 Feb
const LATE = { deadline: '2026-10-30', tasks: [10, 6, [2, 2, 2]] }; // the deadline passed
const RISK = { deadline: '2026-11-15', tasks: [10, 6, [2, 2, 2]] }; // ends 18 Nov
const ON = { deadline: '2026-12-15', tasks: [10, 8, [2, 2, 2]] }; // ends 11 Nov
const NO_DATA = { deadline: '2026-12-15', tasks: [10, 0, [0, 0, 0]] };
const NO_DEADLINE = { tasks: [10, 4, [1, 1, 1]] };

beforeEach(() => {
  setNowForTests(WEDNESDAY);
  counts = { active: 2, on_hold: 3, completed: 4 };
  getAll.mockReset().mockResolvedValue({ timezone: 'Asia/Kolkata' });
  getMinutesByProject.mockReset().mockImplementation(someMinutes);
  list.mockReset().mockResolvedValue({ rows: PROJECTS, total: 2 });
  listPlans.mockReset().mockResolvedValue({});
  progressByProject.mockReset().mockResolvedValue({});
});

afterEach(() => {
  setNowForTests(null);
  vi.restoreAllMocks();
});

describe('the columns', () => {
  it("are the prototype's, then the row menu", async () => {
    expect(headers(await page())).toEqual([
      'Project',
      'Health',
      'Phase',
      'Progress',
      'Deadline',
      'Manager',
      'Hours this week This week',
      'Actions',
    ]);
  });

  it('put the client under the name, which links to the project', async () => {
    const html = await page();
    expect(cells(html, 'Project')).toEqual(['A Acme app Acme', 'N Nova site Acme']);
    expect(hrefOf(html, 'Acme app')).toBe('/projects/1');
  });

  it('show the phase, or a muted Not set', async () => {
    plan([
      { id: 1, name: 'Acme app', phase: 'requirement_gathering' },
      { id: 2, name: 'Nova site' },
    ]);
    const html = await page();
    expect(cells(html, 'Phase')).toEqual(['Requirement gathering', 'Not set']);
    expect(html).toMatch(/mutedText[^>]*>Not set</);
    expect(html).not.toMatch(/mutedText[^>]*>Requirement gathering</);
  });

  it('show a thin bar and the percent, or No tasks yet', async () => {
    plan([
      { id: 1, name: 'Acme app', tasks: [8, 3, [0, 0, 0]] },
      { id: 2, name: 'Nova site' },
    ]);
    const html = await page();
    expect(cells(html, 'Progress')).toEqual(['38%', 'No tasks yet']);
    expect(html).toContain('style="height:6px"');
    expect(html).toContain('width:38%');
  });

  it('show 0% with tasks and none done, and 100% with all done', async () => {
    plan([
      { id: 1, name: 'Acme app', tasks: [4, 0, [0, 0, 0]] },
      { id: 2, name: 'Nova site', tasks: [4, 4, [4, 0, 0]] },
    ]);
    expect(cells(await page(), 'Progress')).toEqual(['0%', '100%']);
  });

  it('show the deadline with its year, or a muted No deadline', async () => {
    plan([
      { id: 1, name: 'Acme app', deadline: '2027-01-05', tasks: [4, 4, [4, 0, 0]] },
      { id: 2, name: 'Nova site' },
    ]);
    const html = await page();
    expect(cells(html, 'Deadline')).toEqual(['5 Jan 2027', 'No deadline']);
    expect(html).toMatch(/mutedText[^>]*>No deadline</);
  });

  it('show the manager, or Not set when there is none', async () => {
    plan([
      { id: 1, name: 'Acme app' },
      { id: 2, name: 'Nova site', extra: { pmName: null } },
    ]);
    expect(cells(await page(), 'Manager')).toEqual(['Priya Nair', 'Not set']);
  });

  it('offer the row menu only on the projects you manage, with Phases and tasks', async () => {
    plan([
      { id: 1, name: 'Acme app' },
      { id: 2, name: 'Nova site', extra: { pmId: 99, pmName: 'Someone else' } },
    ]);
    const html = await page();
    expect(linksIn(html).filter((link) => link.text === 'Phases and tasks')).toEqual([
      { text: 'Phases and tasks', href: '/projects/1?tab=phases', current: false },
    ]);
    expect(html).not.toContain('Priority tasks');
    expect(html).not.toContain('#priority');
  });
});

describe('the health pill', () => {
  const pillOf = async (spec, status) => {
    plan([{ id: 1, name: 'Acme app', status, ...spec }]);
    const html = await page();
    return { text: cells(html, 'Health')[0], tag: healthTags(html)[0] };
  };

  it.each([
    ['Off track', 'red', OFF],
    ['Off track', 'red', LATE],
    ['At risk', 'marigold', RISK],
    ['On track', 'green', ON],
    ['On track', 'green', { deadline: '2026-12-15', tasks: [5, 5, [0, 0, 0]] }],
    ['Not enough data', 'neutral', NO_DATA],
    ['No deadline', 'neutral', NO_DEADLINE],
    ['No plan yet', 'neutral', {}],
  ])('reads %s in %s', async (text, tone, spec) => {
    const pill = await pillOf(spec);
    expect(pill.text).toBe(text);
    expect(pill.tag).toContain(`_${tone}_`);
  });

  it('follows the status before anything else', async () => {
    expect((await pillOf(OFF, 'on_hold')).text).toBe('On hold');
    expect((await pillOf(OFF, 'completed')).text).toBe('Completed');
  });

  it("counts the weeks from the project's first day at the company, not in UTC", async () => {
    // 1:30 AM on Tuesday 27 Oct in Asia/Kolkata: less than a full week before this Monday, so no
    // week counts yet. By the UTC date (Monday 26 Oct) one would.
    const spec = { deadline: '2026-12-15', tasks: [10, 3, [3, 0, 0]] };
    const extra = { createdAt: new Date('2026-10-26T20:00:00Z') };
    expect((await pillOf({ ...spec, extra })).text).toBe('Not enough data');
    expect((await pillOf(spec)).text).not.toBe('Not enough data');
  });
});

describe('the order', () => {
  const namesIn = (html) => cells(html, 'Project').map((text) => text.slice(2));

  it('goes by the forecast, then the nearest deadline, then name', async () => {
    plan([
      { id: 1, name: 'No plan' },
      { id: 2, name: 'On track', ...ON },
      { id: 3, name: 'No data', ...NO_DATA },
      { id: 4, name: 'Off late', ...OFF },
      { id: 5, name: 'No deadline', ...NO_DEADLINE },
      { id: 6, name: 'Off soon', ...OFF, deadline: '2026-12-01' },
      { id: 7, name: 'At risk', ...RISK },
      { id: 8, name: 'Off passed', ...LATE },
      { id: 9, name: 'Bravo', ...ON },
      { id: 10, name: 'Alpha', ...ON },
    ]);
    expect(namesIn(await page())).toEqual([
      'Off passed Acme',
      'Off soon Acme',
      'Off late Acme',
      'At risk Acme',
      'Alpha Acme',
      'Bravo Acme',
      'On track Acme',
      'No data Acme',
      'No deadline Acme',
      'No plan Acme',
    ]);
  });

  it('puts the nearest deadline first in a tab where every project reads the same', async () => {
    plan([
      { id: 1, name: 'Alpha', status: 'on_hold' },
      { id: 2, name: 'Zeta', status: 'on_hold', ...OFF },
    ]);
    expect(namesIn(await page({ status: 'on_hold' }))).toEqual(['Zeta Acme', 'Alpha Acme']);
  });
});

describe('the subtitle', () => {
  const SOME = [
    { id: 1, name: 'A', ...OFF },
    { id: 2, name: 'B', ...RISK },
    { id: 3, name: 'C', ...LATE },
    { id: 4, name: 'D', ...ON },
    { id: 5, name: 'E' },
  ];

  it('counts off track and at risk on the Active tab', async () => {
    counts = { active: 5, on_hold: 3, completed: 4 };
    plan(SOME);
    expect(subtitleOf(await page())).toBe('5 active projects: 2 off track, 1 at risk');
  });

  it('leaves out a count of zero, and the colon with none', async () => {
    plan([{ id: 1, name: 'A', ...RISK }]);
    expect(subtitleOf(await page())).toBe('2 active projects: 1 at risk');
    plan([{ id: 1, name: 'A', ...OFF }]);
    expect(subtitleOf(await page())).toBe('2 active projects: 1 off track');
    plan([{ id: 1, name: 'A', ...ON }]);
    expect(subtitleOf(await page())).toBe('2 active projects');
  });

  it('says one active project', async () => {
    counts = { active: 1, on_hold: 0, completed: 0 };
    plan([{ id: 1, name: 'A', ...OFF }]);
    expect(subtitleOf(await page())).toBe('1 active project: 1 off track');
  });

  it('has no counts on the other tabs', async () => {
    counts = { active: 5, on_hold: 3, completed: 4 };
    plan(SOME);
    expect(subtitleOf(await page({ status: 'on_hold' }))).toBe('5 active projects');
    expect(subtitleOf(await page({ status: 'completed' }))).toBe('5 active projects');
  });

  it('has no counts with a search', async () => {
    counts = { active: 5, on_hold: 0, completed: 0 };
    plan(SOME);
    expect(subtitleOf(await page({ q: 'a' }))).toBe('5 active projects');
  });

  it('has no counts when one page is not the whole tab', async () => {
    counts = { active: 250, on_hold: 0, completed: 0 };
    plan(SOME, 250);
    expect(subtitleOf(await page())).toBe('250 active projects');
  });
});

describe('the urgent tag', () => {
  const tagOf = (html) => html.match(/<span(\s[^>]*)>Urgent<\/span>/)[1];

  it('sits beside the name of an urgent project, with the note as its title', async () => {
    const extra = { isUrgent: true, urgentNote: 'Client demo on "Friday"' };
    plan([
      { id: 1, name: 'Acme app', extra },
      { id: 2, name: 'Nova site' },
    ]);
    const html = await page();
    expect(cells(html, 'Project')).toEqual(['A Acme app Urgent Acme', 'N Nova site Acme']);
    expect(attr(tagOf(html), 'title')).toBe('Client demo on "Friday"');
    expect(attr(tagOf(html), 'class')).toContain('_marigold_');
  });

  it('has no title without a note', async () => {
    plan([{ id: 1, name: 'Acme app', extra: { isUrgent: true } }]);
    expect(attr(tagOf(await page()), 'title')).toBeUndefined();
  });
});

describe('the plan reads', () => {
  it('ask for all the rows at once, with the last 3 full weeks at the company', async () => {
    plan([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
      { id: 3, name: 'C' },
    ]);
    await page();
    expect(listPlans.mock.calls).toEqual([[[1, 2, 3]]]);
    expect(progressByProject.mock.calls).toEqual([
      [
        [1, 2, 3],
        {
          // Midnight on Mondays in Asia/Kolkata, newest first.
          weeks: [
            { from: new Date('2026-10-25T18:30:00Z'), to: new Date('2026-11-01T18:30:00Z') },
            { from: new Date('2026-10-18T18:30:00Z'), to: new Date('2026-10-25T18:30:00Z') },
            { from: new Date('2026-10-11T18:30:00Z'), to: new Date('2026-10-18T18:30:00Z') },
          ],
        },
      ],
    ]);
  });

  it('happen once whatever the tab, the search or the range', async () => {
    plan([{ id: 1, name: 'A' }]);
    for (const params of [{ range: 'all' }, { status: 'completed', q: 'a', page: '2' }]) {
      listPlans.mockClear();
      progressByProject.mockClear();
      await page(params);
      expect(listPlans).toHaveBeenCalledTimes(1);
      expect(progressByProject).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ['the plans', listPlans],
    ['the progress', progressByProject],
  ])('still render the table when %s fail, as No plan yet', async (_name, read) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    plan([{ id: 1, name: 'Acme app', phase: 'design', ...OFF }]);
    read.mockReset().mockRejectedValue(new Error('Database is down'));
    const html = await page();
    expect(cells(html, 'Health')).toEqual(['No plan yet']);
    expect(cells(html, 'Phase')).toEqual(['Not set']);
    expect(cells(html, 'Progress')).toEqual(['No tasks yet']);
    expect(cells(html, 'Deadline')).toEqual(['No deadline']);
    expect(cells(html, 'Hours this week')).toEqual(['1h 45m 10h total']);
    expect(textOf(html)).toContain('Acme app');
    expect(subtitleOf(html)).toBe('2 active projects');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe('projects: could not load the project plans');
  });

  it('keep what the status already says when they fail', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    plan([
      { id: 1, name: 'Acme app', status: 'on_hold' },
      { id: 2, name: 'Nova site', status: 'completed' },
    ]);
    listPlans.mockReset().mockRejectedValue(new Error('Database is down'));
    expect(cells(await page(), 'Health')).toEqual(['On hold', 'Completed']);
  });
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

describe('the hours card on the Team dashboard and Overview', () => {
  const card = (range) =>
    renderToStaticMarkup(
      createElement(HoursCard, {
        title: 'Hours',
        subtitle: 'By project',
        range,
        hrefs: { week: '/team', month: '/team?hours=month' },
        bars: [
          { key: 'p7', label: 'Acme app', value: 60, display: '1h' },
          { key: 'r3', label: 'A requested project', value: 30, display: '30m' },
          { key: 'more', label: '2 more projects', value: 10, display: '10m' },
        ],
      }),
    );

  it("opens a project's Hours tab for the same range, and only for real projects", () => {
    expect(hrefOf(card('week'), 'Acme app')).toBe('/projects/7?tab=hours&range=week');
    expect(hrefOf(card('month'), 'Acme app')).toBe('/projects/7?tab=hours&range=month');
    expect(hrefOf(card('week'), 'A requested project')).toBeUndefined();
    expect(hrefOf(card('week'), '2 more projects')).toBeUndefined();
  });
});

describe('the mocked modules', () => {
  // The render above mocks them, so this is what ties the view to the real things.
  it('expose the period the view reads', async () => {
    const { dashboard } = await vi.importActual('@/modules/dashboard');
    expect(dashboard.projectReportPeriod).toBe(projectReportPeriod);
  });

  it('expose the plans and the progress the view reads', async () => {
    const { projectPlan } = await vi.importActual('@/modules/projectPlan');
    const { projectTasks } = await vi.importActual('@/modules/projectTasks');
    expect(projectPlan.listPlans).toBeTypeOf('function');
    expect(projectTasks.progressByProject).toBeTypeOf('function');
  });
});
