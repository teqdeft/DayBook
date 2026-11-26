'use client';
// The pointer drag and the keyboard move of a card (CONTRACT 28, Motion, Pointer drag; Keyboard
// move and the live region), wired to React: one controller on the board element (it never
// remounts), the latest props read at every event, and `relayout()` for the Board's every-commit
// layout effect (a refresh while a card is held). Nothing here renders differently on the client:
// the grip's props are the same on the server, and the device rules are read when a press comes.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createDragController } from './dragController';
import { useDesktopPointer } from './useDesktopPointer';
import styles from './BoardDrag.module.css';

const SERVER_GRIP = (task) => ({
  'data-grip': '',
  'aria-describedby': 'move-help',
  className: styles.grip,
  onKeyDown: undefined,
  onClick: undefined,
  task,
});

/**
 * @param {{ boardRef: import('react').RefObject<HTMLElement>, enabled: boolean,
 *   findTask: (id: number) => object | null, columnsOf: () => object[],
 *   onDrop: (task: object, toKey: string, how: { mode: 'pointer' | 'keyboard' }) => void,
 *   say?: (text: string) => void, askMove?: (task: object) => void,
 *   isBusy?: (task: object) => boolean }} options enabled: the viewer manages the project and
 *   the Board view shows; askMove: the grip's click opens "Move to phase…"; isBusy: the card's
 *   files are going up
 * @returns {{ relayout: () => void, destroy: () => void,
 *   gripProps: (task: object) => Record<string, unknown> }} gripProps: the grip's onKeyDown,
 *   onClick, data-grip, aria-describedby and className (merge it with the grip's own)
 */
export function usePointerDrag(options = {}) {
  const desktop = useDesktopPointer();
  const latest = useRef(null);
  const controller = useRef(null);

  useLayoutEffect(() => {
    latest.current = { ...options, enabled: Boolean(options.enabled) && desktop };
  });

  // The board element can come later (the Table first): a new element gets a new controller.
  useEffect(() => {
    const board = options.boardRef?.current ?? null;
    if (controller.current?.board === board) return;
    controller.current?.destroy();
    controller.current = board
      ? createDragController({ board, context: () => latest.current, env: { classes: styles } })
      : null;
  });

  useEffect(
    () => () => {
      controller.current?.destroy();
      controller.current = null;
    },
    [],
  );

  return useMemo(
    () => ({
      relayout: () => controller.current?.relayout(),
      destroy: () => controller.current?.destroy(),
      gripProps(task) {
        const props = SERVER_GRIP(task);
        delete props.task;
        props.onKeyDown = (event) => controller.current?.gripProps(task).onKeyDown(event);
        props.onClick = (event) => controller.current?.gripProps(task).onClick(event);
        return props;
      },
    }),
    [],
  );
}
