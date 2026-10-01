// Maps colour names used by charts (tones and project label colours) to CSS variables.
// Project colours: blue, green, violet, orange, teal, pink (the strong "bar and square" colour).

const COLORS = {
  primary: 'var(--primary)',
  blue: 'var(--label-blue)',
  green: 'var(--label-green)',
  violet: 'var(--label-violet)',
  orange: 'var(--label-orange)',
  teal: 'var(--label-teal)',
  pink: 'var(--label-pink)',
  red: 'var(--red)',
  marigold: 'var(--marigold)',
  navy: 'var(--navy)',
  ink: 'var(--ink)',
  muted: 'var(--muted)',
  line: 'var(--line-strong)',
  track: 'var(--track)',
  office: 'var(--primary)',
  wfh: 'var(--violet)',
  late: 'var(--marigold)',
  missing: 'var(--red)',
};

/**
 * A CSS colour value for a chart colour name. `var(--token)` values pass through unchanged.
 * @param {string | undefined} color
 * @param {string} [fallback]
 */
export function resolveColor(color, fallback = 'primary') {
  if (typeof color === 'string' && color.startsWith('var(--')) return color;
  return COLORS[color] ?? COLORS[fallback] ?? COLORS.primary;
}

// The same tones as text on a card surface. Light mode uses the strong tone itself (as the canvas
// does); the dark theme swaps in lighter values that keep 4.5:1 contrast.
const TEXT_COLORS = {
  primary: 'var(--primary)',
  office: 'var(--primary)',
  red: 'var(--red-on-surface)',
  missing: 'var(--red-on-surface)',
  violet: 'var(--violet-on-surface)',
  wfh: 'var(--violet-on-surface)',
  green: 'var(--green-text)',
  marigold: 'var(--marigold-text)',
  late: 'var(--marigold-text)',
  blue: 'var(--label-blue-text)',
  orange: 'var(--label-orange-text)',
  teal: 'var(--label-teal-text)',
  pink: 'var(--label-pink-text)',
  ink: 'var(--ink)',
  muted: 'var(--muted)',
};

/**
 * A CSS colour for text in a tone (group titles and links on a card), readable in both themes.
 * @param {string | undefined} color
 */
export function resolveTextColor(color) {
  if (typeof color === 'string' && color.startsWith('var(--')) return color;
  return TEXT_COLORS[color] ?? TEXT_COLORS.primary;
}

/** Clamps a number to 0..1. */
export function fraction(value, max) {
  const v = Number(value) || 0;
  const m = Number(max) || 0;
  if (m <= 0 || v <= 0) return 0;
  return Math.min(1, v / m);
}
