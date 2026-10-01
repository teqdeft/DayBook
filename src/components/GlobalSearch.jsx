'use client';
// Top bar search (Team dashboard, Company overview): finds people (/api/users?q=) and projects
// (/api/projects?q=) as you type. Arrow keys move through the results, Enter opens one.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { initials } from '@/lib/text';
import { resolveColor } from './chartColors';
import styles from './GlobalSearch.module.css';

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
const LIMIT = 6;
const EDGE = 16; // the page's side gutter on phones

/**
 * Moves the open panel sideways so it stays on screen: it hangs from the right edge of the box,
 * which is near the left of the screen when the top bar wraps on phones.
 */
function keepOnScreen(panel) {
  panel.style.setProperty('--panel-shift', '0px');
  const box = panel.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth;
  let shift = 0;
  if (box.left < EDGE) shift = EDGE - box.left;
  else if (box.right > viewport - EDGE)
    shift = Math.max(EDGE - box.left, viewport - EDGE - box.right);
  panel.style.setProperty('--panel-shift', `${Math.round(shift)}px`);
}

/**
 * @param {{
 *   placeholder?: string, width?: number,
 *   scope?: { people?: 'team' | 'people' | null, projects?: boolean },
 * }} props
 *   `scope.people`: 'team' links a person to /team/[id], 'people' to /people?q=, null skips people.
 */
export default function GlobalSearch({
  placeholder = 'Search',
  width = 280,
  scope = { people: 'team', projects: true },
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = nothing searched yet
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const timer = useRef(null);
  const request = useRef(null);
  const listId = useId();

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      request.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  async function search(text) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    const q = encodeURIComponent(text);
    const [people, projects] = await Promise.all([
      scope.people ? fetchList(`/api/users?q=${q}&status=active&limit=${LIMIT}`, controller) : [],
      scope.projects ? fetchList(`/api/projects?q=${q}&limit=${LIMIT}`, controller) : [],
    ]);
    if (controller.signal.aborted) return;
    setResults(toOptions({ people, projects, scope }));
    setActive(-1);
    setLoading(false);
  }

  function onChange(event) {
    const text = event.target.value;
    setQuery(text);
    setOpen(true);
    clearTimeout(timer.current);
    if (text.trim().length < MIN_CHARS) {
      request.current?.abort();
      setResults(null);
      setLoading(false);
      return;
    }
    timer.current = setTimeout(() => search(text.trim()), DEBOUNCE_MS);
  }

  function go(option) {
    setOpen(false);
    setQuery('');
    setResults(null);
    router.push(option.href);
  }

  function onKeyDown(event) {
    const options = results ?? [];
    if (event.key === 'ArrowDown' && options.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === 'ArrowUp' && options.length > 0) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (event.key === 'Enter' && open && options[active]) {
      event.preventDefault();
      go(options[active]);
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else if (query) {
        setQuery('');
        setResults(null);
      }
    }
  }

  const showPanel = open && query.trim().length >= MIN_CHARS;
  const options = results ?? [];

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!showPanel || !panel) return undefined;
    const place = () => keepOnScreen(panel);
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [showPanel]);

  return (
    <div ref={rootRef} className={styles.root} style={{ '--search-w': `${width}px` }}>
      <label className={styles.box}>
        <Search className={styles.icon} size={16} strokeWidth={1.8} aria-hidden="true" />
        <span className="visually-hidden">{placeholder}</span>
        <input
          type="search"
          className={styles.input}
          placeholder={placeholder}
          value={query}
          onChange={onChange}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={showPanel ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {showPanel ? (
        <div ref={panelRef} className={styles.panel}>
          <ul id={listId} role="listbox" aria-label="Search results" className={styles.list}>
            {options.map((option, index) => (
              <li
                key={option.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={`${styles.option} ${index === active ? styles.active : ''}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => go(option)}
                onMouseMove={() => setActive(index)}
              >
                {option.kind === 'person' ? (
                  <span className={styles.avatar} aria-hidden="true">
                    {option.initials}
                  </span>
                ) : (
                  <span
                    className={styles.square}
                    style={{ background: option.color }}
                    aria-hidden="true"
                  >
                    {option.letter}
                  </span>
                )}
                <span className={styles.optionText}>
                  <span className={styles.optionTitle}>{option.title}</span>
                  {option.subtitle ? (
                    <span className={styles.optionSub}>{option.subtitle}</span>
                  ) : null}
                </span>
                <span className={styles.kind}>
                  {option.kind === 'person' ? 'Person' : 'Project'}
                </span>
              </li>
            ))}
          </ul>
          {options.length === 0 ? (
            <p className={styles.empty} role="status">
              {loading || results === null ? 'Searching…' : `Nothing matches "${query.trim()}".`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A list endpoint's rows, or [] when it fails (no access, not built yet, aborted). */
async function fetchList(path, controller) {
  try {
    const json = await api.get(path, { signal: controller.signal });
    return Array.isArray(json?.data) ? json.data : [];
  } catch {
    return [];
  }
}

function toOptions({ people, projects, scope }) {
  const personOptions = people.slice(0, LIMIT).map((person) => ({
    key: `person-${person.id}`,
    kind: 'person',
    title: person.name,
    subtitle: person.designation ?? person.departmentName ?? '',
    initials: person.initials ?? initials(person.name),
    href:
      scope.people === 'team'
        ? `/team/${person.id}`
        : `/people?q=${encodeURIComponent(person.name)}`,
  }));
  const projectOptions = projects.slice(0, LIMIT).map((project) => ({
    key: `project-${project.id}`,
    kind: 'project',
    title: project.name,
    subtitle: project.clientName ?? '',
    letter: String(project.name ?? '?')
      .charAt(0)
      .toUpperCase(),
    color: resolveColor(project.color, 'blue'),
    href: `/projects?q=${encodeURIComponent(project.name)}`,
  }));
  return [...personOptions, ...projectOptions];
}
