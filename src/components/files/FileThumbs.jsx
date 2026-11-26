'use client';
// A task's pictures as thumbnails (CONTRACT 27, Task window; CONTRACT 28): 120 x 90, the small JPEG
// the uploader's browser made (`thumbUrl`), else the picture tile; the name (12 px, cut in the
// middle) and the size under each (" · From Files: Design" for a linked project file); a click
// opens the picture viewer. Managers on a project page get an X on each ("Remove brief.png"; a
// linked one "Remove homepage.png from this task"). Only real pictures come here (`picturesOf`): a PNG, JPEG, GIF or
// WebP whose first bytes matched (`isPicture`), never an SVG.
import { useState } from 'react';
import { FileImage, X } from 'lucide-react';
import { formatSize } from '@/modules/projectFiles/kinds';
import FileName from './FileName';
import { fromFiles, removeLabel } from './FileRows';
import styles from './Files.module.css';

/**
 * The files the picture viewer shows, and the others (rows with Download).
 * @param {object[]} files ProjectFiles
 * @returns {{ pictures: object[], others: object[] }}
 */
export function picturesOf(files) {
  const pictures = [];
  const others = [];
  for (const file of files ?? []) {
    if (file.isPicture && file.viewUrl) pictures.push(file);
    else others.push(file);
  }
  return { pictures, others };
}

function Thumb({ file, index, onOpen, onRemove }) {
  const [broken, setBroken] = useState(false);
  return (
    <li className={styles.thumb}>
      <button
        type="button"
        className={styles.thumbButton}
        aria-label={`Open ${file.name}`}
        onClick={() => onOpen(file, index)}
      >
        {file.thumbUrl && !broken ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a signed-in file route, not a static image */
          <img
            src={file.thumbUrl}
            alt=""
            width={120}
            height={90}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
          />
        ) : (
          <FileImage size={24} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
      <span className={styles.thumbName} title={file.name}>
        <FileName name={file.name} />
      </span>
      <span className={styles.thumbSize}>
        {formatSize(file.sizeBytes)}
        {fromFiles(file)}
      </span>
      {onRemove ? (
        <button
          type="button"
          className={`${styles.iconButton} ${styles.thumbX}`}
          aria-label={removeLabel(file)}
          title={removeLabel(file)}
          onClick={(event) => onRemove(file, event)}
        >
          <X size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

/**
 * @param {{ files: object[], onOpen: (file: object, index: number) => void,
 *   onRemove?: (file: object) => void }} props files: ProjectFiles with `isPicture`; onRemove:
 *   the X, managers on a project page only
 */
export default function FileThumbs({ files, onOpen, onRemove }) {
  if (!files?.length) return null;
  return (
    <ul className={styles.thumbs}>
      {files.map((file, index) => (
        <Thumb
          key={`${file.linked ? 'link' : 'file'}-${file.id}`}
          file={file}
          index={index}
          onOpen={onOpen}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}
