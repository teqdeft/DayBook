'use client';
// "+ Add people" in the project drawer: a small searchable list of active people who are not on
// the team yet. Arrow keys move, Enter adds, Escape closes.
import { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Input from '@/components/Input';
import styles from './PeoplePicker.module.css';

function matches(person, query) {
  if (!query) return true;
  const text = query.toLowerCase();
  return (
    person.name.toLowerCase().includes(text) ||
    String(person.designation ?? '')
      .toLowerCase()
      .includes(text)
  );
}

export default function PeoplePicker({ people, selectedIds, onAdd }) {
  const listId = useId();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  const available = people.filter(
    (person) => !selectedIds.includes(person.id) && matches(person, query.trim()),
  );

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function close({ focusButton = true } = {}) {
    setOpen(false);
    setQuery('');
    setActive(0);
    if (focusButton) buttonRef.current?.focus();
  }

  function add(person) {
    onAdd(person);
    setActive(0);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (available.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + available.length) % available.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const person = available[Math.min(active, available.length - 1)];
      if (person) add(person);
    } else if (event.key === 'Escape') {
      // Close the list, not the drawer.
      event.preventDefault();
      close();
    }
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <Button
        ref={buttonRef}
        variant="text"
        icon={<Plus size={18} strokeWidth={1.8} aria-hidden="true" className={styles.plus} />}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => (open ? close({ focusButton: false }) : setOpen(true))}
        className={styles.trigger}
      >
        Add people
      </Button>
      {open ? (
        <div className={styles.panel}>
          <label htmlFor={inputId} className="visually-hidden">
            Find people to add
          </label>
          <Input
            id={inputId}
            compact
            autoFocus
            value={query}
            placeholder="Search by name"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              available.length > 0
                ? `${listId}-${Math.min(active, available.length - 1)}`
                : undefined
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          {available.length > 0 ? (
            <ul id={listId} role="listbox" aria-label="People" className={styles.list}>
              {available.map((person, index) => (
                <li
                  key={person.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === Math.min(active, available.length - 1)}
                  className={`${styles.option} ${
                    index === Math.min(active, available.length - 1) ? styles.active : ''
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(person)}
                >
                  <Avatar user={person} size={28} />
                  <span className={styles.text}>
                    <span className={styles.name}>{person.name}</span>
                    {person.designation ? (
                      <span className={styles.designation}>{person.designation}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              {query.trim() ? 'Nobody matches that name.' : 'Everyone is on the team already.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
