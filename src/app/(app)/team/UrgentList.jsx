// Urgent projects as marigold boxes: project name in its colour, the urgent note, and when it
// was marked ("Urgent now" on the Team dashboard, "Urgent projects" on the Company overview).
// Server-safe.
import { projectColor } from '@/components/ProjectLabel';
import styles from './UrgentList.module.css';

/**
 * @param {{ items: { id: number, name: string, color: string, note: string, meta: string }[],
 *   empty?: import('react').ReactNode, className?: string }} props
 */
export default function UrgentList({ items = [], empty = null, className = '' }) {
  if (items.length === 0) return empty;
  return (
    <ul className={`${styles.list} ${className}`}>
      {items.map((item) => (
        <li key={item.id} className={styles.item}>
          <p className={`${styles.project} ${styles[projectColor(item.color)]}`}>{item.name}</p>
          <p className={styles.note}>{item.note}</p>
          <p className={styles.meta}>{item.meta}</p>
        </li>
      ))}
    </ul>
  );
}
