// The box at the top of the Overview: what the forecast says, in its colour. Server-safe.
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { healthTone } from '@/modules/projectPlan/forecast';
import styles from './Overview.module.css';

const TONE_CLASS = {
  red: styles.healthRed,
  marigold: styles.healthMarigold,
  green: styles.healthGreen,
  neutral: styles.healthNeutral,
};

const ICONS = { red: TriangleAlert, marigold: TriangleAlert, green: CircleCheck };

/** @param {{ forecast: { kind: string, title: string, body: string } }} props */
export default function HealthBox({ forecast }) {
  const tone = healthTone(forecast.kind);
  const Icon = ICONS[tone] ?? CircleAlert;
  return (
    <div role="status" className={`${styles.health} ${TONE_CLASS[tone]}`}>
      <Icon className={styles.healthIcon} size={20} strokeWidth={1.8} aria-hidden="true" />
      <div className={styles.healthText}>
        <div className={styles.healthTitle}>{forecast.title}</div>
        <div className={styles.healthBody}>{forecast.body}</div>
      </div>
    </div>
  );
}
