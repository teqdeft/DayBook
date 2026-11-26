'use client';
// "Assign to" in the New task and Edit task window (CONTRACT 28, New task and Edit task, field 2): a
// `<fieldset>` of wrapping radio chips (38 px, 44 px on a phone, each a `<label>` with a 28 px
// avatar and the name): "Anyone on the project" (the dashed circle, the default), "Me (Riya
// Kapoor)", the project's PM when the viewer isn't, the active members A to Z, and on Edit the
// current person when they aren't on the list ("Vishal Saini (not on the project)", "Arvind Menon
// (Admin)"), checked. Past 8 people a "Find a person" field above the chips filters them. Anyone
// says who sees it: "Everyone on the project sees it on their Today page."
import { useId, useState } from 'react';
import { Users } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Input from '@/components/Input';
import { ANYONE_HELP, FIND_FROM, findChoices } from './taskFormModel';
import styles from './TaskFormDialog.module.css';

/** The dashed "Anyone on the project" circle, 28 px. */
function AnyoneMark() {
  return (
    <span className={styles.anyone} aria-hidden="true">
      <Users size={14} strokeWidth={1.8} />
    </span>
  );
}

/**
 * @param {{ choices: Array<{ value: string, label: string, person: object | null }>,
 *   value: string, onChange: (event: Event) => void, error?: string | null }} props choices:
 *   assignChoices(); value: the checked chip ('' for anyone on the project)
 */
export default function AssignField({ choices, value, onChange, error = null }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const shown = findChoices(choices, query, value);
  return (
    <div className={styles.assignBox}>
      <fieldset className={styles.assign} aria-describedby={error ? `${id}-error` : undefined}>
        <legend className={styles.legend}>Assign to</legend>
        {choices.length > FIND_FROM ? (
          <div className={styles.find}>
            <label className="visually-hidden" htmlFor={`${id}-find`}>
              Find a person
            </label>
            <Input
              id={`${id}-find`}
              type="search"
              placeholder="Find a person"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}
        {shown.map((choice) => (
          <label key={choice.value || 'anyone'} className={styles.chip}>
            <input
              type="radio"
              name={`${id}-assignee`}
              value={choice.value}
              checked={value === choice.value}
              onChange={onChange}
            />
            {choice.person ? <Avatar user={choice.person} size={28} /> : <AnyoneMark />}
            <span>{choice.label}</span>
          </label>
        ))}
      </fieldset>
      {value === '' ? <p className={styles.help}>{ANYONE_HELP}</p> : null}
      {error ? (
        <p id={`${id}-error`} className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
