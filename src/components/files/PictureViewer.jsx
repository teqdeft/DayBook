'use client';
// The picture viewer (CONTRACT 27, Picture viewer): a full-window dialog over --photo-veil (the
// same dark veil in both themes, as a photo viewer), labelled by the file name. Top bar: the name,
// "1.2 MB · 1 of 2", Download (a plain link) and Close (44 px, white on the veil); focus goes to
// Close when it opens. The picture (`/view`) centred; "Previous picture" and "Next picture" when
// there are more, Left and Right arrows too. A picture that can't load (a missing disk file) shows
// "This file is missing. Ask your PM to add it again." with Download still there. Escape closes
// the viewer first (it is the top-most modal) and focus returns to the thumbnail that opened it.
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useIsClient, useModal } from '@/components/useModal';
import { formatSize } from '@/modules/projectFiles/kinds';
import { fileMissing } from '@/modules/projectFiles/fileMessages';
import styles from './PictureViewer.module.css';

/**
 * @param {{ files: object[], index: number, onIndex: (index: number) => void,
 *   onClose: () => void }} props files: the pictures (ProjectFiles with `viewUrl`); index: the
 *   one shown
 */
export default function PictureViewer({ files, index, onIndex, onClose }) {
  const isClient = useIsClient();
  const panelRef = useRef(null);
  const [missing, setMissing] = useState(() => new Set());
  const count = files?.length ?? 0;
  const at = count ? Math.min(Math.max(index, 0), count - 1) : 0;
  const file = count ? files[at] : null;
  useModal({ open: isClient && Boolean(file), onClose, panelRef });

  if (!isClient || !file) return null;
  const many = count > 1;
  const step = (by) => onIndex((at + by + count) % count);

  function onKeyDown(event) {
    if (!many || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  }

  return createPortal(
    <div
      ref={panelRef}
      className={styles.viewer}
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className={styles.viewerTop}>
        <div className={styles.viewerTitle}>
          <span className={styles.viewerName}>{file.name}</span>
          <span className={styles.viewerMeta}>
            <span className={styles.viewerSize}>{formatSize(file.sizeBytes)}</span>
            {many ? ` · ${at + 1} of ${count}` : ''}
          </span>
        </div>
        {/* On a phone the words go (only the icons show), so both keep their names in aria-label. */}
        <a
          className={styles.viewerButton}
          href={file.downloadUrl}
          aria-label={`Download ${file.name}`}
        >
          <Download size={18} strokeWidth={1.8} aria-hidden="true" />
          <span className={styles.viewerWord}>Download</span>
        </a>
        <button
          type="button"
          className={styles.viewerButton}
          onClick={onClose}
          aria-label="Close"
          data-autofocus
        >
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
          <span className={styles.viewerWord}>Close</span>
        </button>
      </div>
      <div className={styles.viewerMiddle} data-modal-body>
        {missing.has(file.id) ? (
          <p className={styles.viewerMissing}>{fileMissing()}</p>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- a signed-in file route, not a static image */
          <img
            key={file.id}
            src={file.viewUrl}
            alt={file.name}
            decoding="async"
            onError={() => setMissing((set) => new Set(set).add(file.id))}
          />
        )}
        {many ? (
          <>
            <button
              type="button"
              className={`${styles.viewerButton} ${styles.viewerNav} ${styles.viewerPrev}`}
              aria-label="Previous picture"
              onClick={() => step(-1)}
            >
              <ChevronLeft size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`${styles.viewerButton} ${styles.viewerNav} ${styles.viewerNext}`}
              aria-label="Next picture"
              onClick={() => step(1)}
            >
              <ChevronRight size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
