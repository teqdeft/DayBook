'use client';
// One project file linked to the task in the New task and Edit task window (CONTRACT 28, New task
// and Edit task, Files): a 36 px tile with the Link icon in its kind's colour, the name (cut in
// the middle), "From Files · Word · 340 KB" and a 12 px Lock for an "Only PM and Admins" file, and
// an X "Remove checkout-flow.docx from this task". On New the X takes the chip away at once; on
// Edit it marks it "Removed when you save", struck through, with Undo2 "Keep checkout-flow.docx".
// A file deleted in Files before the save reads "No longer in Files", struck through, with no X
// (the next save leaves it out). Drawn in the same list as the upload chips (UploadChips' `after`).
import { Lock, Undo2, X } from 'lucide-react';
import { formatSize, typeLabel } from '@/modules/projectFiles/kinds';
import FileName from './FileName';
import FileTile from './FileTile';
import styles from './Files.module.css';
import linkStyles from './LinkChip.module.css';

export const GONE_TEXT = 'No longer in Files';
export const REMOVED_TEXT = 'Removed when you save';
export const LOCK_TEXT = 'Only PM and Admins';

/** "From Files · Word · 340 KB" (" · Removed when you save" once marked), or "No longer in Files". */
export function linkMeta(file, { removed = false, gone = false } = {}) {
  if (gone) return GONE_TEXT;
  const type = file.typeLabel ?? typeLabel(file.ext);
  return `From Files · ${type} · ${formatSize(file.sizeBytes)}${removed ? ` · ${REMOVED_TEXT}` : ''}`;
}

/** The X's (or Undo2's) words: "Remove checkout-flow.docx from this task", "Keep …". */
export const linkButtonLabel = (file, removed) =>
  removed ? `Keep ${file.name}` : `Remove ${file.name} from this task`;

/**
 * @param {{ file: { id: number, name: string, ext?: string, typeLabel?: string,
 *   sizeBytes: number, visibility?: string }, removed?: boolean, gone?: boolean,
 *   onRemove?: (file: object) => void, onKeep?: (file: object) => void }} props removed: marked
 *   "Removed when you save" (Edit); gone: deleted in Files before the save
 */
export default function LinkChip({ file, removed = false, gone = false, onRemove, onKeep }) {
  const off = removed || gone;
  const locked = !gone && file.visibility === 'managers';
  const label = linkButtonLabel(file, removed);
  const Icon = removed ? Undo2 : X;
  const press = removed ? onKeep : onRemove;
  return (
    <li
      className={`${styles.chip} ${linkStyles.link} ${off ? styles.chipOff : ''}`}
      data-chip={`link-${file.id}`}
    >
      <FileTile file={file} link size={16} />
      <span className={styles.chipText}>
        <span className={styles.chipName} title={file.name}>
          <FileName name={file.name} />
        </span>
        <span className={`${styles.meta} ${linkStyles.meta}`}>
          {linkMeta(file, { removed, gone })}
          {locked ? (
            <span className={linkStyles.lock} title={LOCK_TEXT}>
              <Lock size={12} strokeWidth={1.8} aria-hidden="true" />
              <span className="visually-hidden"> · {LOCK_TEXT}</span>
            </span>
          ) : null}
        </span>
      </span>
      {gone || !press ? null : (
        <button
          type="button"
          className={styles.iconButton}
          aria-label={label}
          title={label}
          data-chip-x={`link-${file.id}`}
          onClick={() => press(file)}
        >
          <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}
