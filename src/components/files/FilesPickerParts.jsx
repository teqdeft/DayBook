'use client';
// The "From project files" picker's panes (CONTRACT 28, "From project files" picker): the places at
// the left (a 200 px `<nav aria-label="Places">` of pressed buttons with counts; a "Show" select
// on a narrow window), the search and the list of the chosen place: rows of at least 64 px, each a
// `<label>` with its checkbox, a 48 px thumbnail or type tile, the name cut in the middle, "PDF ·
// 2.4 MB · Whole project", the lock line of an "Only PM and Admins" file and "Already on this
// task" or "On 1 task". The list says when it loads (three skeleton rows), fails (with Try again)
// or has nothing to show. FilesPicker.jsx holds the state; `PickerBody` puts the panes together and
// hands it the changes.
import { useId } from 'react';
import { Lock } from 'lucide-react';
import Button from '@/components/Button';
import SearchBox from '@/components/SearchBox';
import Select from '@/components/Select';
import Skeleton from '@/components/Skeleton';
import FileName from './FileName';
import FileTile from './FileTile';
import {
  LOAD_FAILED,
  LOCK_LINE,
  emptyState,
  pickerRow,
  placesOf,
  presetPlace,
  showOption,
  shownFiles,
} from './filesPickerView';
import styles from './FilesPicker.module.css';
import rowStyles from './PickerRow.module.css';

/** The places at the left: "All files 6", "Whole project 2", then the six phases (0 muted). */
function PlacesPane({ places, place, waiting, onPlace }) {
  return (
    <nav className={styles.places} aria-label="Places">
      <ul>
        {places.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className={`${styles.place} ${!waiting && item.count === 0 ? styles.zero : ''}`}
              aria-pressed={place === item.key}
              onClick={() => onPlace(item.key)}
            >
              <span className={styles.placeName}>{item.label}</span>
              <span className="num">{waiting ? '' : item.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The "Show" select that takes the pane's place on a narrow window: "All files (6)". */
function ShowSelect({ id, places, place, waiting, onPlace }) {
  const options = places.map((item) => ({
    value: item.key,
    label: waiting ? item.label : showOption(item),
  }));
  return (
    <div className={styles.show}>
      <label className={styles.showLabel} htmlFor={id}>
        Show
      </label>
      <Select
        id={id}
        options={options}
        value={place}
        onChange={(event) => onPlace(event.target.value)}
      />
    </div>
  );
}

/** The search field over the list, focused when the picker opens. */
function PickerSearch({ query, onQuery }) {
  return (
    <SearchBox
      className={styles.search}
      placeholder="Search files"
      label="Search files"
      value={query}
      onChange={(value) => onQuery(value)}
      data-autofocus=""
    />
  );
}

/** One file: its checkbox, tile, name and lines. */
function PickerRow({ file, existing, picked, onToggle }) {
  const row = pickerRow(file, existing);
  const src = file.isPicture ? file.thumbUrl : null;
  return (
    <label className={`${rowStyles.row} ${row.disabled ? rowStyles.rowOff : ''}`}>
      <span className={rowStyles.tick}>
        <input
          type="checkbox"
          checked={row.disabled || picked}
          disabled={row.disabled}
          onChange={() => onToggle(file.id)}
        />
      </span>
      <FileTile file={file} src={src} box={48} />
      <span className={rowStyles.rowText}>
        <span className={rowStyles.name} title={file.name}>
          <FileName name={file.name} />
        </span>
        <span className={rowStyles.meta}>{row.meta}</span>
        {row.locked ? (
          <span className={rowStyles.lock}>
            <Lock size={12} strokeWidth={1.8} aria-hidden="true" />
            {LOCK_LINE}
          </span>
        ) : null}
        {row.note ? <span className={rowStyles.meta}>{row.note}</span> : null}
      </span>
    </label>
  );
}

/** Three 64 px rows while the files load. */
function Loading() {
  return (
    <div className={styles.skeletons} aria-hidden="true">
      {[0, 1, 2].map((key) => (
        <Skeleton key={key} height={64} radius={8} className={styles.skeleton} />
      ))}
    </div>
  );
}

/** What the list says with no rows: the project has none (with "Open Files"), no match, none here. */
function Empty({ total, query, place, onOpenFiles }) {
  const empty = emptyState({ total, query, place });
  if (empty.kind !== 'empty') return <p className={styles.empty}>{empty.text}</p>;
  return (
    <div className={styles.empty}>
      <p>{empty.text}</p>
      {onOpenFiles ? (
        <Button variant="text" size="compact" className={styles.openFiles} onClick={onOpenFiles}>
          Open Files
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The list of the chosen place, or the line that takes its place.
 * @param {{ data: object, rows: object[], total: number, query: string, place: string,
 *   existing: number[], picked: Set<number>, onToggle: (id: number) => void,
 *   onOpenFiles?: () => void }} props data: usePickerFiles'
 */
function PickerList({ data, rows, total, query, place, existing, picked, onToggle, onOpenFiles }) {
  let body;
  if (data.state === 'loading') body = <Loading />;
  else if (data.state === 'error') {
    body = (
      <div className={styles.empty} role="alert">
        <p>{LOAD_FAILED}</p>
        <Button variant="secondary" size="small" className={styles.retry} onClick={data.reload}>
          Try again
        </Button>
      </div>
    );
  } else if (rows.length === 0) {
    body = <Empty total={total} query={query} place={place} onOpenFiles={onOpenFiles} />;
  } else {
    body = rows.map((file) => (
      <PickerRow
        key={file.id}
        file={file}
        existing={existing}
        picked={picked.has(file.id)}
        onToggle={onToggle}
      />
    ));
  }
  return (
    <div className={styles.list} role="group" aria-label="Project files">
      {body}
    </div>
  );
}

/**
 * The two panes: the places, then the search over the list of the chosen one.
 * @param {{ data: object, state: { place: string | null, query: string, picked: number[] },
 *   phase: string | null, existing: number[], onChange: (change: object) => void,
 *   onOpenFiles?: () => void }} props data: usePickerFiles'; state: the picker's; phase: the form's
 *   phase for a task not saved yet; onChange: takes what changes of the state
 */
export function PickerBody({ data, state, phase, existing, onChange, onOpenFiles }) {
  const selectId = useId();
  const places = placesOf(data.places, data.files);
  const waiting = data.state !== 'ready';
  const place = state.place ?? presetPlace(places, data.taskPhase ?? phase);
  const pane = { places, place, waiting, onPlace: (key) => onChange({ place: key }) };
  const toggle = (id) =>
    onChange({
      picked: state.picked.includes(id)
        ? state.picked.filter((one) => one !== id)
        : [...state.picked, id],
      ask: null,
    });
  return (
    <div className={styles.panes}>
      <PlacesPane {...pane} />
      <div className={styles.right}>
        <div className={styles.top}>
          <ShowSelect id={selectId} {...pane} />
          <PickerSearch query={state.query} onQuery={(query) => onChange({ query })} />
        </div>
        <PickerList
          data={data}
          rows={waiting ? [] : shownFiles(data.files, { place, query: state.query })}
          total={data.files.length}
          query={state.query}
          place={place}
          existing={existing}
          picked={new Set(state.picked)}
          onToggle={toggle}
          onOpenFiles={onOpenFiles}
        />
      </div>
    </div>
  );
}
