import ProgressBar from './ProgressBar';
import styles from './Kpi.module.css';

/**
 * Number card: label, big number with a short "sub" after it, optional footer line and an 8 px
 * bar. Example: <Kpi label="Hours logged" value="142h" sub="this month" percent={86} />.
 */
export default function Kpi({
  label,
  value,
  sub,
  footer,
  percent,
  color = 'primary',
  as: Tag = 'div',
  className,
  ...rest
}) {
  const hasBar = percent !== undefined && percent !== null;
  return (
    <Tag className={[styles.kpi, className].filter(Boolean).join(' ')} {...rest}>
      <p className={styles.label}>{label}</p>
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
