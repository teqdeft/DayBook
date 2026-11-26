// Page events between the project page's task pieces that don't share a React context
// (CONTRACT 28): sent on `window` as CustomEvents with `detail.taskId`.

/**
 * A task was opened again from outside its card or row, by the "Marked done." toast's Undo
 * (TaskUndoProvider) or the task window's Reopen (TaskWindowFooter). The tick holds of the board
 * (useTickLeave) and of My tasks (useMineTick) drop what they still show as done for it, so the
 * reopened task is back at once.
 */
export const TASK_REOPENED = 'daybook:task-reopened';

/**
 * Says a task was opened again (the server has it), before the page's refresh.
 * @param {number} taskId
 */
export function sayReopened(taskId) {
  window.dispatchEvent(new CustomEvent(TASK_REOPENED, { detail: { taskId } }));
}
