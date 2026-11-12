// Progress on the Overview: a donut of the tasks done, from 12 o'clock. Server-safe.
import Card from '@/components/Card';
import { plural } from '@/lib/text';
import styles from './Overview.module.css';

const SIZE = 140;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** @param {{ forecast: { pct: number, done: number, total: number } }} props */
export default function ProgressCard({ forecast }) {
  const { pct, done, total } = forecast;
  const ratio = total > 0 ? done / total : 0;
  const center = SIZE / 2;
  const tasks = `${done} of ${total} ${plural(total, 'task')}`;
  return (
    <Card
      as="section"
      padding="compact"
      aria-labelledby="overview-progress"
      className={styles.smallCard}
    >
      <h2 id="overview-progress" className={styles.cardTitle}>
        Progress
      </h2>
      <div className={styles.progressBody}>
        <div className={styles.donut}>
          <svg
            role="img"
            aria-label={`${pct}% done out of 100%, ${tasks}`}
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
          >
            <circle
              className={styles.donutTrack}
              cx={center}
              cy={center}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
            />
            <circle
              className={styles.donutDone}
              cx={center}
              cy={center}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeDasharray={`${(CIRCUMFERENCE * ratio).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
              transform={`rotate(-90 ${center} ${center})`}
            />
          </svg>
          <div aria-hidden="true" className={styles.donutCenter}>
            <span className={styles.donutValue}>{pct}%</span>
            <span className={styles.donutLabel}>of 100%</span>
          </div>
        </div>
        <p className={styles.progressText}>{total > 0 ? `${tasks} done` : 'No tasks yet'}</p>
      </div>
    </Card>
  );
}
