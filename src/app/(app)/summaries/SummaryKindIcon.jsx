// The square in front of a summary: a folder board for a PM's daily project summary, a calendar
// for HR's weekly attendance notes. Server-safe.
import { CalendarCheck, FolderKanban } from 'lucide-react';
import styles from './SummaryKindIcon.module.css';

export default function SummaryKindIcon({ kind, size = 40, className }) {
  const Icon = kind === 'hr_weekly' ? CalendarCheck : FolderKanban;
  return (
    <span
      className={[styles.icon, kind === 'hr_weekly' ? styles.weekly : styles.daily, className]
        .filter(Boolean)
        .join(' ')}
      style={{ '--icon-box': `${size}px` }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={1.8} />
    </span>
  );
}
