// Project colour labels (CONTRACT 23): the seven presets, the eight "More colours", custom hex
// colours trimmed and lowercased, the two contrast checks, the label text's contrast for any colour
// they accept, and the inline style that carries a custom colour, which never lets anything but a
// lowercase '#rrggbb' through.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COLOR_PROBLEM_MESSAGES,
  DEFAULT_CUSTOM_COLOR,
  DEFAULT_PROJECT_COLOR,
  MORE_COLORS,
  PROJECT_COLORS,
  PROJECT_COLOR_LABELS,
  colorProblem,
  contrastRatio,
  isCustomColor,
  isPresetColor,
  normalizeColor,
  projectColorKey,
  projectColorStyle,
} from '@/lib/projectColors';

const BAD_VALUES = [
  'red; background:url(x)',
  '#9C3FB8',
  '#9c3fb8;',
  ' #9c3fb8',
  '#9c3fb',
  '#9c3fb80',
  'var(--ink)',
  'url(x)',
  '',
  null,
  undefined,
  42,
  ['#9c3fb8'],
  { toString: () => '#9c3fb8' },
];

const THEMES = {
  light: { surface: '#ffffff', ink: '#1b1e33', urgentBg: '#fff7e4' },
  dark: { surface: '#1a1e3a', ink: '#eceef7', urgentBg: '#2e2412' },
};

/** color-mix(in srgb, a p, b): what the .custom classes ask the browser for. */
function mix(a, b, p) {
  const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const parts = [0, 1, 2].map((i) => Math.round(channel(a, i) * p + channel(b, i) * (1 - p)));
  return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** A custom colour's label text against its soft background, the surface and the urgent box. */
function textContrast(hex, theme) {
  const text = mix(hex, theme.ink, 0.35);
  return {
    background: contrastRatio(text, mix(hex, theme.surface, 0.16)),
    surface: contrastRatio(text, theme.surface),
    urgent: contrastRatio(text, theme.urgentBg),
  };
}

describe('presets', () => {
  it('lists the six old colours and yellow, in the drawer order, each with a name', () => {
    expect(PROJECT_COLORS).toEqual(['blue', 'green', 'violet', 'orange', 'teal', 'pink', 'yellow']);
    expect(Object.keys(PROJECT_COLOR_LABELS)).toEqual(PROJECT_COLORS);
    expect(PROJECT_COLOR_LABELS.yellow).toBe('Yellow');
    expect(DEFAULT_PROJECT_COLOR).toBe('blue');
  });

  it('knows a preset only by its exact name', () => {
    for (const color of PROJECT_COLORS) expect(isPresetColor(color)).toBe(true);
    for (const value of ['Yellow', ' blue', 'marigold', 'toString', '#3848d6', null]) {
      expect(isPresetColor(value)).toBe(false);
    }
  });
});

describe('custom colours', () => {
  it('are a lowercase #rrggbb and nothing else', () => {
    expect(isCustomColor('#9c3fb8')).toBe(true);
    expect(isCustomColor('#000000')).toBe(true);
    for (const value of BAD_VALUES) expect(isCustomColor(value)).toBe(false);
  });

  it('normalizeColor trims and lowercases, and changes nothing else', () => {
    expect(normalizeColor('  #9C3FB8 ')).toBe('#9c3fb8');
    expect(normalizeColor('YELLOW')).toBe('yellow');
    expect(normalizeColor('#9C3FB')).toBe('#9c3fb');
    expect(normalizeColor('red; Background:URL(x)')).toBe('red; background:url(x)');
    expect(normalizeColor(null)).toBe(null);
    expect(normalizeColor(42)).toBe(42);
  });
});

describe('More colours', () => {
  it('has the eight approved colours, in order, as custom colours', () => {
    expect(MORE_COLORS.map(({ label, hex }) => [label, hex])).toEqual([
      ['Coral', '#e8603c'],
      ['Brown', '#9a5b2e'],
      ['Olive', '#7d8a12'],
      ['Lime', '#4f9d1a'],
      ['Sky', '#2f86d6'],
      ['Plum', '#9c3fb8'],
      ['Magenta', '#c0399a'],
      ['Slate', '#5d6b85'],
    ]);
    expect(new Set(MORE_COLORS.map((color) => color.key)).size).toBe(8);
    for (const { key, label } of MORE_COLORS) expect(key).toBe(label.toLowerCase());
    expect(DEFAULT_CUSTOM_COLOR).toBe('#2f86d6');
  });

  it('every one passes colorProblem and is a valid custom colour', () => {
    for (const { hex } of MORE_COLORS) {
      expect(isCustomColor(hex)).toBe(true);
      expect(colorProblem(hex)).toBeNull();
    }
  });

  it('keeps label text at least 6:1 on its background, the surface and the urgent box', () => {
    for (const { hex } of MORE_COLORS) {
      for (const theme of Object.values(THEMES)) {
        const ratios = textContrast(hex, theme);
        for (const ratio of Object.values(ratios)) expect(ratio).toBeGreaterThanOrEqual(6);
      }
    }
  });
});

describe('label text for any colour that passes colorProblem', () => {
  // The lowest cases of a scan of all 16.7 million colours, then every colour written as #rgb.
  const LOWEST = ['#0000d3', '#0002d4', '#9ddcf4', '#c8d1fd'];
  const digits = [...'0123456789abcdef'];
  const sixteen = digits.flatMap((r) =>
    digits.flatMap((g) => digits.map((b) => r + r + g + g + b + b)),
  );
  const accepted = [...LOWEST, ...sixteen.map((rgb) => `#${rgb}`)].filter(
    (hex) => colorProblem(hex) === null,
  );

  it('stays at least 6:1 on its background and the surface, and on the light urgent box', () => {
    expect(accepted.length).toBeGreaterThan(3000);
    for (const hex of accepted) {
      const light = textContrast(hex, THEMES.light);
      const dark = textContrast(hex, THEMES.dark);
      const lowest = Math.min(...Object.values(light), dark.background, dark.surface);
      expect(lowest, hex).toBeGreaterThanOrEqual(6);
    }
  });

  it('stays at least 5.9:1 on the dark urgent box, where deep blues dip just under 6', () => {
    for (const hex of accepted) {
      expect(textContrast(hex, THEMES.dark).urgent, hex).toBeGreaterThanOrEqual(5.9);
    }
    expect(colorProblem('#0000d3')).toBeNull();
    expect(textContrast('#0000d3', THEMES.dark).urgent).toBeLessThan(6);
  });
});

describe('colorProblem', () => {
  it('calls a colour below 1.5:1 on white too light', () => {
    for (const hex of ['#ffffff', '#fff7e4', '#f6f2c0', '#e0e0e0']) {
      expect(colorProblem(hex)).toBe('light');
    }
    expect(COLOR_PROBLEM_MESSAGES.light).toBe(
      'This colour is too light to see. Pick a darker one.',
    );
  });

  it('calls a colour below 1.5:1 on the dark surface too dark', () => {
    for (const hex of ['#000000', '#1a1e3a', '#0f1226', '#2a2a2a']) {
      expect(colorProblem(hex)).toBe('dark');
    }
    expect(COLOR_PROBLEM_MESSAGES.dark).toBe(
      'This colour is too dark to see in the dark theme. Pick a lighter one.',
    );
  });

  it('puts the thresholds at 1.5:1 exactly', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#d4b300', '#ffffff')).toBeGreaterThan(1.5);
    expect(colorProblem('#d4b300')).toBeNull();
    // #d2d2d2 is 1.53:1 on white, #d6d6d6 1.45:1.
    expect(colorProblem('#d2d2d2')).toBeNull();
    expect(colorProblem('#d6d6d6')).toBe('light');
  });

  it('answers null for anything that is not a custom colour', () => {
    expect(colorProblem('yellow')).toBeNull();
    expect(colorProblem('#FFFFFF')).toBeNull();
    expect(colorProblem(undefined)).toBeNull();
  });
});

