// "Hours logged by project" (Team dashboard) and "Hours by project" (Company overview): a card
// with the Week / Month switch and one bar per project in its colour. Server-safe.
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import HBarList from '@/components/HBarList';
import Segmented from '@/components/Segmented';
import styles from './HoursCard.module.css';

/**
 * Bars for real projects (key 'p<id>' from hoursBars) open the project report for the same week
 * or month, so its hours match the bar; pending project requests and the "N more projects" row
 * have no page of their own.
 */
function withReportLinks(bars, range) {
  return bars.map((bar) => {
    const match = /^p(\d+)$/.exec(String(bar.key ?? ''));
    return match && !bar.href ? { ...bar, href: `/projects/${match[1]}?range=${range}` } : bar;
  });
}

/**
 * @param {{ title: string, subtitle: string, range: 'week'|'month',
 *   hrefs: { week: string, month: string }, bars: object[], barHeight?: number,
 *   className?: string }} props
 */
export default function HoursCard({
  title,
  subtitle,
  range,
  hrefs,
  bars,
  barHeight = 12,
  className = '',
}) {
  const items = [
    { value: 'week', label: 'Week', href: hrefs.week },
    { value: 'month', label: 'Month', href: hrefs.month },
  ];
  return (
    <Card className={`${styles.card} ${className}`}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        actions={<Segmented items={items} value={range} label="Hours for" />}
        className={styles.header}
      />
      <HBarList
        rows={withReportLinks(bars, range === 'month' ? 'month' : 'week')}
        barHeight={barHeight}
        className={styles.bars}
        empty={
          <EmptyState
            compact
            className={styles.empty}
            title={
              range === 'week'
                ? 'No hours logged this week yet.'
                : 'No hours logged this month yet.'
            }
            body="Hours appear here once reports are submitted."
            action={
              range === 'week' ? (
                <Button variant="text" size="compact" href={hrefs.month}>
                  See this month
                </Button>
              ) : null
            }
          />
        }
      />
    </Card>
  );
}
