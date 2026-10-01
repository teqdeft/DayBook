import Link from 'next/link';
import styles from './FilterPills.module.css';

/**
 * Row of 36 px rounded filter pills; the selected one is --ink with white text. Items with
 * `href` render links (server pages filter through the URL); otherwise buttons call
 * onChange(value) (use it from a client component).
 */
export default function FilterPills({ items = [], value, onChange, label, className, ...rest }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={[styles.pills, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {items.map((item) => {
        const selected = item.value === value;
        const classes = [styles.pill, selected ? styles.selected : null].filter(Boolean).join(' ');
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
            onClick={onChange ? () => onChange(item.value) : undefined}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
