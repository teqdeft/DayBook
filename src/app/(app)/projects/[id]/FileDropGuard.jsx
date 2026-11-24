'use client';
// Files dropped where nothing takes them on the project page (CONTRACT 27, Dropping files on a
// card): for the project's PM and Admins, on every tab, `dragover` and `drop` call preventDefault
// for files, so the browser never opens a dropped file in place of Daybook (and a running upload's
// leave guard never has to ask). The real drop targets (a card, the Files list, an upload field)
// take their own drops first; this only stops the browser's own handling everywhere else.
import { useEffect } from 'react';

const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');

/**
 * Swallows file drags and drops on a target (the window).
 * @param {EventTarget} target
 * @returns {() => void} takes the listeners away again
 */
export function guardFileDrops(target) {
  const swallow = (event) => {
    if (hasFiles(event)) event.preventDefault();
  };
  target.addEventListener('dragover', swallow);
  target.addEventListener('drop', swallow);
  return () => {
    target.removeEventListener('dragover', swallow);
    target.removeEventListener('drop', swallow);
  };
}

/** Mounted once around the manager's project page (ProjectView); draws nothing. */
export default function FileDropGuard() {
  useEffect(() => guardFileDrops(window), []);
  return null;
}
