import Link from 'next/link';
import styles from './Segmented.module.css';

/**
 * Grey track with a white thumb on the selected item (Week / Month). Same props as
 * FilterPills: items with `href` render links, otherwise buttons call onChange(value). An item
 * with `disabled` can't be picked (CONTRACT 25: Mark leave's halves while the days differ): a
 * button gets `disabled`, a link renders as a span with aria-disabled; both show muted text.
 * @param {{ items: Array<{ value: string, label: import('react').ReactNode, href?: string,
 *   disabled?: boolean }>, value: string, onChange?: (value: string) => void, label?: string,
 *   className?: string }} props
 */
export default function Segmented({ items = [], value, onChange, label, className, ...rest }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={[styles.segmented, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {items.map((item) => {
        const selected = item.value === value;
        const disabled = Boolean(item.disabled);
        const classes = [
          styles.item,
          selected ? styles.selected : null,
          disabled ? styles.disabled : null,
        ]
          .filter(Boolean)
          .join(' ');
        if (item.href && disabled) {
          return (
            <span
              key={String(item.value)}
              className={classes}
              role="link"
              aria-disabled="true"
              aria-current={selected ? 'page' : undefined}
            >
              {item.label}
            </span>
          );
        }
        if (item.href) {
          return (
            <Link
              key={String(item.value)}
              href={item.href}
              className={classes}
              aria-current={selected ? 'page' : undefined}
              scroll={false}
            >
              {item.label}
            </Link>
          );
        }
        return (
          <button
            key={String(item.value)}
            type="button"
            className={classes}
            aria-pressed={selected}
            disabled={disabled}
            onClick={onChange && !disabled ? () => onChange(item.value) : undefined}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
