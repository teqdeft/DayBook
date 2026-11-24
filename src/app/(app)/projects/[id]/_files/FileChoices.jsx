'use client';
// The two choices every Files tab window asks (CONTRACT 27, Files tab): the place ("Add to" or
// "Place": Whole project or a phase, the current one marked) and who can see it (radios "Everyone
// on the project" or "Only PM and Admins", each with its help line). The value is always sent.
import Select from '@/components/Select';
import { placeOptions } from './filesTabView';
import styles from './FileDialogs.module.css';

/**
 * @param {{ id: string, label: string, value: string, currentPhase: string | null,
 *   onChange: (value: string) => void, error?: string | null }} props value: 'project' or a
 *   phase key (phaseOption)
 */
export function PlaceField({ id, label, value, currentPhase, onChange, error = null }) {
  return (
    <div>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <Select
        id={id}
        value={value}
        error={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        options={placeOptions(currentPhase)}
      />
      {error ? (
        <p className={styles.error} id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * @param {{ name: string, value: 'everyone' | 'managers', pmName?: string | null,
 *   onChange: (value: 'everyone' | 'managers') => void }} props name: the radios' group name
 */
export function VisibilityField({ name, value, pmName, onChange }) {
  const choices = [
    {
      value: 'everyone',
      title: 'Everyone on the project',
      help: 'People on the project can open and download it.',
    },
    {
      value: 'managers',
      title: 'Only PM and Admins',
      help: `Only ${pmName || 'the PM'} and Admins can open it.`,
    },
  ];
  return (
    <fieldset className={styles.choices}>
      <legend className={styles.label}>Who can see it</legend>
      {choices.map((choice) => (
        <label key={choice.value} className={styles.radio}>
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <span>
            <span className={styles.radioTitle}>{choice.title}</span>
            <span className={styles.radioHelp}>{choice.help}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
