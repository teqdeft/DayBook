// A task's due date as a pill (CONTRACT 22): late in red, today in marigold, later and none neutral.
// On a done task it is just the date, without a pill. Server-safe.
import Tag from '@/components/Tag';
import { dayCount, daysBetween, shortDate } from './planFormat';
import styles from './DueTag.module.css';

/**
 * @param {string | null} dueDate 'YYYY-MM-DD'
 * @param {string} today the company's date
 * @returns {{ text: string, tone: 'red'|'marigold'|'neutral' }}
 */
export function dueLook(dueDate, today) {
  if (!dueDate) return { text: 'No due date', tone: 'neutral' };
  const late = daysBetween(dueDate, today);
  if (late > 0) return { text: `${dayCount(late)} late`, tone: 'red' };
  if (late === 0) return { text: 'Due today', tone: 'marigold' };
  return { text: `Due ${shortDate(dueDate, today)}`, tone: 'neutral' };
}

/**
 * @param {{ dueDate: string | null, today: string, done?: boolean, className?: string }} props
 */
export default function DueTag({ dueDate, today, done = false, className }) {
  if (done) {
    return (
      <span className={[styles.done, className].filter(Boolean).join(' ')}>
        {dueDate ? shortDate(dueDate, today) : 'No due date'}
      </span>
    );
  }
  const { text, tone } = dueLook(dueDate, today);
  return (
    <Tag tone={tone} className={className}>
      {text}
    </Tag>
  );
}
