// Where a project colour shows (CONTRACT 23): yellow gets its own class, a custom '#rrggbb' gets the
// one .custom class with the colour as --project, and anything else stored in the column renders as
// a preset, so a value from the database never reaches the page's CSS unchecked. In the drawer's
// swatches, focus always shows the primary ring, also on the selected colour.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { colorVars } from '@/app/(app)/report/ProjectCard';
import UrgentList from '@/app/(app)/team/UrgentList';
import { resolveColor, resolveTextColor } from '@/components/chartColors';
import Legend from '@/components/Legend';
import ProgressBar, { toneColor } from '@/components/ProgressBar';
import ProjectLabel from '@/components/ProjectLabel';
import ProjectSquare from '@/components/ProjectSquare';

const PLUM = '#9c3fb8';
const BAD = 'red; background:url(x)';

const render = (type, props) => renderToStaticMarkup(createElement(type, props));
/** The CSS module class names on the first element, without their hash ('_custom_ab12' -> custom). */
const classes = (html) =>
  html
    .match(/class="([^"]*)"/)[1]
    .split(' ')
    .map((name) => name.replace(/^_(.+)_[0-9a-f]+$/, '$1'));
const styleOf = (html) => html.match(/style="([^"]*)"/)?.[1] ?? '';

describe('ProjectSquare', () => {
  it('shows yellow through its preset class', () => {
    const html = render(ProjectSquare, { project: { name: 'riverkraft', color: 'yellow' } });
    expect(classes(html)).toEqual(['square', 'yellow']);
    expect(styleOf(html)).not.toContain('--project');
    expect(html).toContain('>R</span>');
  });

  it('shows a custom colour through .custom and --project', () => {
    const html = render(ProjectSquare, { project: { name: 'plum', color: PLUM }, size: 34 });
    expect(classes(html)).toEqual(['square', 'custom']);
    expect(styleOf(html)).toBe(
      `--project:${PLUM};width:34px;height:34px;font-size:15px;border-radius:9px`,
    );
  });

  it('turns anything else blue without passing it into the style', () => {
    for (const color of [BAD, '#9C3FB8', '', null, 'toString']) {
      const html = render(ProjectSquare, { project: { name: 'x', color } });
      expect(classes(html)).toEqual(['square', 'blue']);
      expect(styleOf(html)).not.toMatch(/--project|url|red/i);
    }
  });
});

describe('ProjectLabel', () => {
  it('shows yellow and a custom colour', () => {
    expect(classes(render(ProjectLabel, { project: { name: 'a', color: 'yellow' } }))).toEqual([
      'label',
      'md',
      'yellow',
    ]);
    const html = render(ProjectLabel, { project: { name: 'a', color: PLUM }, size: 'sm' });
    expect(classes(html)).toEqual(['label', 'sm', 'custom']);
    expect(styleOf(html)).toBe(`--project:${PLUM}`);
  });

  it("merges the caller's style with the colour", () => {
    const html = render(ProjectLabel, {
      project: { name: 'a', color: PLUM },
      style: { maxWidth: '120px' },
    });
    expect(styleOf(html)).toBe(`--project:${PLUM};max-width:120px`);
    const preset = render(ProjectLabel, {
      project: { name: 'a', color: 'teal' },
      style: { maxWidth: '120px' },
    });
    expect(styleOf(preset)).toBe('max-width:120px');
  });

  it('ignores a bad stored value', () => {
    const html = render(ProjectLabel, { project: { name: 'a', color: BAD } });
    expect(classes(html)).toEqual(['label', 'md', 'blue']);
    expect(html).not.toContain('style=');
  });
});

