'use client';
// Dropping files on a card (CONTRACT 27, Dropping files on a card), for the project's PM and Admins
// on a desktop pointer: while files are dragged over a card it shows "Drop to attach"; the drop
// hands them to the attach store (TaskAttachProvider), which uploads them, attaches them to the
// task and tells the person. Files dropped anywhere else on the project page, on every tab, are
// swallowed by FileDropGuard (ProjectView), so the browser never opens a file in place of Daybook.
import { useEffect, useState } from 'react';
import { useDesktopPointer } from './useBoardDrag';

const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');

/**
 * @param {{ enabled: boolean, onFiles: (task: object, files: FileList) => void }} options
 *   enabled: the viewer manages the project and the attach store is there
 * @returns {(task: object) => { over: boolean, handlers: object } | null} a card's drop props
 */
export function useCardFileDrop({ enabled, onFiles }) {
  const desktop = useDesktopPointer();
  const [overId, setOverId] = useState(null);
  const on = enabled && desktop;

  useEffect(() => {
    if (!on) return undefined;
    const clear = () => setOverId(null);
    window.addEventListener('drop', clear);
    window.addEventListener('dragend', clear);
    return () => {
      window.removeEventListener('drop', clear);
      window.removeEventListener('dragend', clear);
    };
  }, [on]);

  return function cardFileDrop(task) {
    if (!on) return null;
    return {
      over: overId === task.id,
      handlers: {
        onDragOver(event) {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          if (overId !== task.id) setOverId(task.id);
        },
        onDragLeave(event) {
          if (overId === task.id && !event.currentTarget.contains(event.relatedTarget)) {
            setOverId(null);
          }
        },
        onDrop(event) {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.stopPropagation();
          setOverId(null);
          onFiles(task, event.dataTransfer.files);
        },
      },
    };
  };
}
