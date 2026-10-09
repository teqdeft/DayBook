'use client';
// "From your timers" above the project cards (CONTRACT 15): the day's timer time per project,
// rounded to the nearest 15 minutes, with the task notes, a total, and "Fill report from timers".
// Shown while the report can change and something was tracked; in required mode its subtitle
// says the hours come from the timers. It shows useReport().timers, which today's report reads
// again every minute (useTimerFill); a timer stopped from the sidebar chip refreshes the page.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import ProjectLabel from '@/components/ProjectLabel';
import { formatHours } from '@/lib/time';
import { useReport } from './ReportProvider';
import { hoursComeFromTimers, timerCardRows } from './reportTimers';
import styles from './TimersCard.module.css';

export default function TimersCard() {
  const { readOnly, submitting, timers, applyTimers } = useReport();
  const router = useRouter();
  const hasTimers = Boolean(timers);

  useEffect(() => {
    if (!hasTimers) return undefined;
    const refresh = () => router.refresh();
    window.addEventListener('daybook:timers-changed', refresh);
    return () => window.removeEventListener('daybook:timers-changed', refresh);
  }, [hasTimers, router]);

  const { rows, totalMinutes } = timerCardRows(timers);
  if (readOnly || rows.length === 0) return null;
  const required = hoursComeFromTimers(timers);

  return (
    <Card as="section" padding="none" aria-label="From your timers" className={styles.card}>
      <CardHeader
        title="From your timers"
        subtitle={required ? 'Hours come from your timers' : 'Rounded to the nearest 15 minutes'}
        divider
        className={styles.header}
        actions={
          <Button size="compact" disabled={submitting} onClick={applyTimers}>
            Fill report from timers
          </Button>
        }
      />
      <ul className={styles.rows}>
        {rows.map((row) => (
          <li key={row.projectId} className={styles.row}>
            <ProjectLabel
              project={{ name: row.projectName, color: row.projectColor }}
              className={styles.label}
            />
            <span className={styles.notes}>{row.notes}</span>
            <span className={`${styles.hours} ${row.roundedMinutes ? '' : styles.zero} num`}>
              {formatHours(row.roundedMinutes)}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.total}>
        <span>Total</span>
        <span className={`${styles.totalHours} num`}>{formatHours(totalMinutes)}</span>
      </p>
    </Card>
  );
}
