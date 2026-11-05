// The hours range: read from the URL on a project's report, and on the PM and Admin projects table,
// where it sits next to the status tabs and the search (This week, This month, All time, Custom).
// Pure (no server imports).
import { monthOf, monthRange } from '@/lib/time';
import { projectReportRangeSchema } from '@/modules/dashboard/projectReportSchemas';

const first = (value) => (Array.isArray(value) ? value[0] : value);

/** The hours column's header on the projects table: `short` on narrow tables. */
export const HOURS_HEADERS = {
  week: { full: 'Hours this week', short: 'This week' },
  month: { full: 'Hours this month', short: 'This month' },
  all: { full: 'Total hours', short: 'Total' },
  custom: { full: 'Hours in range', short: 'In range' },
};

/**
 * The range from the URL. No range chosen means `fallback`; so does an invalid custom range, which
 * also brings its errors for the form.
 * @param {Record<string, string|string[]|undefined>} [query] the page's search params
 * @param {'week'|'month'|'all'} [fallback]
 * @returns {{ options: { range: string, from?: string, to?: string },
 *   errors: Record<string, string>|null, input: { range?: string, from?: string, to?: string },
 *   showCustom: boolean }}
 */
export function readRange(query, fallback = 'all') {
  const input = { range: first(query?.range), from: first(query?.from), to: first(query?.to) };
  const chosen = input.range || input.from || input.to;
  const parsed = projectReportRangeSchema.safeParse(chosen ? input : { range: fallback });
  if (parsed.success) {
    return {
      options: parsed.data,
      errors: null,
      input,
      showCustom: parsed.data.range === 'custom',
    };
  }
  const errors = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? 'from');
    errors[key] ??= issue.message;
  }
  // Dates without range=custom are a custom range too: show the form, with its errors.
  const showCustom = input.range === 'custom' || Boolean(input.from || input.to);
  return { options: { range: fallback }, errors, input, showCustom };
}

/**
 * The status tab and search as URL parameters (the active tab is the default, so it stays out).
 * @param {{ status: string, q?: string }} filters
 * @returns {Record<string, string>}
 */
export function filterParams({ status, q }) {
  const params = {};
  if (status !== 'active') params.status = status;
  if (q) params.q = q;
  return params;
}

/**
 * A link to the projects table, 'This week' being the default range.
 * '/projects', '/projects?status=completed&q=acme&range=custom&from=2026-10-01&to=2026-10-31'
 * @param {{ status: string, q?: string, page?: number,
 *   range?: { key: string, from?: string, to?: string } }} options
 * @returns {string}
 */
export function projectsHref({ status, q, page = 1, range }) {
  const search = new URLSearchParams(filterParams({ status, q }));
  if (range && range.key !== 'week') {
    search.set('range', range.key);
    if (range.key === 'custom') {
      search.set('from', range.from);
      search.set('to', range.to);
    }
  }
  if (page > 1) search.set('page', String(page));
  const query = search.toString();
  return query ? `/projects?${query}` : '/projects';
}

/**
 * The dates the Custom link opens with: the range on screen. All time would start in the year
 * 2000 on this table, so it opens with this month instead.
 */
function customStart(period, today) {
  if (period.key === 'all') return { from: monthRange(monthOf(today)).from, to: today };
  return { from: period.from, to: period.end < period.from ? period.from : period.end };
}

/**
 * The range control's items, each keeping the status tab and the search.
 * @param {{ status: string, q?: string, today: string,
 *   period: { key: string, from: string, end: string } }} options
 * @returns {Array<{ value: string, label: string, href: string }>}
 */
export function rangeItems({ status, q, period, today }) {
  const link = (range) => projectsHref({ status, q, range });
  return [
    { value: 'week', label: 'This week', href: link({ key: 'week' }) },
    { value: 'month', label: 'This month', href: link({ key: 'month' }) },
    { value: 'all', label: 'All time', href: link({ key: 'all' }) },
    {
      value: 'custom',
      label: 'Custom',
      href: link({ key: 'custom', ...customStart(period, today) }),
    },
  ];
}