describe('projectColorStyle and projectColorKey', () => {
  it('carries a custom colour as --project and nothing for a preset', () => {
    expect(projectColorStyle('#9c3fb8')).toEqual({ '--project': '#9c3fb8' });
    for (const color of PROJECT_COLORS) expect(projectColorStyle(color)).toEqual({});
  });

  it('ignores bad values instead of passing them into CSS', () => {
    for (const value of BAD_VALUES) expect(projectColorStyle(value)).toEqual({});
  });

  it('picks the preset class, the custom class, or the fallback', () => {
    expect(projectColorKey('yellow')).toBe('yellow');
    expect(projectColorKey('#9c3fb8')).toBe('custom');
    expect(projectColorKey('red; background:url(x)')).toBe('blue');
    expect(projectColorKey(null)).toBe('blue');
    expect(projectColorKey('toString')).toBe('blue');
    expect(projectColorKey(undefined, 'none')).toBe('none');
  });
});

describe('the yellow tokens', () => {
  const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
  const token = (name) => css.match(new RegExp(`^ {2}--${name}: (.+);$`, 'm'))?.[1];

  it('are hue 51 strong and 56 soft, apart from marigold', () => {
    expect(token('label-yellow')).toBe('#d4b300');
    expect(token('label-yellow-bg')).toBe('light-dark(#f6f2c0, #32310f)');
    expect(token('label-yellow-text')).toBe('light-dark(#565000, #e5da69)');
  });

  it('keep the contrast the design measured', () => {
    expect(contrastRatio('#565000', '#f6f2c0')).toBeGreaterThanOrEqual(7.2);
    expect(contrastRatio('#e5da69', '#32310f')).toBeGreaterThanOrEqual(9.2);
    expect(contrastRatio('#565000', THEMES.light.urgentBg)).toBeGreaterThanOrEqual(7.7);
    expect(contrastRatio('#e5da69', THEMES.dark.urgentBg)).toBeGreaterThanOrEqual(10.5);
    expect(contrastRatio('#d4b300', '#ffffff')).toBeCloseTo(2.05, 2);
    expect(contrastRatio('#d4b300', THEMES.dark.surface)).toBeGreaterThanOrEqual(7.9);
  });
});
