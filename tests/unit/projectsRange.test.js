// The hours range on the PM and Admin projects table (a company request): read from the URL, kept
// by every link on the page. readRange is also the project report's.
import { describe, expect, it } from 'vitest';
import {
  HOURS_HEADERS,
  filterParams,
  projectsHref,
  rangeItems,
  readRange,
} from '@/app/(app)/projects/projectsRange';
import { projectReportPeriod } from '@/modules/dashboard/projectReportPeriods';

const TODAY = '2026-11-04'; // a Wednesday
const hrefs = (items) => Object.fromEntries(items.map((item) => [item.value, item.href]));

describe('readRange', () => {
  it('uses the fallback when no range is chosen', () => {
    expect(readRange({}, 'week')).toMatchObject({
      options: { range: 'week' },
      errors: null,
      showCustom: false,
    });
    expect(readRange(undefined, 'week').options.range).toBe('week');
    expect(readRange({ range: '', from: '', to: '' }, 'week').options.range).toBe('week');
    // The project report opens on all time.
    expect(readRange({}).options.range).toBe('all');
  });

  it('reads a chosen range and only the first of a repeated parameter', () => {
    expect(readRange({ range: 'month' }, 'week').options.range).toBe('month');
    expect(readRange({ range: 'all' }, 'week').options.range).toBe('all');
    expect(readRange({ range: ['month', 'all'] }, 'week').options.range).toBe('month');
  });

  it('reads a custom range, with or without range=custom', () => {
    const dates = { from: '2026-10-01', to: '2026-10-31' };
    for (const query of [{ range: 'custom', ...dates }, dates]) {
      expect(readRange(query, 'week')).toMatchObject({
        options: { range: 'custom', ...dates },
        errors: null,
        showCustom: true,
      });
    }
  });

  it('falls back with the errors on an invalid custom range and still shows the form', () => {
    const backwards = readRange({ range: 'custom', from: '2026-10-31', to: '2026-10-01' }, 'week');
    expect(backwards.options).toEqual({ range: 'week' });
    expect(backwards.errors.to).toBe('The start date must be on or before the end date.');
    expect(backwards.showCustom).toBe(true);
    expect(backwards.input.from).toBe('2026-10-31');

    expect(readRange({ range: 'custom' }, 'week')).toMatchObject({
      options: { range: 'week' },
      errors: { from: 'Pick a start and an end date.' },
      showCustom: true,
    });
    expect(readRange({ from: 'soon', to: '2026-10-01' }).options).toEqual({ range: 'all' });
    expect(readRange({ from: 'soon', to: '2026-10-01' }).showCustom).toBe(true);
  });

  it('falls back on an unknown range without opening the form', () => {
    const unknown = readRange({ range: 'year' }, 'week');
    expect(unknown.options).toEqual({ range: 'week' });
    expect(unknown.errors.range).toBeTruthy();
    expect(unknown.showCustom).toBe(false);
  });
});

describe('projectsHref', () => {
  it('leaves the defaults out', () => {
    expect(projectsHref({ status: 'active', q: '', page: 1, range: { key: 'week' } })).toBe(
      '/projects',
    );
    expect(projectsHref({ status: 'active' })).toBe('/projects');
  });

  it('keeps the status tab, the search, the range and the page', () => {
    expect(
      projectsHref({ status: 'completed', q: 'acme app', page: 3, range: { key: 'month' } }),
    ).toBe('/projects?status=completed&q=acme+app&range=month&page=3');
    expect(projectsHref({ status: 'active', range: { key: 'all' } })).toBe('/projects?range=all');
  });

  it('gives a custom range its dates, and no other range', () => {
    const range = { key: 'custom', from: '2026-10-01', to: '2026-10-31' };
    expect(projectsHref({ status: 'on_hold', range })).toBe(
      '/projects?status=on_hold&range=custom&from=2026-10-01&to=2026-10-31',
    );
    const month = { key: 'month', from: '2026-11-01', to: '2026-11-30' };
    expect(projectsHref({ status: 'active', range: month })).toBe('/projects?range=month');
  });
});

describe('filterParams', () => {
  it('lists what a GET form must carry over', () => {
    expect(filterParams({ status: 'active', q: '' })).toEqual({});
    expect(filterParams({ status: 'on_hold', q: 'acme' })).toEqual({
      status: 'on_hold',
      q: 'acme',
    });
  });
});

describe('rangeItems', () => {
  const period = (options) => projectReportPeriod(options, { today: TODAY, firstOn: '2000-01-01' });

  it('offers the same four ranges as a project, keeping the tab and the search', () => {
    const items = rangeItems({
      status: 'completed',
      q: 'acme',
      period: period({ range: 'week' }),
      today: TODAY,
    });
    expect(items.map((item) => item.label)).toEqual([
      'This week',
      'This month',
      'All time',
      'Custom',
    ]);
    expect(hrefs(items)).toEqual({
      week: '/projects?status=completed&q=acme',
      month: '/projects?status=completed&q=acme&range=month',
      all: '/projects?status=completed&q=acme&range=all',
      custom: '/projects?status=completed&q=acme&range=custom&from=2026-11-02&to=2026-11-04',
    });
  });

  it('opens Custom with the range on screen, never after today', () => {
    const custom = (options) =>
      hrefs(rangeItems({ status: 'active', period: period(options), today: TODAY })).custom;
    expect(custom({ range: 'month' })).toBe('/projects?range=custom&from=2026-11-01&to=2026-11-04');
    expect(custom({ range: 'custom', from: '2026-10-01', to: '2026-10-15' })).toBe(
      '/projects?range=custom&from=2026-10-01&to=2026-10-15',
    );
    // A range that hasn't started yet still opens with valid dates.
    expect(custom({ range: 'custom', from: '2026-12-01', to: '2026-12-15' })).toBe(
      '/projects?range=custom&from=2026-12-01&to=2026-12-01',
    );
  });

  it('opens Custom with this month from all time, not from the year 2000', () => {
    const items = rangeItems({ status: 'active', period: period({ range: 'all' }), today: TODAY });
    expect(hrefs(items).custom).toBe('/projects?range=custom&from=2026-11-01&to=2026-11-04');
  });
});

describe('the table period', () => {
  it('covers every report on all time and the chosen days otherwise', () => {
    const period = (options) =>
      projectReportPeriod(options, { today: TODAY, firstOn: '2000-01-01' });
    expect(period({ range: 'all' })).toMatchObject({
      key: 'all',
      from: '2000-01-01',
      to: TODAY,
    });
    expect(period({ range: 'week' })).toMatchObject({
      key: 'week',
      from: '2026-11-02',
      to: '2026-11-08',
    });
    expect(period({ range: 'month' })).toMatchObject({
      key: 'month',
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });

  it('has a column header for every range', () => {
    for (const key of ['week', 'month', 'all', 'custom']) {
      expect(HOURS_HEADERS[key].full).toBeTruthy();
      expect(HOURS_HEADERS[key].short).toBeTruthy();
    }
    expect(HOURS_HEADERS.week.full).toBe('Hours this week');
  });
});
