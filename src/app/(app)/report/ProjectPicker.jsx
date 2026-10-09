'use client';
// The report's project picker: a searchable list with urgent projects first (Urgent label), then
// the person's projects, then every other active project by search, then their pending project
// requests ("Waiting for approval"). "Request a project" and "Remove from report" sit below.
// Today's timer card uses it too (CONTRACT 15) with allowRequests={false}: real projects only, no
// requests and no "Request a project".
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import Tag from '@/components/Tag';
import { compactName } from '@/lib/text';
import styles from './ProjectPicker.module.css';

function matches(name, query) {
  if (!query) return true;
  const text = String(name).toLowerCase();
  return text.includes(query.toLowerCase()) || compactName(text).includes(compactName(query));
}

function optionKey(item) {
  return item.requestId ? `r${item.requestId}` : `p${item.id}`;
}

/** Sections to show for a search text. */
function buildSections(picker, query, allowRequests) {
  const q = query.trim();
  const sections = [
    { title: 'Urgent', items: picker.urgent ?? [] },
    { title: 'Your projects', items: picker.mine ?? [] },
    // Other active projects show once the person searches (or when they have none of their own).
    {
      title: 'Other projects',
      items: q || !(picker.urgent?.length || picker.mine?.length) ? (picker.others ?? []) : [],
    },
    { title: 'Waiting for approval', items: allowRequests ? (picker.requests ?? []) : [] },
  ];
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => matches(item.name, q)),
    }))
    .filter((section) => section.items.length > 0);
}

const NOTHING_USED = new Set();

/**
 * @param {{ picker: { urgent: object[], mine: object[], others: object[], requests: object[] },
 *   used?: Set<string>, current?: string | null, onPick: (pick: object) => void,
 *   onClose: (options?: { focusAnchor?: boolean }) => void, onRequestProject?: () => void,
 *   onRemove?: () => void, anchorRef: { current: HTMLElement | null }, className?: string,
 *   allowRequests?: boolean, usedLabel?: string, ariaLabel?: string }} props
 *   allowRequests: false hides pending requests and "Request a project"; usedLabel: the note on
 *   a project that can't be picked again; ariaLabel: the popup's name
 */
export default function ProjectPicker({
  picker,
  used = NOTHING_USED,
  current = null,
  onPick,
  onClose,
  onRequestProject,
  onRemove,
  anchorRef,
  className = '',
  allowRequests = true,
  usedLabel = 'In this report',
  ariaLabel = 'Pick a project',
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const listId = useId();
  const sections = useMemo(
    () => buildSections(picker, query, allowRequests),
    [picker, query, allowRequests],
  );
  const canRequest = allowRequests && Boolean(onRequestProject);
  const options = sections.flatMap((section) => section.items);
  const selectable = options.filter((item) => !used.has(optionKey(item)));
  const activeIndex = Math.min(active, Math.max(selectable.length - 1, 0));
  const activeItem = selectable[activeIndex] ?? null;
  const q = query.trim();
  const hiddenOthers =
    !q && (picker.others?.length ?? 0) > 0 && (picker.urgent?.length || picker.mine?.length);

  useEffect(() => {
    function onPointerDown(event) {
      if (rootRef.current?.contains(event.target)) return;
      if (anchorRef?.current?.contains(event.target)) return;
      onClose({ focusAnchor: false });
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [anchorRef, onClose]);

  function pick(item) {
    if (used.has(optionKey(item))) return;
    onPick(
      item.requestId
        ? { projectRequestId: item.requestId, name: item.name, color: null, isUrgent: false }
        : { projectId: item.id, name: item.name, color: item.color, isUrgent: item.isUrgent },
    );
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (selectable.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + selectable.length) % selectable.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeItem) pick(activeItem);
    }
  }

  // Escape closes the popup from anywhere in it (the search field or the footer buttons).
  function onRootKeyDown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose({ focusAnchor: true });
  }

  // Tabbing out of the popup closes it; focus stays where it went.
  function onRootBlur(event) {
    const next = event.relatedTarget;
    if (!next || rootRef.current?.contains(next) || anchorRef?.current?.contains(next)) return;
    onClose({ focusAnchor: false });
  }

  return (
    <div
      ref={rootRef}
      className={`${styles.picker} ${className}`}
      role="dialog"
      aria-label={ariaLabel}
      onKeyDown={onRootKeyDown}
      onBlur={onRootBlur}
    >
      <div className={styles.search}>
        <Search size={16} strokeWidth={1.8} aria-hidden="true" className={styles.searchIcon} />
        <input
          type="search"
          className={styles.input}
          placeholder="Find a project"
          value={query}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeItem ? `${listId}-${optionKey(activeItem)}` : undefined}
          aria-label="Find a project"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className={styles.list} id={listId} role="listbox" aria-label="Projects">
        {sections.length === 0 ? (
          <p className={styles.empty}>
            {q ? `No active project matches "${q}".` : 'No projects to pick yet.'}
          </p>
        ) : (
          sections.map((section) => (
            <div key={section.title} role="group" aria-label={section.title}>
              <p className={styles.heading} aria-hidden="true">
                {section.title}
              </p>
              {section.items.map((item) => {
                const key = optionKey(item);
                const taken = used.has(key);
                const isActive = activeItem && optionKey(activeItem) === key;
                return (
                  <div
                    key={key}
                    id={`${listId}-${key}`}
                    role="option"
                    aria-selected={key === current}
                    aria-disabled={taken || undefined}
                    className={`${styles.option} ${isActive ? styles.active : ''} ${taken ? styles.taken : ''}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => pick(item)}
                  >
                    <span
                      className={`${styles.swatch} ${styles[item.color] ?? styles.none}`}
                      aria-hidden="true"
                    />
                    <span className={styles.name}>{item.name}</span>
                    {taken ? <span className={styles.note}>{usedLabel}</span> : null}
                    {!taken && item.isUrgent ? (
                      <Tag tone="marigold" solid>
                        Urgent
                      </Tag>
                    ) : null}
                    {!taken && item.requestId ? (
                      <span className={styles.note}>Waiting for approval</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))
        )}
        {hiddenOthers ? <p className={styles.hint}>Type to find other projects.</p> : null}
      </div>
      {canRequest || onRemove ? (
        <div className={styles.footer}>
          {canRequest ? (
            <button type="button" className={styles.footerButton} onClick={onRequestProject}>
              <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
              Request a project
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              className={`${styles.footerButton} ${styles.remove}`}
              onClick={onRemove}
            >
              <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
              Remove from report
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
