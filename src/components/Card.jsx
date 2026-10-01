import styles from './Card.module.css';

const TONE_CLASS = {
  default: null,
  urgent: styles.urgent,
  dark: styles.dark,
  dashed: styles.dashed,
  muted: styles.muted,
};

const PADDING_CLASS = {
  default: styles.padDefault,
  compact: styles.padCompact,
  none: styles.padNone,
};

/**
 * White card with a 1 px border and 16 px radius. Tones: urgent (marigold tint), dark (navy
 * strip), dashed ("Add another project"), muted (inner grey box). Padding is 20 x 24 px (compact
 * 16 x 20); a className that sets `--card-pad: 23px 25px` adjusts it for one card.
 */
export default function Card({
  as: Tag = 'div',
  tone = 'default',
  padding = 'default',
  className,
  children,
  ...rest
}) {
  const classes = [
    styles.card,
    TONE_CLASS[tone],
    PADDING_CLASS[padding] ?? styles.padDefault,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Card title row: 18 px semibold title, optional subtitle and actions on the right. `divider`
 * gives the table-card header (54 px, 20 px sides, 1 px line under it) for cards with
 * padding="none".
 */
export function CardHeader({
  title,
  subtitle,
  actions,
  divider = false,
  titleAs: Title = 'h2',
  className,
  ...rest
}) {
  const classes = [styles.header, divider ? styles.headerDivider : null, className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      <div className={styles.heading}>
        <Title className={styles.title}>{title}</Title>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
