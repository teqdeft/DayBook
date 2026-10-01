import styles from './Tag.module.css';

const TONES = new Set([
  'primary',
  'blue',
  'marigold',
  'green',
  'red',
  'violet',
  'teal',
  'orange',
  'pink',
  'neutral',
  'grey',
  'ink',
]);

const SIZE_CLASS = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
  xl: styles.xl,
  xxl: styles.xxl,
};

/**
 * Soft, fully rounded label: "Today", "WFH", "Late 38m", "Carried over", "Report edit", role
 * names. Sizes by height: sm 22 px and md 26 px (12 px text), lg 28 px and xl 30 px (13 px text),
 * xxl 40 px (14 px, "In office since 9:32"). `solid` uses the strong fill (the "Urgent" pill);
 * `ink` is always solid navy ("Admin"); `dot` adds a leading status dot. Tone `blue` is the
 * lighter primary text of the "Today" tag; `grey` is the Employee role tag. `padX` (px) overrides
 * the side padding where the canvas differs: padX={8} for the Team board's "Late 38m" tags,
 * padX={12} for the solid "Urgent" tag on Today's urgent card.
 */
export default function Tag({
  tone = 'neutral',
  size = 'sm',
  solid = false,
  dot = false,
  padX,
  className,
  style,
  children,
  ...rest
}) {
  const toneName = TONES.has(tone) ? tone : 'neutral';
  const classes = [
    styles.tag,
    SIZE_CLASS[size] ?? styles.sm,
    styles[toneName],
    solid ? styles.solid : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const padStyle = typeof padX === 'number' ? { '--tag-pad-x': `${padX}px` } : null;
  return (
    <span className={classes} style={padStyle ? { ...padStyle, ...style } : style} {...rest}>
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
