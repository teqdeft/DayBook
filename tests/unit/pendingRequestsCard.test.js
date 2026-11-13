// The Company overview's "Pending requests" card (CONTRACT 23): its sub text counts what waits with
// zeros left out, it links to the screen that handles what waits (only attendance fixes go to
// /attendance; nothing waiting still goes to /requests) and only for people who may handle it.
// Also the Kpi with a trailing chevron as a whole-card link, and the Requests screen's fixes line.
import Link from 'next/link';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChevronRight } from 'lucide-react';
import Kpi from '@/components/Kpi';
import AttendanceFixes from '@/app/(app)/requests/AttendanceFixes.jsx';
import { requestsHref, requestsKpi, requestsSub } from '@/modules/dashboard/requestsCard';

const ADMIN = { id: 1, role: 'admin', status: 'active' };
const HR = { id: 2, role: 'hr', status: 'active' };
const PM = { id: 3, role: 'pm', status: 'active' };
const EMPLOYEE = { id: 4, role: 'employee', status: 'active' };

const counts = (edits, projects, corrections) => ({ edits, projects, corrections });
/** Visible text of some markup: tags and React's text separators dropped. */
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');

describe('requestsSub', () => {
  it('counts each kind that waits, singular and plural, zeros left out', () => {
    expect(requestsSub(counts(2, 1, 1))).toBe('2 edits, 1 new project, 1 fix');
    expect(requestsSub(counts(1, 0, 0))).toBe('1 edit');
    expect(requestsSub(counts(0, 0, 3))).toBe('3 fixes');
    expect(requestsSub(counts(0, 2, 0))).toBe('2 new projects');
    expect(requestsSub(counts(0, 1, 0))).toBe('1 new project');
    expect(requestsSub(counts(4, 0, 2))).toBe('4 edits, 2 fixes');
  });

  it('says "Nothing waiting" at 0', () => {
    expect(requestsSub(counts(0, 0, 0))).toBe('Nothing waiting');
  });
});

describe('requestsHref', () => {
  it('goes to /attendance when only attendance fixes wait', () => {
    expect(requestsHref(counts(0, 0, 2), ADMIN)).toBe('/attendance');
    expect(requestsHref(counts(0, 0, 1), HR)).toBe('/attendance');
  });

  it('goes to /requests when edits or new projects wait, and also when nothing waits', () => {
    expect(requestsHref(counts(2, 1, 1), ADMIN)).toBe('/requests');
    expect(requestsHref(counts(0, 1, 3), ADMIN)).toBe('/requests');
    expect(requestsHref(counts(0, 0, 0), ADMIN)).toBe('/requests');
    expect(requestsHref(counts(1, 0, 0), PM)).toBe('/requests');
  });

  it('gives no link to someone who may not handle what is on that screen', () => {
    expect(requestsHref(counts(0, 0, 2), PM)).toBeUndefined();
    expect(requestsHref(counts(0, 0, 0), HR)).toBeUndefined();
    expect(requestsHref(counts(1, 0, 0), EMPLOYEE)).toBeUndefined();
    expect(requestsHref(counts(0, 0, 1), EMPLOYEE)).toBeUndefined();
    expect(requestsHref(counts(1, 0, 0), { ...ADMIN, status: 'deactivated' })).toBeUndefined();
    expect(requestsHref(counts(1, 0, 0), undefined)).toBeUndefined();
  });
});

describe('requestsKpi', () => {
  it('builds the card with its link; the bar is the share still waiting', () => {
    const kpi = requestsKpi(
      { ...counts(2, 1, 1), editsHandled: 5, projectsHandled: 1, correctionsHandled: 0 },
      ADMIN,
    );
    expect(kpi).toEqual({
      key: 'requests',
      label: 'Pending requests',
      value: '4',
      sub: '2 edits, 1 new project, 1 fix',
      percent: 40,
      color: 'violet',
      href: '/requests',
    });
  });

  it('still links to /requests at 0, with an empty bar', () => {
    const kpi = requestsKpi(counts(0, 0, 0), ADMIN);
    expect([kpi.value, kpi.sub, kpi.percent, kpi.href]).toEqual([
      '0',
      'Nothing waiting',
      0,
      '/requests',
    ]);
  });

  it('is not a link without the permission', () => {
    expect(requestsKpi(counts(0, 0, 3), PM)).not.toHaveProperty('href');
    expect(requestsKpi(counts(0, 0, 3), HR)).toMatchObject({ sub: '3 fixes', href: '/attendance' });
  });
});

describe('Kpi with a trailing element', () => {
  const chevron = createElement(ChevronRight, { size: 18, strokeWidth: 1.8 });

  it('renders the whole card as the link, with the chevron hidden from screen readers', () => {
    const html = renderToStaticMarkup(
      createElement(Kpi, {
        as: Link,
        href: '/requests',
        className: 'kpiLink',
        trailing: chevron,
        label: 'Pending requests',
        value: '4',
        sub: '2 edits, 1 new project, 1 fix',
        percent: 30,
        color: 'violet',
      }),
    );
    expect(html.startsWith('<a ')).toBe(true);
    expect(html).toMatch(/^<a [^>]*href="\/requests"/);
    expect(html).toMatch(/^<a [^>]*class="[^"]*kpiLink/);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('lucide-chevron-right');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    // The accessible name is the card's text.
    expect(text(html)).toBe('Pending requests42 edits, 1 new project, 1 fix');
  });

  it('puts the trailing element after the label and keeps a plain card without it', () => {
    const plain = renderToStaticMarkup(createElement(Kpi, { label: 'In today', value: '24' }));
    expect(plain.startsWith('<div ')).toBe(true);
    expect(plain).not.toContain('<svg');
    const html = renderToStaticMarkup(
      createElement(Kpi, { label: 'In today', value: '24', trailing: chevron }),
    );
    expect(html.indexOf('In today')).toBeLessThan(html.indexOf('<svg'));
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('>24<'));
  });
});

describe('AttendanceFixes (the Requests screen)', () => {
  const render = (viewer, count) =>
    renderToStaticMarkup(createElement(AttendanceFixes, { viewer, count }));

  it('says how many fixes wait, singular and plural, and links to Attendance', () => {
    const one = render(ADMIN, 1);
    expect(text(one)).toBe('1 attendance fix is waiting on Attendance. Open attendance');
    expect(one).toMatch(/<a [^>]*href="\/attendance"[^>]*>Open attendance<\/a>/);
    expect(text(render(ADMIN, 3))).toBe(
      '3 attendance fixes are waiting on Attendance. Open attendance',
    );
  });

  it('shows nothing when no fix waits or the viewer cannot correct attendance', () => {
    expect(render(ADMIN, 0)).toBe('');
    expect(render(PM, 2)).toBe('');
    expect(render(EMPLOYEE, 1)).toBe('');
  });
});
