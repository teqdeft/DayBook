import Link from 'next/link';
import styles from './Segmented.module.css';

/**
 * Grey track with a white thumb on the selected item (Week / Month). Same props as
 * FilterPills: items with `href` render links, otherwise buttons call onChange(value).
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
        const classes = [styles.item, selected ? styles.selected : null].filter(Boolean).join(' ');
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
