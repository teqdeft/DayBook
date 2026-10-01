import styles from './ProgressBar.module.css';

// Tones and project colours -> CSS variables (bars, legend squares).
const COLOR_VARS = {
  primary: 'var(--primary)',
  blue: 'var(--label-blue)',
  green: 'var(--green)',
  violet: 'var(--violet)',
  red: 'var(--red)',
  marigold: 'var(--marigold)',
  teal: 'var(--label-teal)',
  orange: 'var(--label-orange)',
  pink: 'var(--label-pink)',
  ink: 'var(--ink)',
  navy: 'var(--navy)',
  grey: 'var(--line-strong)',
};

/** CSS colour for a tone ('green') or a project colour ('orange'); unknown values fall back to primary. */
export function toneColor(color) {
  return COLOR_VARS[color] ?? COLOR_VARS.primary;
}

function clamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

/**
 * Rounded bar on a --track background: 8 px on number cards, 12 px in hour lists. Any value
 * above 0 shows at least a dot. Pass `label` to expose it as a progressbar to screen readers.
 */
export default function ProgressBar({
  percent = 0,
  color = 'primary',
  height = 8,
  label,
  className,
}) {
  const value = clamp(percent);
  const a11y = label
    ? {
        role: 'progressbar',
        'aria-label': label,
        'aria-valuenow': Math.round(value),
        'aria-valuemin': 0,
        'aria-valuemax': 100,
      }
    : { 'aria-hidden': true };
  return (
    <div
      className={[styles.track, className].filter(Boolean).join(' ')}
      style={{ height: `${height}px` }}
      {...a11y}
    >
      {value > 0 ? (
        <div
          className={styles.fill}
          style={{ width: `${value}%`, minWidth: `${height}px`, background: toneColor(color) }}
        />
      ) : null}
    </div>
  );
}
