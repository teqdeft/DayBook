'use client';
// Today's to-do for the page (CONTRACT 24): the to-do as the server sends it with the changes on
// their way on top (useTodoSync), every change as its own request (todoActions.js), lines and
// projects removed with an Undo toast (the project page's useUndoDelete, CONTRACT 22) left out until
// the DELETE goes when the toast ends, and projects picked here that stay on the page until their
// first line is saved. A click on a link to another page sends a waiting DELETE first
// (useSendBeforeLeave).
import { useCallback, useState } from 'react';
import { useUndoDelete } from '@/app/(app)/projects/[id]/useUndoDelete';
import { useToast } from '@/components/ToastProvider';
import * as actions from './todoActions';
import { groupKey, visibleTodo } from './todoModel';
import { useSendBeforeLeave } from './useSendBeforeLeave';
import { useTodoSync } from './useTodoSync';

export { HOURS_REFUSAL } from './todoActions';
export { POLL_MS, POLL_TIMES, todoOf } from './useTodoSync';

/** Projects picked on the page; one leaves the list once the server has it (a saved group). */
function usePicked(todo) {
  const [picked, setPicked] = useState([]);
  const savedKeys = new Set(todo.groups.filter((group) => group.entryId).map(groupKey));
  if (picked.some((head) => savedKeys.has(groupKey(head)))) {
    setPicked(picked.filter((head) => !savedKeys.has(groupKey(head))));
  }
  const pick = useCallback((head) => {
    setPicked((list) =>
      list.some((item) => groupKey(item) === groupKey(head)) ? list : [...list, head],
    );
  }, []);
  return { picked, setPicked, pick };
}

/**
 * @param {object} initialTodo reports.getTodo, from the page (a new one on every refresh)
 * @returns {object} { todo (as shown: visibleTodo), usedKeys, writing, posting, apply, track, pick,
 *   addLine, addLines, tick, rename, startTimer, removeLine, removeProject, post, undoToast }
 */
export function useTodoState(initialTodo) {
  const toast = useToast();
  const undo = useUndoDelete();
  const sync = useTodoSync(initialTodo);
  const [posting, setPosting] = useState(false);
  const { picked, setPicked, pick } = usePicked(sync.todo);
  useSendBeforeLeave(undo.waiting, undo.settle);

  const raw = sync.todo;
  const ctx = { raw, write: sync.write, undo, toast, setPicked, setPosting };
  return {
    todo: visibleTodo(raw, undo.isHidden, picked),
    // Every project in the list, those waiting behind an Undo too: the picker can't pick them.
    usedKeys: new Set([...raw.groups.map(groupKey), ...picked.map(groupKey)]),
    writing: sync.writing,
    posting,
    apply: sync.apply,
    track: sync.track,
    pick,
    addLine: (target, input) => actions.addLine(ctx, target, input),
    addLines: (groups, addedText) => actions.addLines(ctx, groups, addedText),
    tick: (line, done) => actions.tick(ctx, line, done),
    rename: (line, title) => actions.rename(ctx, line, title),
    startTimer: (line, group) => actions.startTimer(ctx, line, group),
    removeLine: (line, options) => actions.removeLine(ctx, line, options),
    removeProject: (group, options) => actions.removeProject(ctx, group, options),
    post: () => actions.post(ctx),
    undoToast: undo.toast,
  };
}
