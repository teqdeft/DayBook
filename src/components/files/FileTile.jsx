'use client';
// The 36 px type tile of a file (CONTRACT 27, Files tab rows, the task window, chips): an icon by
// `kindOf` on --track, no colour per type (FileText for PDF, Word and text, FileSpreadsheet,
// Presentation, FileArchive, FileVideo, FileAudio, FileCode, FileImage, File for programs and
// anything else). With `src` it shows that picture instead (a thumbnail or a chip's local
// preview) and falls back to the icon when it can't load; `error` draws the Error chip's alert.
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
  Presentation,
} from 'lucide-react';
import { kindOf } from '@/modules/projectFiles/kinds';
import { extOf } from '@/modules/projectFiles/names';
import styles from './Files.module.css';

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

/**
 * The icon component of a file by its extension.
 * @param {{ name?: string, ext?: string }} file
 */
export function iconFor(file) {
  const ext = file?.ext ?? extOf(file?.name);
  return ICONS[kindOf(ext)] ?? File;
}

/** The icon of a file, drawn at `size` (lucide, strokeWidth 1.8). */
export function KindIcon({ file, size = 18 }) {
  return createElement(iconFor(file), { size, strokeWidth: 1.8, 'aria-hidden': 'true' });
}

/**
 * @param {{ file: { name?: string, ext?: string }, src?: string | null, error?: boolean,
 *   size?: number }} props src: a picture to show (thumbnail or local preview); size: the icon
 */
export default function FileTile({ file, src = null, error = false, size = 18 }) {
  const [broken, setBroken] = useState(null);
  if (error) {
    return (
      <span className={`${styles.tile} ${styles.tileBad}`} aria-hidden="true">
        <CircleAlert size={size} strokeWidth={1.8} />
      </span>
    );
  }
  if (src && broken !== src) {
    return (
      <span className={styles.tile} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed-in file route or a local preview, not a static image */}
        <img
          src={src}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(src)}
        />
      </span>
    );
  }
  return (
    <span className={styles.tile} aria-hidden="true">
      <KindIcon file={file} size={size} />
    </span>
  );
}
