'use client';
// Files dragged from the computer over a window (CONTRACT 27, Board tab "Files field"; CONTRACT 28,
// Files from the computer keep the browser's file drag): while files are over the Dialog around
// the field (else the field), the field says "Drop to attach"; a drop there goes to the uploads. A
// file dropped beside the window is swallowed, so the browser never opens it in place of Daybook.
import { useEffect, useRef, useState } from 'react';

export const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/**
 * Files dragged over the window around `rootRef` (the Dialog panel, else the field): true while
 * over it; a drop there goes to `onFiles`. A file dropped beside the window is swallowed, so the
 * browser never opens it in place of Daybook.
 */
export function useWindowDrop(rootRef, onFiles, enabled) {
  const [over, setOver] = useState(false);
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return undefined;
    const area = root.closest('[role="dialog"]') ?? root;
    const onOver = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setOver(true);
    };
    const onLeave = (event) => {
      if (!area.contains(event.relatedTarget)) setOver(false);
    };
    const onDrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(false);
      onFilesRef.current(event.dataTransfer.files);
    };
    const swallow = (event) => {
      if (hasFiles(event)) event.preventDefault();
    };
    area.addEventListener('dragenter', onOver);
    area.addEventListener('dragover', onOver);
    area.addEventListener('dragleave', onLeave);
    area.addEventListener('drop', onDrop);
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      area.removeEventListener('dragenter', onOver);
      area.removeEventListener('dragover', onOver);
      area.removeEventListener('dragleave', onLeave);
      area.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, [rootRef, enabled]);
  return over;
}
