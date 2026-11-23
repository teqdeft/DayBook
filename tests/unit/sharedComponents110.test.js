// Shared pieces for the person's day (CONTRACT 25): StatusCell's on_leave, holiday and day_off,
// MonthCalendar's leave and holiday tones and legendItems, and Kpi's bar at the card's bottom.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Kpi from '@/components/Kpi';
import MonthCalendar, { CALENDAR_LEGEND, OFF_LEGEND } from '@/components/MonthCalendar';
import StatusCell, { STATUS_LABELS } from '@/components/StatusCell';

const render = (type, props) => renderToStaticMarkup(createElement(type, props));
/** CSS module class names without their hash ('_teal_ab12' -> teal). */
const names = (html) =>
  html
    .match(/class="([^"]*)"/)[1]
    .split(' ')
    .map((name) => name.replace(/^_(.+)_[0-9a-f]+$/, '$1'));
/** The declarations of one CSS rule. */
const rule = (css, selector) =>
  css.match(new RegExp(`(^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`))?.[2] ?? '';

describe('StatusCell', () => {
  it('shows On leave (soft teal), Holiday (soft green) and Day off (neutral)', () => {
    expect(STATUS_LABELS).toMatchObject({
      on_leave: 'On leave',
      holiday: 'Holiday',
      day_off: 'Day off',
    });
    const leave = render(StatusCell, { status: 'on_leave' });
    expect(leave).toContain('>On leave</span>');
    expect(names(leave)).toEqual(['status', 'cell', 'teal']);
    expect(names(render(StatusCell, { status: 'holiday', size: 'pill' }))).toEqual([
      'status',
      'pill',
      'greenSoft',
    ]);
    expect(names(render(StatusCell, { status: 'day_off' }))).toEqual(['status', 'cell', 'neutral']);
    const css = readFileSync('src/components/StatusCell.module.css', 'utf8');
    expect(rule(css, '.teal')).toContain('background: var(--label-teal-bg)');
    expect(rule(css, '.teal')).toContain('color: var(--label-teal-text)');
    expect(rule(css, '.greenSoft')).toContain('background: var(--green-soft)');
    expect(rule(css, '.greenSoft')).toContain('color: var(--green-text)');
  });

  it('keeps the existing fills', () => {
    expect(names(render(StatusCell, { status: 'submitted' }))).toContain('green');
    expect(names(render(StatusCell, { status: 'not_checked_in' }))).toContain('neutral');
    expect(names(render(StatusCell, { status: 'missing' }))).toContain('red');
  });
});

describe('MonthCalendar', () => {
  const weeks = [
    [
      { date: '2026-11-16', day: 16, tone: 'holiday', title: 'Holiday: Diwali' },
      { date: '2026-11-17', day: 17, tone: 'office' },
      { date: '2026-11-18', day: 18, tone: 'missing' },
      { date: '2026-11-19', day: 19, tone: 'leave', isToday: true },
      { date: '2026-11-20', day: 20, tone: 'leave' },
    ],
  ];

  it('tints leave and holiday tiles and keeps the default legend', () => {
    const html = render(MonthCalendar, { weeks });
    expect(html).toMatch(/class="_tile_[0-9a-f]+ _holiday_[0-9a-f]+ "[^>]*>16</);
    expect(html).toMatch(/class="_tile_[0-9a-f]+ _leave_[0-9a-f]+ "[^>]*>20</);
    expect(html).toContain('aria-label="2026-11-16, Holiday: Diwali"');
    expect(html).toContain('title="Holiday: Diwali"');
    expect(html).toContain('aria-label="2026-11-20, Leave"');
    expect(html).toContain('aria-label="2026-11-18, Not checked in"');
    const legend = [...html.matchAll(/<\/span>([^<]+)<\/li>/g)].map((match) => match[1]);
    expect(legend).toEqual(CALENDAR_LEGEND.map((item) => item.label));
  });

  it('takes legendItems, and speaks each tile with its legend word', () => {
    const legendItems = [
      { tone: 'office', label: 'Office' },
      { tone: 'wfh', label: 'WFH' },
      { tone: 'late', label: 'Late' },
      { tone: 'missing', label: 'Absent' },
      ...OFF_LEGEND,
    ];
    const html = render(MonthCalendar, { weeks, legendItems });
    const legend = [...html.matchAll(/<\/span>([^<]+)<\/li>/g)].map((match) => match[1]);
    expect(legend).toEqual(['Office', 'WFH', 'Late', 'Absent', 'Leave', 'Holiday']);
    expect(html).toContain('aria-label="2026-11-18, Absent"');
    expect(html).toContain('aria-label="2026-11-19, Leave, today"');
    expect(html).toMatch(/_dot_[0-9a-f]+ _dot-leave_[0-9a-f]+/);
    expect(html).toMatch(/_dot_[0-9a-f]+ _dot-holiday_[0-9a-f]+/);
  });

  it('uses the teal and green tokens', () => {
    const css = readFileSync('src/components/MonthCalendar.module.css', 'utf8');
    expect(rule(css, '.leave')).toContain('background: var(--label-teal-bg)');
    expect(rule(css, '.leave')).toContain('color: var(--label-teal-text)');
    expect(rule(css, '.holiday')).toContain('background: var(--green-soft)');
    expect(rule(css, '.holiday')).toContain('color: var(--green-text)');
    expect(rule(css, '.dot-leave')).toContain('background: var(--label-teal)');
    expect(rule(css, '.dot-holiday')).toContain('background: var(--green)');
  });
});

describe('Kpi', () => {
  /** The element names of the card's children, in order. */
  const children = (html) =>
    [...html.replace(/^<div[^>]*>/, '').matchAll(/<(p|span|div)\b[^>]*class="_(\w+)_/g)]
      .map((match) => match[2])
      .filter((name) =>
        ['label', 'trailing', 'valueRow', 'spacer', 'footer', 'track'].includes(name),
      );

  it('puts a spacer before the footer and bar, so bars line up at the bottom of a grid row', () => {
    const html = render(Kpi, {
      label: 'Missing check-out',
      value: '3',
      footer: '12 to fix in all',
      percent: 20,
      color: 'red',
    });
    expect(html).toContain('<span class="');
    expect(html).toMatch(
      /<span class="_spacer_[0-9a-f]+" aria-hidden="true"><\/span><p class="_footer_/,
    );
    const css = readFileSync('src/components/Kpi.module.css', 'utf8');
    expect(rule(css, '.spacer')).toContain('flex: 1 0 0');
    expect(rule(css, '.kpi')).toContain('flex-direction: column');
    expect(children(html).slice(0, 4)).toEqual(['label', 'valueRow', 'spacer', 'footer']);
  });

  it('keeps the label and value row as the first two children (pages style them by position)', () => {
    const html = render(Kpi, { label: 'Checked in', value: '18', sub: 'of 26', percent: 69 });
    expect(children(html).slice(0, 3)).toEqual(['label', 'valueRow', 'spacer']);
    // Without a bar there is nothing to line up: no spacer.
    const plain = render(Kpi, { label: 'Hours', value: '8h', footer: 'This week' });
    expect(plain).not.toContain('_spacer_');
  });
});
