'use client';
// Client field: type to find an existing client, or keep typing to add a new one (the server
// creates it when the project is saved).
import { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import Input from '@/components/Input';
import { api } from '@/lib/apiClient';
import styles from './ClientCombobox.module.css';

const DEBOUNCE_MS = 200;

/** Client names are saved with single spaces and no outer spaces. */
function normalize(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function ClientCombobox({ id, value, onChange, error, ...rest }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  // The text the options were loaded for; "Add as a new client" waits for these results so an
  // existing client is never hidden behind it.
  const [loadedFor, setLoadedFor] = useState(null);
  const [active, setActive] = useState(-1);
  const timer = useRef(null);
  const request = useRef(null);
  const rootRef = useRef(null);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      request.current?.abort();
    },
    [],
  );

  function search(text) {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      try {
        const { data } = await api.get(
          `/api/clients?q=${encodeURIComponent(normalize(text))}&limit=8`,
          { signal: controller.signal },
        );
        setOptions(Array.isArray(data) ? data : []);
        setLoadedFor(normalize(text).toLowerCase());
        setActive(-1);
      } catch (caught) {
        if (caught?.name === 'AbortError') return;
        setOptions([]);
        setLoadedFor(normalize(text).toLowerCase());
      }
    }, DEBOUNCE_MS);
  }

  const text = normalize(value);
  const exact = options.some((option) => option.name.toLowerCase() === text.toLowerCase());
  const fresh = loadedFor === text.toLowerCase();
  const items = [
    ...options.map((option) => ({ key: `client-${option.id}`, name: option.name, isNew: false })),
    ...(text && fresh && !exact ? [{ key: 'new', name: text, isNew: true }] : []),
  ];
  const showList = open && items.length > 0;

  function choose(item) {
    onChange(item.name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        search(value);
        return;
      }
      if (items.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + items.length) % items.length);
    } else if (event.key === 'Enter' && showList && active >= 0 && items[active]) {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === 'Escape' && showList) {
      // Close the list, not the drawer.
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Input
        {...rest}
        id={id}
        value={value}
        maxLength={160}
        autoComplete="off"
        placeholder="Client or company name"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        error={error}
        onFocus={() => {
          setOpen(true);
          search(value);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          search(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul id={listId} role="listbox" className={styles.list} aria-label="Clients">
          {items.map((item, index) => (
            <li
              key={item.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={`${styles.option} ${index === active ? styles.active : ''}`}
              // Keep focus in the input while choosing with the mouse.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
            >
              {item.isNew ? (
                <>
                  <Plus size={16} strokeWidth={1.8} aria-hidden="true" className={styles.plus} />
                  <span className={styles.name}>Add &ldquo;{item.name}&rdquo; as a new client</span>
                </>
              ) : (
                <span className={styles.name}>{item.name}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
