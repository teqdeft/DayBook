import ProgressBar from './ProgressBar';
import styles from './Kpi.module.css';

/**
 * Number card: label, big number with a short "sub" after it, optional footer line and an 8 px
 * bar. Example: <Kpi label="Hours logged" value="142h" sub="this month" percent={86} />.
 * `trailing` is an element at the top right, level with the label (the Overview's chevron on a
 * card that is a link); `as` and `href` pass through, so <Kpi as={Link} href="/requests" ...>
 * makes the whole card the link.
 */
export default function Kpi({
  label,
  value,
  sub,
  footer,
  percent,
  color = 'primary',
  trailing,
  as: Tag = 'div',
  className,
  ...rest
}) {
  const hasBar = percent !== undefined && percent !== null;
  const classes = [styles.kpi, trailing ? styles.withTrailing : null, className];
  return (
    <Tag className={classes.filter(Boolean).join(' ')} {...rest}>
      <p className={styles.label}>{label}</p>
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
      <p className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
        {sub ? <span className={styles.sub}>{sub}</span> : null}
      </p>
      {footer ? <p className={styles.footer}>{footer}</p> : null}
      {hasBar ? (
        <ProgressBar className={styles.bar} percent={percent} color={color} height={8} />
      ) : null}
    </Tag>
  );
}
