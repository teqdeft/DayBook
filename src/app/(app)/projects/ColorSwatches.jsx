'use client';
// "Colour label": six round swatches (native radio buttons); the selected one has a ring.
import styles from './ColorSwatches.module.css';

export const COLOR_OPTIONS = [
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'violet', label: 'Violet' },
  { value: 'orange', label: 'Orange' },
  { value: 'teal', label: 'Teal' },
  { value: 'pink', label: 'Pink' },
];

export default function ColorSwatches({ value, onChange, name = 'project-color', className }) {
  return (
    <div className={[styles.swatches, className].filter(Boolean).join(' ')}>
      {COLOR_OPTIONS.map((option) => (
        <label key={option.value} className={styles.swatch} title={option.label}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className={styles.input}
            aria-label={option.label}
          />
          <span className={`${styles.dot} ${styles[option.value]}`} aria-hidden="true" />
        </label>
      ))}
    </div>
  );
}
