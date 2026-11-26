'use client';
// What the Board's parts do to cards and columns (CONTRACT 27 and 28, Board tab): move a card (a
// drag commits at once; a move from a menu, the task window or Undo glides the card to its new
// column), delete one with Undo, open the task window from a card, open a done phase as a column
// or put it back in the rail, open or fold the rail, and follow a band part to its column (or its
// Table group, or the phone's step). Each says where focus goes afterwards.
import { columnOf } from './bandView';
import { glideMove } from './boardMotion';
import { nextCardAfter } from './boardMoves';
import {
  RAIL_BUTTON_ID,
  addTaskId,
  cardId,
  cardTitleId,
  foldButtonId,
  tileButtonId,
} from './boardView';
import { isPhone } from './useBoardParts';
import { allShownIn, shownIn } from './table/tableDom';

const menuOf = (taskId) =>
  document.getElementById(cardId(taskId))?.querySelector('[aria-haspopup="menu"]') ?? null;

/**
 * Moving and deleting a card, with focus after each: a pointer drag keeps it on the card's title
 * and a keyboard move on the card's grip (the drag's own; both drops commit at once, inside the
 * drag's flushSync); a move from a menu or the task window glides
 * the card to its new column, then focus goes to the card's "⋯" there (on a phone, to the next card
 * left behind, or "+ Add task"); a move that fails puts the card back, drawn again in its old
 * column, and focus with it (its "⋯" after a menu on a desktop, else its title); a delete with the
 * pointer moves focus to the next card, or "+ Add task"; a delete from the keyboard to the toast's
 * Undo, and from there back to the card (Undo) or the next one.
 * @param {{ columns: object[], moves: { move: Function }, editor: object | null,
 *   after: Function, keyboard: () => boolean, scroll: { show: Function },
 *   root?: () => Element | null }} deps root: the board's box, the glide's scope
 */
export function cardActions({ columns, moves, editor, after, keyboard, scroll, root }) {
  const columnFor = (task) => columns.find((column) => column.key === columnOf(task));
  const nextFocus = (task) => {
    const column = columnFor(task);
    const next = nextCardAfter(column?.open ?? [], task.id);
    return next ? cardTitleId(next) : addTaskId(column?.key);
  };
  // A move from a menu: focus to the card's "⋯" in its new column (on a phone, the next card).
  const afterMenuMove = (task, to) => {
    if (isPhone()) after(nextFocus(task));
    else
      after(
        () => menuOf(task.id),
        () => scroll.show(to),
      );
  };
  return {
    async move(task, to, how) {
      let sent = null;
      const change = () => {
        sent = moves.move(task, to);
      };
      const dropped = how === 'drag' || how === 'keyboard';
      if (dropped) change();
      else await glideMove(root?.() ?? null, task.id, change, { scroll, to });
      // After a keyboard drop the drag focuses the moved card's grip itself.
      if (how === 'drag') after(cardTitleId(task.id));
      else if (how !== 'keyboard') afterMenuMove(task, to);
      const moved = await sent;
      if (!moved) {
        after(!dropped && !isPhone() ? () => menuOf(task.id) : cardTitleId(task.id));
      }
      return moved;
    },
    deleteTask(task) {
      const focus = nextFocus(task);
      const fromKeyboard = keyboard();
      editor?.remove(task, {
        keyboard: fromKeyboard,
        // After Undo the card is back; after Tab or Escape it is gone, so the next card instead.
        returnFocus: () =>
          document.getElementById(cardTitleId(task.id)) ?? document.getElementById(focus),
      });
      // From the keyboard the Undo toast takes focus (UndoToast), so Enter undoes the delete.
      if (!fromKeyboard) after(focus);
    },
  };
}

/**
 * Opens the task window from a card: the card's title shows at once while the task loads, focus
 * comes back to what opened it on close (the title for a click on the card itself, which can't
 * take focus), and, when the card was drawn again meanwhile (marked done in the window, it moves
 * to "› 6 done"), to its title there or that fold's button, or its column's "+ Add task".
 * @param {{ open: Function } | null} taskWindow useTaskWindow()
 * @param {object} task a board card's task
 * @param {HTMLElement | null} origin what was clicked: the card, its title or its "⋯"
 */
export function openTaskFrom(taskWindow, task, origin) {
  const byId = (id) => document.getElementById(id);
  const column = columnOf(task);
  const onCard = origin?.id === cardId(task.id);
  taskWindow?.open(task.id, {
    origin: (onCard ? byId(cardTitleId(task.id)) : null) ?? origin,
    title: task.title,
    returnFocus: () =>
      byId(cardTitleId(task.id)) ?? byId(foldButtonId(column)) ?? byId(addTaskId(column)),
  });
}

/** The first card title of a column, else its "+ Add task" (after a band part). */
const firstInColumn = (key) => () => {
  const column = document.querySelector(`[data-column="${key}"]`);
  return column?.querySelector('[data-card-title]') ?? document.getElementById(addTaskId(key));
};

/** A Table group's first row title (T draws `data-flip="group:<key>"` and `row:<id>` rows). */
function showTableGroup(key, behavior) {
  // The table and the phone's list both draw the group: the one shown.
  const group = shownIn(document, `[data-flip="group:${key}"]`);
  if (!group) return;
  group.scrollIntoView({ block: 'center', behavior });
  const rows = allShownIn(document, '[data-flip^="group:"], [data-flip^="row:"]');
  const next = rows[rows.indexOf(group) + 1];
  const row = next?.dataset.flip.startsWith('row:') ? next : null;
  const title =
    row?.querySelector('[data-row-title], [data-card-title]') ?? row?.querySelector('button');
  title?.focus({ preventScroll: true });
}

/**
 * The done phases opened as columns, the rail, and a band part followed to its column.
 * @param {{ columns: object[], state: object, after: Function, scroll: object,
 *   board: () => Element | null, view: { view: string, toggleRail: Function },
 *   behavior: () => ScrollBehavior }} deps
 */
export function phaseActions({ columns, state, after, scroll, board, view, behavior, flip }) {
  const open = (key, opening) => {
    const opened = opening ? [...state.opened, key] : state.opened.filter((one) => one !== key);
    return flip(board(), () => state.setOpened(opened));
  };
  return {
    async toggleOpened(key) {
      const opening = !state.opened.includes(key);
      await open(key, opening);
      if (opening) after(null, () => scroll.show(key));
      else
        after(
          () =>
            document.getElementById(tileButtonId(key)) ?? document.getElementById(RAIL_BUTTON_ID),
        );
    },
    async toggleRail() {
      await view.toggleRail(board());
      after(RAIL_BUTTON_ID);
    },
    async showPhase(key) {
      if (view.view === 'table') return showTableGroup(key, behavior());
      if (isPhone()) return state.setStep(key);
      const column = columns.find((one) => one.key === key);
      if (column?.hidden) await open(key, true);
      after(firstInColumn(key), () => scroll.show(key));
    },
  };
}
