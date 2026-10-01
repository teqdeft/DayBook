import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import styles from './Breadcrumb.module.css';

/** "Team › Vishal Saini" above a page title. The last item is the current page. */
export default function Breadcrumb({ items = [], className, ...rest }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={[styles.breadcrumb, className].filter(Boolean).join(' ')}
      {...rest}
    >
      <ol className={styles.list}>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className={styles.item}>
              {item.href && !last ? (
                <Link href={item.href} className={styles.link}>
                  {item.label}
                </Link>
              ) : (
                <span
                  className={last ? styles.current : styles.link}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {last ? null : (
                <ChevronRight
                  className={styles.separator}
                  size={14}
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
