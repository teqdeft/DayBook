'use client';
// One row of the Files tab (CONTRACT 27, Files tab, Rows), at least 64 px: the thumbnail (44 x 44)
// or the type tile (no colour per type), the name cut in the middle so its end shows, the muted
// line ("PDF · 2.4 MB · Riya Kapoor, 21 Nov", the place in All files, "On task: Fix the login page"
// as a button that opens the task window), a third line with the lock for "Only PM and Admins" and
// the program warning, then Download and, for managers, "⋯". A picture's name opens the viewer,
// another file's name downloads it (a plain link: the browser writes it to disk), a note or a
// text-only document opens the note window.
import { useState } from 'react';
import { Download, FileText, Lock, StickyNote } from 'lucide-react';
import FileName from '@/components/files/FileName';
import FileTile from '@/components/files/FileTile';
import FileRowMenu from './FileRowMenu';
import { MANAGERS_LINE, PROGRAM_LINE, rowMeta, rowNotes, rowOpens } from './filesTabView';
import styles from './FileListRow.module.css';

/** The id of a row's name, where focus goes after a delete or a window. */
export const rowNameId = (item) => `files-row-${item.key.replace(':', '-')}`;

function TypeTile({ item }) {
  if (item.file) {
    return (
      <span className={styles.tileBox}>
        <FileTile file={item.file} />
      </span>
    );
  }
  return (
    <span className={styles.tile} aria-hidden="true">
      {item.type === 'text' ? (
        <FileText size={18} strokeWidth={1.8} />
      ) : (
        <StickyNote size={18} strokeWidth={1.8} />
      )}
    </span>
  );
}

/** The thumbnail, or the type tile when there is none or it can't load (a missing disk file). */
function RowTile({ item }) {
  const [broken, setBroken] = useState(false);
  const src = item.file?.thumbUrl;
  if (!src || broken) return <TypeTile item={item} />;
  return (
    <span className={styles.thumb} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed-in file route, not a static image */}
      <img
        src={src}
        alt=""
        width={44}
        height={44}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    </span>
  );
}

/**
 * The name: a picture's or a note's opens a window, another file's is a plain download link. Its
 * label is the whole name, since the shown one is cut in the middle in two parts.
 */
function RowName({ item, onOpen }) {
  const opens = rowOpens(item);
  const name = <FileName name={item.name} />;
  if (opens === 'download') {
    return (
      <a
        id={rowNameId(item)}
        href={item.file.downloadUrl}
        className={styles.name}
        title={item.name}
        aria-label={item.name}
      >
        {name}
      </a>
    );
  }
  return (
    <button
      id={rowNameId(item)}
      type="button"
      className={styles.name}
      title={item.name}
      aria-label={item.name}
      onClick={(event) => onOpen(item, event)}
    >
      {name}
    </button>
  );
}

function RowNotes({ item }) {
  const { managers, program } = rowNotes(item);
  if (!managers && !program) return null;
  return (
    <p className={styles.notes}>
      {managers ? (
        <span>
          <Lock size={14} strokeWidth={1.8} aria-hidden="true" />
          {MANAGERS_LINE}
        </span>
      ) : null}
      {program ? <span>{PROGRAM_LINE}</span> : null}
    </p>
  );
}

/**
 * @param {{ item: object, place: string, canManage: boolean,
 *   onOpen: (item: object, event: import('react').MouseEvent) => void,
 *   onOpenTask: (taskId: number) => void,
 *   onAction: (action: string, item: object, event?: import('react').MouseEvent) => void }}
 *   props item: a filesItems item; onOpen: a picture's or a note's name; onAction: the row menu's
 *   choices (managers), with the menu item's click
 */
export default function FileListRow({ item, place, canManage, onOpen, onOpenTask, onAction }) {
  const meta = rowMeta(item, place);
  return (
    <li className={styles.row}>
      <RowTile item={item} />
      <div className={styles.rowText}>
        <RowName item={item} onOpen={onOpen} />
        <p className={styles.meta}>
          {meta.text}
          {meta.task ? (
            <>
              {' · On task: '}
              <button
                type="button"
                className={styles.link}
                onClick={() => onOpenTask(meta.task.id)}
              >
                {meta.task.title}
              </button>
            </>
          ) : null}
        </p>
        <RowNotes item={item} />
      </div>
      <div className={styles.rowActions}>
        {item.file ? (
          <a
            href={item.file.downloadUrl}
            className={styles.iconLink}
            aria-label={`Download ${item.name}`}
            title={`Download ${item.name}`}
          >
            <Download size={18} strokeWidth={1.8} aria-hidden="true" />
          </a>
        ) : null}
        {canManage ? <FileRowMenu item={item} onAction={onAction} /> : null}
      </div>
    </li>
  );
}
