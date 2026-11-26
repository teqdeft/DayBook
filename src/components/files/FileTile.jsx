'use client';
// The type tile of a file (CONTRACT 27, Files tab rows, the task window, chips; CONTRACT 28, File
// tiles get colours by type everywhere): an icon by `kindOf` on its kind's soft colour (PDF red,
// Word blue, spreadsheets green, zip marigold, a picture without a thumbnail violet, others
// neutral). 36 px by default, 24 px in card chips, 48 px in the picker (FileText for PDF, Word and
// text, FileSpreadsheet, Presentation, FileArchive, FileVideo, FileAudio, FileCode, FileImage,
// File for programs and anything else). With `src` it shows that picture instead (a thumbnail or a
// chip's local preview) and falls back to the icon when it can't load; `error` draws the Error
// chip's alert; `link` draws the Link icon of a project file linked to a task, in its kind's
// colour.
import { createElement, useState } from 'react';
import {
  CircleAlert,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Link as LinkIcon,
  Presentation,
} from 'lucide-react';
import { kindOf } from '@/modules/projectFiles/kinds';
import { extOf } from '@/modules/projectFiles/names';
import styles from './FileTile.module.css';

const ICONS = {
  picture: FileImage,
  program: File,
  pdf: FileText,
  word: FileText,
  excel: FileSpreadsheet,
  slides: Presentation,
  text: FileText,
  archive: FileArchive,
  video: FileVideo,
  audio: FileAudio,
  code: FileCode,
  file: File,
};

/** The colour class of each kind with one; every other kind is neutral. */
const TONES = {
  pdf: styles.tonePdf,
  word: styles.toneWord,
  excel: styles.toneSheet,
  archive: styles.toneZip,
  picture: styles.tonePicture,
};

const BOXES = { 24: styles.tile24, 36: '', 48: styles.tile48 };

/** A file's kind by its extension (or its name). */
const kindOfFile = (file) => kindOf(file?.ext ?? extOf(file?.name));

/**
 * The icon component of a file by its extension.
 * @param {{ name?: string, ext?: string }} file
 */
export function iconFor(file) {
  return ICONS[kindOfFile(file)] ?? File;
}

/** The tile's colour class for a file: its kind's, or none (neutral). */
export const toneOf = (file) => TONES[kindOfFile(file)] ?? '';

/** The icon of a file, drawn at `size` (lucide, strokeWidth 1.8). */
export function KindIcon({ file, size = 18 }) {
  return createElement(iconFor(file), { size, strokeWidth: 1.8, 'aria-hidden': 'true' });
}

/**
 * @param {{ file: { name?: string, ext?: string }, src?: string | null, error?: boolean,
 *   link?: boolean, size?: number, box?: 24 | 36 | 48 }} props src: a picture to show
 *   (thumbnail or local preview); link: a linked project file's Link icon; size: the icon;
 *   box: the tile (36 px by default)
 */
export default function FileTile({
  file,
  src = null,
  error = false,
  link = false,
  size,
  box = 36,
}) {
  const [broken, setBroken] = useState(null);
  const boxClass = BOXES[box] ?? '';
  const iconSize = size ?? (box === 24 ? 14 : 18);
  if (error) {
    return (
      <span className={`${styles.tile} ${boxClass} ${styles.tileBad}`} aria-hidden="true">
        <CircleAlert size={iconSize} strokeWidth={1.8} />
      </span>
    );
  }
  if (src && !link && broken !== src) {
    return (
      <span className={`${styles.tile} ${boxClass}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed-in file route or a local preview, not a static image */}
        <img
          src={src}
          alt=""
          width={box}
          height={box}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(src)}
        />
      </span>
    );
  }
  return (
    <span className={`${styles.tile} ${boxClass} ${toneOf(file)}`} aria-hidden="true">
      {link ? (
        <LinkIcon size={iconSize} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <KindIcon file={file} size={iconSize} />
      )}
    </span>
  );
}
