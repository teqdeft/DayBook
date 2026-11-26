// Who the task window shows while a change of person settles (CONTRACT 28, The people window, Assign
// to me): the page's task actions lay the new person over the task while the save runs and until
// the page has refreshed; the window then loads the task again. Between the two the window keeps
// showing the person on its way (`pin`), so the earlier person never flashes back. Pure.

const idOf = (person) => (person ? Number(person.id) : null);

/**
 * The next pin and the person to show.
 * @param {{ assignee: object | null, waiting: boolean, sawLoading: boolean } | null} pin
 * @param {{ overlay: object | null | undefined, task: { assignee: object | null },
 *   loading: boolean }} now overlay: the person laid over (undefined when none)
 * @returns {{ pin: object | null, assignee: object | null }}
 */
export function nextPin(pin, { overlay, task, loading }) {
  if (overlay !== undefined) {
    const same = pin && !pin.waiting && idOf(pin.assignee) === idOf(overlay);
    return {
      pin: same ? pin : { assignee: overlay, waiting: false, sawLoading: false },
      assignee: overlay,
    };
  }
  if (!pin || idOf(pin.assignee) === idOf(task.assignee))
    return { pin: null, assignee: task.assignee };
  if (!pin.waiting) return { pin: { ...pin, waiting: true }, assignee: pin.assignee };
  if (loading) {
    return { pin: pin.sawLoading ? pin : { ...pin, sawLoading: true }, assignee: pin.assignee };
  }
  // The task loaded again and still names someone else: the change failed or was undone.
  return pin.sawLoading ? { pin: null, assignee: task.assignee } : { pin, assignee: pin.assignee };
}
