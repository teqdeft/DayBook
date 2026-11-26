'use client';
// The phone's switcher (CONTRACT 27 and 28, Phone): one phase column at a time (a done phase is a
// step too: no rail on a phone), with "Previous phase" and "Next phase" (44 px) around
// "Development · 6 of 12", read out politely when it changes. Shown only at 640 px and below.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './Columns.module.css';

/**
 * @param {{ steps: string[], step: string, text: string, onStep: (key: string) => void }} props
 *   steps: boardView.phoneSteps'; text: boardView.switcherText's for the shown step
 */
export default function PhoneSwitcher({ steps, step, text, onStep }) {
  const index = Math.max(0, steps.indexOf(step));
  const [name, ...rest] = text.split(' · ');
  return (
    <div className={styles.switcher}>
      <button
        type="button"
        className={styles.squareButton}
        aria-label="Previous phase"
        disabled={index === 0}
        onClick={() => onStep(steps[index - 1])}
      >
        <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <p className={styles.switcherText} aria-live="polite">
        <b>{name}</b>
        {rest.length > 0 ? <span className="num"> · {rest.join(' · ')}</span> : null}
      </p>
      <button
        type="button"
        className={styles.squareButton}
        aria-label="Next phase"
        disabled={index >= steps.length - 1}
        onClick={() => onStep(steps[index + 1])}
      >
        <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </div>
  );
}
