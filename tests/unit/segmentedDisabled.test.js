// Segmented with a disabled item (CONTRACT 25: Mark leave's halves while the days differ, the
// month switch): a button gets `disabled` and never calls onChange; a link item renders as a span
// with aria-disabled and no href; both show muted text at half strength with no hover.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Segmented from '@/components/Segmented';

const render = (props) => renderToStaticMarkup(createElement(Segmented, props));
/** CSS module class names without their hash ('_disabled_ab12' -> disabled). */
const names = (value) => value.split(' ').map((name) => name.replace(/^_(.+)_[0-9a-f]+$/, '$1'));

const PARTS = [
  { value: 'full', label: 'Full day' },
  { value: 'first_half', label: 'First half', disabled: true },
  { value: 'second_half', label: 'Second half', disabled: true },
];

describe('Segmented with a disabled item', () => {
  it('disables a button item, keeps it in the group and never calls onChange for it', () => {
    const picked = [];
    const html = render({
      items: PARTS,
      value: 'full',
      label: 'Part of the day',
      onChange: (v) => picked.push(v),
    });
    expect(html).toContain('role="group" aria-label="Part of the day"');
    const buttons = [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)];
    expect(buttons.map((match) => match[2])).toEqual(['Full day', 'First half', 'Second half']);
    expect(buttons[0][1]).not.toContain('disabled=""');
    expect(buttons[0][1]).toContain('aria-pressed="true"');
    for (const match of buttons.slice(1)) {
      expect(match[1]).toContain('disabled=""');
      expect(match[1]).toContain('aria-pressed="false"');
      expect(names(match[1].match(/class="([^"]*)"/)[1])).toEqual(['item', 'disabled']);
    }

    // The element tree: only the enabled button has a click handler.
    const tree = Segmented({ items: PARTS, value: 'full', onChange: (v) => picked.push(v) });
    const [full, first, second] = tree.props.children;
    expect(first.props.onClick).toBeUndefined();
    expect(second.props.onClick).toBeUndefined();
    full.props.onClick();
    expect(picked).toEqual(['full']);
  });

  it('renders a disabled link item as a span with aria-disabled and no href', () => {
    const html = render({
      items: [
        { value: 'day', label: 'Day', href: '/attendance' },
        { value: 'month', label: 'Month', href: '/attendance/month', disabled: true },
      ],
      value: 'day',
      label: 'View',
    });
    expect(html).toContain('href="/attendance"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('/attendance/month');
    const span = html.match(/<span([^>]*)>Month<\/span>/);
    expect(span).not.toBeNull();
    expect(span[1]).toContain('aria-disabled="true"');
    expect(span[1]).toContain('role="link"');
    expect(names(span[1].match(/class="([^"]*)"/)[1])).toEqual(['item', 'disabled']);
  });

  it('keeps items without `disabled` exactly as before', () => {
    const html = render({
      items: [
        { value: 'week', label: 'Week', href: '/team?range=week' },
        { value: 'month', label: 'Month', href: '/team?range=month' },
      ],
      value: 'month',
    });
    expect(html).not.toContain('disabled');
    expect(html.match(/<a /g)).toHaveLength(2);
  });

  it('mutes the text at half strength with no hover change', () => {
    const css = readFileSync('src/components/Segmented.module.css', 'utf8');
    const rule = css.match(/\.disabled,\s*\.disabled:hover\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toContain('color: color-mix(in srgb, var(--muted) 50%, transparent)');
    expect(rule[1]).toContain('cursor: not-allowed');
  });
});