describe('bars, charts and dots', () => {
  it('toneColor takes yellow and a checked custom colour', () => {
    expect(toneColor('yellow')).toBe('var(--label-yellow)');
    expect(toneColor(PLUM)).toBe(PLUM);
    for (const color of [BAD, '#9C3FB8', 'constructor', undefined]) {
      expect(toneColor(color)).toBe('var(--primary)');
    }
    const bar = render(ProgressBar, { percent: 40, color: PLUM });
    expect(bar).toContain(`background:${PLUM}`);
    expect(render(ProgressBar, { percent: 40, color: BAD })).not.toContain('url');
    expect(render(Legend, { items: [{ label: 'Plum', color: PLUM }] })).toContain(PLUM);
  });

  it('resolveColor takes yellow, a custom colour and tokens, and nothing else', () => {
    expect(resolveColor('yellow')).toBe('var(--label-yellow)');
    expect(resolveColor(PLUM)).toBe(PLUM);
    expect(resolveColor('var(--department-navy)')).toBe('var(--department-navy)');
    expect(resolveColor(BAD, 'blue')).toBe('var(--label-blue)');
    expect(resolveColor('var(--x); background:url(x)')).toBe('var(--primary)');
    expect(resolveColor('#9C3FB8', 'blue')).toBe('var(--label-blue)');
    expect(resolveColor('hasOwnProperty')).toBe('var(--primary)');
    expect(resolveTextColor('yellow')).toBe('var(--label-yellow-text)');
    expect(resolveTextColor('var(--x); color:red')).toBe('var(--primary)');
  });
});

describe("the daily report card's colour variables", () => {
  it('mixes a custom colour from --project and keeps presets on their tokens', () => {
    expect(colorVars(PLUM)).toEqual({
      '--project': PLUM,
      '--project-strong': 'var(--project)',
      '--project-text': 'color-mix(in srgb, var(--project) 35%, var(--ink))',
    });
    expect(colorVars('yellow')).toEqual({
      '--project-strong': 'var(--label-yellow)',
      '--project-text': 'var(--label-yellow-text)',
    });
    expect(colorVars(BAD)).toEqual({
      '--project-strong': 'var(--label-blue)',
      '--project-text': 'var(--label-blue-text)',
    });
  });
});

describe('UrgentList', () => {
  it('names each project in its colour', () => {
    const html = render(UrgentList, {
      items: [
        { id: 1, name: 'riverkraft', color: 'yellow', note: 'Launch', meta: 'Today' },
        { id: 2, name: 'plum', color: PLUM, note: 'Fix', meta: 'Today' },
        { id: 3, name: 'odd', color: BAD, note: 'Check', meta: 'Today' },
      ],
    });
    const names = [
      ...html.matchAll(/<p class="([^"]*)"( style="([^"]*)")?>(riverkraft|plum|odd)</g),
    ];
    expect(names.map((m) => [classes(`class="${m[1]}"`)[1], m[3] ?? '', m[4]])).toEqual([
      ['yellow', '', 'riverkraft'],
      ['custom', `--project:${PLUM}`, 'plum'],
      ['blue', '', 'odd'],
    ]);
  });
});

describe('the stylesheets', () => {
  const sheets = [
    'src/components/ProjectSquare.module.css',
    'src/components/ProjectLabel.module.css',
    'src/app/(app)/report/ProjectPicker.module.css',
    'src/app/(app)/team/UrgentList.module.css',
  ];

  it.each(sheets)('%s has .yellow and a .custom class that reads --project', (file) => {
    const css = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    expect(css).toMatch(/^\.yellow \{\n[^}]*var\(--label-yellow/m);
    const custom = css.match(/^\.custom \{\n([^}]*)\}/m)?.[1] ?? '';
    expect(custom).toContain('var(--project)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('ColorSwatches gives every focused dot the primary ring, selected or not', () => {
    const css = readFileSync(
      new URL('../../src/app/(app)/projects/ColorSwatches.module.css', import.meta.url),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({
      selector: selector.trim().replace(/\s+/g, ' '),
      body: body.trim().replace(/\s+/g, ' '),
    }));
    const at = (selector) => rules.findIndex((rule) => rule.selector === selector);
    const focus = rules.filter(({ selector }) => /:focus-visible.*\.(dot|moreDot)$/.test(selector));
    // No override for a checked, pressed or custom dot keeps its colour ring under focus.
    expect(focus.map(({ selector }) => selector)).toEqual([
      '.input:focus-visible + .dot',
      '.more:focus-visible .moreDot',
      '.panelSwatch:focus-visible .dot',
    ]);
    for (const { body } of focus) {
      expect(body).toBe('box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--primary);');
    }
    // Each comes after the selected ring of the same weight, so it wins.
    expect(at('.input:focus-visible + .dot')).toBeGreaterThan(at('.input:checked + .dot'));
    expect(at('.panelSwatch:focus-visible .dot')).toBeGreaterThan(
      at(".panelSwatch[aria-pressed='true'] .dot"),
    );
  });
});
