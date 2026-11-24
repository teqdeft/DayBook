// The forecast under the band (CONTRACT 27, The band; PM view only, never for members): the health
// icon in its colour, the bold title, then the body ("Off track: will miss the deadline by about 12
// days. At the current speed ..."). Server-safe.
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { healthTone } from '@/modules/projectPlan/forecast';
import styles from './ProgressBand.module.css';

const ICONS = { red: TriangleAlert, marigold: TriangleAlert, green: CircleCheck };
const TONES = { red: styles.red, marigold: styles.marigold, green: styles.green };

/** The title as the first sentence: "Off track: ... 12 days." */
const sentence = (title) => (/[.!?]$/.test(title) ? title : `${title}.`);

/** @param {{ forecast: { kind: string, title: string, body: string } | null }} props */
export default function ForecastLine({ forecast }) {
  if (!forecast) return null;
  const tone = healthTone(forecast.kind);
  const Icon = ICONS[tone] ?? CircleAlert;
  return (
    <p className={`${styles.forecast} ${TONES[tone] ?? ''}`}>
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      <span>
        <strong>{sentence(forecast.title)}</strong> {forecast.body}
      </span>
    </p>
  );
}
