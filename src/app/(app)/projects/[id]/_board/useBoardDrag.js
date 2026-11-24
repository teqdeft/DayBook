'use client';
// Dragging a card to another phase (CONTRACT 27, Moving a card): native HTML5 drag and drop, for
// the project's PM and Admins with a mouse or pen on a wide screen, open cards only and never while
// the card's files go up. The lifted card gets the menu shadow; the phase column under it is
// outlined and shows a dashed gap where the card will land (its sorted place). Its own column,
// Done phases, No phase yet and anywhere else take nothing. Moving from the card's menu is the way
// that works everywhere.
import { useCallback, useState, useSyncExternalStore } from 'react';
import { canDropOn, landingIndex } from './boardMoves';

const DESKTOP = '(pointer: fine) and (min-width: 641px)';
const CARD_TYPE = 'application/x-daybook-task';

function subscribe(onChange) {
  const query = window.matchMedia?.(DESKTOP);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

/** True on a desktop pointer (false while the page hydrates and on the server). */
export function useDesktopPointer() {
  return useSyncExternalStore(
    subscribe,
    () => Boolean(window.matchMedia?.(DESKTOP).matches),
    () => false,
  );
}

/**
 * A phase column's drop target: outlined with the gap where the dragged card will land while it
 * is over a column that takes it; the drop ends the drag and hands the card on.
 * @param {{ column: object, dragging: object | null, over: { key: string, gapAt: number } | null,
 *   setOver: Function, end: () => void, onDrop: Function }} input
 */
function dropTarget({ column, dragging, over, setOver, end, onDrop }) {
  const here = over?.key === column.key;
  const accepts = Boolean(dragging) && canDropOn(dragging, column.key);
  return {
    over: here,
    gapAt: here ? over.gapAt : null,
    handlers: {
      onDragOver(event) {
        if (!accepts) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const gapAt = landingIndex(column.open, dragging);
        if (!here || over.gapAt !== gapAt) setOver({ key: column.key, gapAt });
      },
      onDragLeave(event) {
        if (here && !event.currentTarget.contains(event.relatedTarget)) setOver(null);
      },
      onDrop(event) {
        if (!accepts) return;
        event.preventDefault();
        const task = dragging;
        end();
        onDrop(task, column.key);
      },
    },
  };
}

/**
 * @param {{ enabled: boolean, onDrop: (task: object, phase: string) => void }} options enabled:
 *   the viewer manages the project
 * @returns {{ dragging: object | null, cardDrag: (task: object, busy?: boolean) => object,
 *   columnDrop: (column: object) => { over: boolean, gapAt: number | null, handlers: object } }}
 *   cardDrag: the card's props (none when it can't be dragged); columnDrop: a column's
 */
export function useBoardDrag({ enabled, onDrop }) {
  const desktop = useDesktopPointer();
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null); // { key, gapAt }
  const on = enabled && desktop;

  const end = useCallback(() => {
    setDragging(null);
    setOver(null);
  }, []);

  function cardDrag(task, busy = false) {
    if (!on || task.status === 'done' || busy) return {};
    return {
      draggable: true,
      onDragStart(event) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(task.id));
        event.dataTransfer.setData(CARD_TYPE, String(task.id));
        setDragging(task);
      },
      onDragEnd: end,
    };
  }

  function columnDrop(column) {
    if (!on) return { over: false, gapAt: null, handlers: {} };
    return dropTarget({ column, dragging, over, setOver, end, onDrop });
  }

  return { dragging, cardDrag, columnDrop };
}
