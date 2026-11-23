// The page's answer to the service worker's ask on every push (CONTRACT 26), pure. The worker
// skips the system notification only when a window in front answers `shown`; `alerted` makes it
// silent; `osSound` tells this tab the system notification will make the sound, so it won't chime.
// A tab answers `shown` only when this browser can make the person's sound (`canSound`): a tab in
// front that nobody has clicked since it loaded has no audio yet, and must not silence the reminder.

const has = (collection, id) =>
  collection instanceof Set ? collection.has(id) : (collection ?? []).includes(id);

/**
 * @param {{ data: { id?: number | string | null, userId?: number | string | null,
 *   mustShow?: boolean }, userId: number, cursor: number | null, inFront: boolean,
 *   running: boolean, canSound?: boolean, preview: boolean, bellOpen: boolean,
 *   choice: 'important' | 'all' | 'off', alertedIds: Set<number> | number[],
 *   pendingIds: Set<number> | number[] }} options
 *   `running`: not stopped, not backing off, and a successful answer handled in the last 75 s;
 *   `canSound`: Sound is Off, or this tab's audio runs, or another tab's latest presence says so;
 *   `alertedIds`: the record's `chimed` and `shown`; `pendingIds`: the open batch, the queue and
 *   the stack.
 * @returns {{ shown: boolean, alerted: boolean, osSound: boolean }}
 */
export function answerPush({
  data,
  userId,
  cursor,
  inFront,
  running,
  canSound = true,
  preview,
  bellOpen,
  choice,
  alertedIds,
  pendingIds,
}) {
  const id = Number(data?.id);
  const sameUser =
    data?.userId !== null && data?.userId !== undefined && Number(data.userId) === userId;
  const inRecord = Number.isFinite(id) && has(alertedIds, id);
  const alerted = sameUser && (inRecord || (inFront && choice === 'off'));
  const isNew =
    Number.isFinite(id) &&
    ((cursor !== null && cursor !== undefined && id > cursor) || inRecord || has(pendingIds, id));
  const shown = sameUser && inFront && running && canSound && (preview || bellOpen) && isNew;
  const osSound = inFront && !alerted && (!shown || data?.mustShow === true);
  return { shown, alerted, osSound };
}
