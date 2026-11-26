'use client';
// One file on its way in, or one already on the task in the Edit window (CONTRACT 27, Upload
// states; CONTRACT 28: the bar fills by scaleX): a 36 px tile (a local preview only for a real PNG, JPEG, GIF or WebP, never SVG; the
// type tile otherwise; an alert on an Error chip), the name cut in the middle, the state line with
// a 3 px progress bar while it uploads, Retry on a Paused chip, and the X ("Remove brief.pdf",
// "Cancel uploading brief.pdf"; on an attached file it marks it "Removed when you save" and turns
// into "Keep brief.pdf"). An Error or Paused chip spans the row. `UploadChips` lists them and moves
// focus after a chip goes: to the next chip's X, else to `focusFallback` (Choose files), also when
// the last chip takes the whole list with it; after a Retry, to that chip's X.
import { useEffect, useRef } from 'react';
import { Undo2, X } from 'lucide-react';
import FileName from './FileName';
import FileTile from './FileTile';
import { RUNNING, stateLine } from './uploadItems';
import styles from './Files.module.css';
import upload from './UploadChip.module.css';

/**
 * Focus the Retry of one chip (a paused chip that blocks the task form's Save), found by the item's
 * id, so two files of one name never mix.
 * @param {string} itemId
 * @param {ParentNode | null} [within] the uploader's box (the page when left out)
 */
export function focusChipRetry(itemId, within) {
  const selector = `[data-chip-retry="${CSS.escape(String(itemId))}"]`;
  (within ?? document).querySelector(selector)?.focus();
}

function ProgressLine({ item }) {
  return (
    <span
      className={upload.bar}
      role="progressbar"
      aria-label={`Uploading ${item.name}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={item.percent}
    >
      <span
        className={upload.barFill}
        style={{ '--fill': Math.min(100, Math.max(0, item.percent ?? 0)) / 100 }}
      />
    </span>
  );
}

function ChipButton({ item, removed, onRemove, onToggleRemove }) {
  if (item.state === 'attached') {
    if (!onToggleRemove) return null;
    const Icon = removed ? Undo2 : X;
    return (
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`${removed ? 'Keep' : 'Remove'} ${item.name}`}
        title={`${removed ? 'Keep' : 'Remove'} ${item.name}`}
        data-chip-x={item.id}
        onClick={() => onToggleRemove(item.fileId)}
      >
        <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
    );
  }
  if (!onRemove || item.state === 'reading') return null;
  const label = `${RUNNING.includes(item.state) ? 'Cancel uploading' : 'Remove'} ${item.name}`;
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={label}
      title={label}
      data-chip-x={item.id}
      onClick={() => onRemove(item.id)}
    >
      <X size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/**
 * @param {{ item: object, onRemove?: (id: string) => void, onRetry?: (id: string) => void,
 *   removed?: boolean, onToggleRemove?: (fileId: number) => void }} props item: one of
 *   useUploads' `items` (or a task batch's), or an attached file `{ id, fileId, name, size,
 *   state: 'attached', thumbUrl }`; removed: an attached file marked "Removed when you save"
 */
export default function UploadChip({ item, onRemove, onRetry, removed = false, onToggleRemove }) {
  const bad = item.state === 'error';
  const wide = bad || item.state === 'paused';
  const moving = item.state === 'uploading' || item.state === 'retrying';
  const retry = onRetry && (item.state === 'paused' || (bad && item.canRetry));
  const src = item.state === 'attached' ? item.thumbUrl : item.previewUrl;
  const classes = [
    styles.chip,
    wide ? styles.chipWide : null,
    bad ? styles.chipBad : null,
    removed ? styles.chipOff : null,
  ];
  return (
    <li className={classes.filter(Boolean).join(' ')} data-chip={item.id}>
      <FileTile file={item} src={src} error={bad} />
      <span className={styles.chipText}>
        <span className={styles.chipName} title={item.name}>
          <FileName name={item.name} />
        </span>
        <span
          className={`${styles.meta} ${bad ? styles.metaError : ''}`}
          role={bad ? 'alert' : undefined}
        >
          {stateLine(item, { removed })}
          {item.state === 'uploading' ? (
            <>
              {' '}
              <span className={upload.percent}>{item.percent}%</span>
            </>
          ) : null}
        </span>
        {moving ? <ProgressLine item={item} /> : null}
      </span>
      {retry ? (
        <button
          type="button"
          className={styles.retry}
          data-chip-retry={item.id}
          onClick={() => onRetry(item.id)}
        >
          Retry<span className="visually-hidden"> {item.name}</span>
        </button>
      ) : null}
      <ChipButton
        item={item}
        removed={removed}
        onRemove={onRemove}
        onToggleRemove={onToggleRemove}
      />
    </li>
  );
}

/**
 * The chips of one uploader, two a line (one with `one`, and on a phone).
 * @param {{ items: object[], onRemove?: (id: string) => void, onRetry?: (id: string) => void,
 *   removedIds?: number[], onToggleRemove?: (fileId: number) => void, one?: boolean,
 *   focusFallback?: () => void, label?: string, labelledBy?: string,
 *   after?: import('react').ReactNode }} props focusFallback: where focus goes when the last chip
 *   goes (Choose files); after: more chips drawn last in the same list (the task form's linked
 *   project files, LinkChip)
 */
export function UploadChips({
  items,
  onRemove,
  onRetry,
  removedIds = [],
  onToggleRemove,
  one = false,
  focusFallback,
  labelledBy,
  after = null,
}) {
  const listRef = useRef(null);
  const pending = useRef(null);
  const fallback = useRef(focusFallback);

  useEffect(() => {
    fallback.current = focusFallback;
  }, [focusFallback]);

  useEffect(() => {
    const wanted = pending.current;
    if (!wanted || items.some((item) => item.id === wanted.gone)) return;
    pending.current = null;
    const next = wanted.next
      ? listRef.current?.querySelector(`[data-chip-x="${CSS.escape(wanted.next)}"]`)
      : null;
    if (next) next.focus();
    else focusFallback?.();
  }, [items, focusFallback]);

  // When the last chip goes, the Uploads card and the task window drop the whole list in the same
  // render, so the effect above never runs: focus moves to the fallback on the way out instead of
  // falling to <body> (out of the task window's dialog).
  useEffect(() => {
    const removing = pending;
    const moveTo = fallback;
    return () => {
      if (!removing.current) return;
      removing.current = null;
      requestAnimationFrame(() => moveTo.current?.());
    };
  }, []);

  function remove(id) {
    const at = items.findIndex((item) => item.id === id);
    const neighbour = items[at + 1] ?? items[at - 1] ?? null;
    pending.current = { gone: id, next: neighbour?.id ?? null };
    onRemove?.(id);
  }

  // Retry takes its button away (and a failed row moves to the running ones in the Uploads card),
  // so focus goes to that chip's X wherever it is drawn now.
  function retry(id) {
    onRetry?.(id);
    requestAnimationFrame(() => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost) document.querySelector(`[data-chip-x="${CSS.escape(String(id))}"]`)?.focus();
    });
  }

  return (
    <ul
      ref={listRef}
      className={`${styles.chips} ${one ? styles.chipsOne : ''}`}
      aria-labelledby={labelledBy}
    >
      {items.map((item) => (
        <UploadChip
          key={item.id}
          item={item}
          onRemove={onRemove ? remove : undefined}
          onRetry={onRetry ? retry : undefined}
          removed={item.state === 'attached' && removedIds.includes(item.fileId)}
          onToggleRemove={onToggleRemove}
        />
      ))}
      {after}
    </ul>
  );
}
