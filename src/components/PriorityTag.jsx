import styles from './PriorityTag.module.css';

/** The three priorities, highest first. */
export const PRIORITIES = ['p1', 'p2', 'p3'];

/** What the tag shows. */
export const PRIORITY_LABELS = { p1: 'P1', p2: 'P2', p3: 'P3' };

/** What screen readers hear, and the tooltip. */
export const PRIORITY_NAMES = {
  p1: 'Priority 1, highest',
  p2: 'Priority 2',
  p3: 'Priority 3, lowest',
};

const SIZE_CLASS = { sm: styles.sm, md: styles.md, lg: styles.lg };

/**
 * A priority task's priority: "P1" on red, "P2" on marigold, "P3" on neutral, as a small label
 * (6 px radius, like a project label) so it never reads as a status pill. Sizes by height: sm 22 px
 * (rows and cards), md 26 px (beside a 26 px project label), lg 28 px (13 px text). Screen readers
 * hear "Priority 1, highest". Server-safe (no hooks).
 * @param {{ priority: 'p1'|'p2'|'p3', size?: 'sm'|'md'|'lg', className?: string }} props
 */
export default function PriorityTag({ priority, size = 'sm', className, ...rest }) {
  const key = PRIORITY_LABELS[priority] ? priority : 'p3';
  const classes = [styles.tag, SIZE_CLASS[size] ?? styles.sm, styles[key], className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} title={PRIORITY_NAMES[key]} {...rest}>
      <span aria-hidden="true">{PRIORITY_LABELS[key]}</span>
      <span className="visually-hidden">{PRIORITY_NAMES[key]}</span>
    </span>
  );
}
