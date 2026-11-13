// Project colour labels (CONTRACT 23), shared by server and client code. No Node or browser APIs
// here. A project's colour is a preset name or a custom lowercase '#rrggbb'. The database is never
// trusted for CSS: anything else renders as a preset, and a custom colour only ever reaches the page
// as the --project value of a style object, never inside a CSS string.

/** The presets, in the order the drawer shows them. */
export const PROJECT_COLORS = ['blue', 'green', 'violet', 'orange', 'teal', 'pink', 'yellow'];

/** The presets' names, for swatches and screen readers. */
export const PROJECT_COLOR_LABELS = {
  blue: 'Blue',
  green: 'Green',
  violet: 'Violet',
  orange: 'Orange',
  teal: 'Teal',
  pink: 'Pink',
  yellow: 'Yellow',
};

/** A new project's colour, and the one shown for a missing or unknown value. */
export const DEFAULT_PROJECT_COLOR = 'blue';

/**
 * "More colours": each checked in both themes, none close to a preset or a status colour. They
 * are stored as custom colours, so the list can change without a migration.
 */
export const MORE_COLORS = [
  { key: 'coral', label: 'Coral', hex: '#e8603c' },
  { key: 'brown', label: 'Brown', hex: '#9a5b2e' },
  { key: 'olive', label: 'Olive', hex: '#7d8a12' },
  { key: 'lime', label: 'Lime', hex: '#4f9d1a' },
  { key: 'sky', label: 'Sky', hex: '#2f86d6' },
  { key: 'plum', label: 'Plum', hex: '#9c3fb8' },
  { key: 'magenta', label: 'Magenta', hex: '#c0399a' },
  { key: 'slate', label: 'Slate', hex: '#5d6b85' },
];

/** What "Any colour" starts on when the project has no custom colour yet (Sky). */
export const DEFAULT_CUSTOM_COLOR = '#2f86d6';

/** The messages for a custom colour that can't be seen in one of the themes (see colorProblem). */
export const COLOR_PROBLEM_MESSAGES = {
  light: 'This colour is too light to see. Pick a darker one.',
  dark: 'This colour is too dark to see in the dark theme. Pick a lighter one.',
};

const CUSTOM_COLOR = /^#[0-9a-f]{6}$/;
const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#1a1e3a';
const MIN_CONTRAST = 1.5;

/** True for one of the seven preset names. */
export function isPresetColor(value) {
  return PROJECT_COLORS.includes(value);
}

/** True for a custom colour: a lowercase '#rrggbb'. */
export function isCustomColor(value) {
  return typeof value === 'string' && CUSTOM_COLOR.test(value);
}

/**
 * A colour as typed or picked, trimmed and lowercased (' #9C3FB8' -> '#9c3fb8'). Nothing else
 * changes; values that aren't text come back as they are.
 */
export function normalizeColor(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/** WCAG relative luminance of a '#rrggbb'. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two '#rrggbb' colours (1 to 21). */
export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Why a custom colour can't be used: 'light' when it is below 1.5:1 against the light surface
 * (white), 'dark' when it is below 1.5:1 against the dark surface (#1a1e3a). Null when it is fine,
 * and for anything that isn't a custom colour.
 * @param {string} hex
 * @returns {null | 'light' | 'dark'}
 */
export function colorProblem(hex) {
  if (!isCustomColor(hex)) return null;
  if (contrastRatio(hex, LIGHT_SURFACE) < MIN_CONTRAST) return 'light';
  if (contrastRatio(hex, DARK_SURFACE) < MIN_CONTRAST) return 'dark';
  return null;
}

/**
 * The CSS class key for a stored colour: the preset's name, 'custom' for a custom colour (shown
 * through projectColorStyle), or `fallback` for anything else.
 * @param {unknown} color
 * @param {string | null} [fallback]
 * @returns {string | null}
 */
export function projectColorKey(color, fallback = DEFAULT_PROJECT_COLOR) {
  if (isPresetColor(color)) return color;
  if (isCustomColor(color)) return 'custom';
  return fallback;
}

/**
 * The inline style that carries a custom colour to its `.custom` class: { '--project': hex }.
 * An empty object for a preset and for anything invalid.
 * @param {unknown} color
 * @returns {{ '--project'?: string }}
 */
export function projectColorStyle(color) {
  return isCustomColor(color) ? { '--project': color } : {};
}
