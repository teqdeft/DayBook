// "Needs attention" on the Company overview: one row per thing waiting, with its status, a short
// sentence and a Review link to the screen that handles it. Server-safe.
import Button from '@/components/Button';
import StatusCell from '@/components/StatusCell';
import styles from './NeedsAttention.module.css';

/**
 * @param {{ items: { key: string, status: string, text: string, href: string }[],
 *   empty?: import('react').ReactNode, className?: string }} props
 */
export default function NeedsAttention({ items = [], empty = null, className = '' }) {
  if (items.length === 0) return empty;
  return (
    <ul className={`${styles.list} ${className}`}>
      {items.map((item) => (
        <li key={item.key} className={styles.item}>
          <StatusCell status={item.status} size="block" className={styles.status} />
          <p className={styles.text}>{item.text}</p>
          <Button
            variant="text"
            size="compact"
            href={item.href}
            className={styles.review}
            aria-label={`Review: ${item.text}`}
          >
            Review
          </Button>
        </li>
      ))}
    </ul>
  );
}
