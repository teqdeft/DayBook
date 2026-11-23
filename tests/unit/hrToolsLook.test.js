// The HR tools screens match the prototype's look (CONTRACT 25, Design; hr-tools-prototype.html):
// a rows 2 Textarea is 66 px (textarea.control.rows-2), not Textarea's 88 px; Mark/Edit leave
// stacks its pairs on a phone (.fields-2); the Leave Note is muted 14 px (.note); the Attendance
// row's "..." sits 8 px into the cell's padding (.act-line .menu-trigger); and the new empty
// states have the CalendarDays icon in a soft circle (emptyState()). Vite can't read JSX in
// page.js, so the Missing check-outs page is checked in its source.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => '/attendance',
  useSearchParams: () => new URLSearchParams(),
}));

const { EveryoneCard } = await import('@/app/(app)/attendance/AttendanceCards.jsx');
const { default: MonthTable } = await import('@/app/(app)/attendance/month/MonthTable.jsx');

const ATT = 'src/app/(app)/attendance';
const css = (file) => readFileSync(`${ATT}/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of `selector`'s rule, at the top level or inside `media` (its condition). */
function rule(text, selector, media) {
  let scope = text;
  if (media) {
    const start = text.indexOf(`@media ${media}`);
    if (start < 0) return null;
    scope = text.slice(text.indexOf('{', start) + 1);
  } else {
    scope = text.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  }
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = scope.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`));
  return found ? found[1].replace(/\s+/g, ' ').trim() : null;
}

const ICON = /<span class="_icon_[0-9a-f]+" aria-hidden="true"><svg[^>]*lucide-calendar-days/;

describe('the rows 2 textareas', () => {
  it("are 66 px in the break form and in Mark/Edit leave, above Textarea's 88 px", () => {
    expect(rule(css('BreakListDialog.module.css'), '.form textarea')).toBe('min-height: 66px;');
    expect(rule(css('LeaveDialog.module.css'), '.fields textarea')).toBe('min-height: 66px;');
    // A class plus an element outranks Textarea's single class whatever order the CSS loads in.
    expect(readFileSync('src/components/Textarea.module.css', 'utf8')).toContain(
      'min-height: 88px',
    );
  });
});

describe('Mark/Edit leave on a phone', () => {
  it('stacks First day and Last day, Type and Pay at 640 px and below', () => {
    const text = css('LeaveDialog.module.css');
    expect(rule(text, '.row', '(max-width: 640px)')).toBe('grid-template-columns: minmax(0, 1fr);');
    expect(rule(text, '.row')).toContain('repeat(auto-fit, minmax(150px, 1fr))');
  });
});

describe('the Leave page Note column', () => {
  it('is muted 14 px on one line, as the prototype and the Attendance Note column', () => {
    const note = rule(css('leave/page.module.css'), '.note');
    expect(note).toContain('font-size: 14px;');
    expect(note).toContain('line-height: 19px;');
    expect(note).toContain('color: var(--muted);');
    expect(note).not.toContain('--ink');
    expect(note).toContain('-webkit-line-clamp: 1;');
  });
});

describe('the Attendance row menu', () => {
  it('sits 8 px into the cell padding at every width', () => {
    expect(rule(css('RowMenu.module.css'), '.menu')).toBe('margin-right: -8px;');
  });
});

describe('the new empty states', () => {
  const pills = [
    { value: 'all', label: 'All (3)', href: '/attendance' },
    { value: 'on_leave', label: 'On leave (0)', href: '/attendance?filter=on_leave' },
  ];

  it('show the CalendarDays icon in the day table, the new filters included', () => {
    for (const filter of ['all', 'on_leave', 'on_break']) {
      const html = renderToStaticMarkup(
        createElement(EveryoneCard, {
          data: { filter, pills, rows: [], canCorrect: true, remindAll: null },
          title: 'Everyone today',
        }),
      );
      expect(html).toMatch(ICON);
      expect(html).toContain('stroke-width="1.8"');
    }
  });

  it('show it in the month view', () => {
    const html = renderToStaticMarkup(
      createElement(MonthTable, {
        data: {
          title: 'Everyone, November 2026',
          pills,
          filter: 'on_leave',
          rows: [],
          empty: { title: 'Nobody took leave', body: null },
          allHref: '/attendance/month',
          foot: 'Half day: worked under 4h 30m.',
        },
      }),
    );
    expect(html).toMatch(ICON);
    expect(html).toContain('Nobody took leave');
  });

  it('show it on Missing check-outs', () => {
    const source = readFileSync(`${ATT}/missing/page.js`, 'utf8');
    expect(source).toMatch(
      /<EmptyState\s+icon=\{<CalendarDays size=\{20\} strokeWidth=\{1\.8\} \/>\}\s+title="No missing check-outs"/,
    );
  });
});
