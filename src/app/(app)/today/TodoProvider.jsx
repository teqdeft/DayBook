'use client';
// Today's to-do for the whole page (CONTRACT 24): the to-do card, the Priority tasks card ("Add to
// to-do", "In to-do") and the timer form (the to-do's lines as notes) share one state, so a change
// in one shows in the others at once. Renders no element of its own (the page's layout sees its
// children directly); the Undo toast for removed lines and projects sits in the app's toast slot.
import { createContext, useContext } from 'react';
import { useTodoState } from './useTodoState';

const TodoContext = createContext(null);

/** The page's to-do (useTodoState), or null outside a TodoProvider (no `report.self`). */
export function useTodo() {
  return useContext(TodoContext);
}

/**
 * @param {{ initialTodo: object, children: import('react').ReactNode }} props initialTodo:
 *   reports.getTodo, read again on every page refresh
 */
export default function TodoProvider({ initialTodo, children }) {
  const value = useTodoState(initialTodo);
  return (
    <TodoContext value={value}>
      {children}
      {value.undoToast}
    </TodoContext>
  );
}
