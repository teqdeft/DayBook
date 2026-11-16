// Today's to-do kept in step with the server (CONTRACT 24), pure. The card shows the last to-do the
// server sent (the base) with every change the base may not hold yet put on top again: a write still
// on its way, or one that ended after the base was read. So an answer read before a later tick, or a
// page refresh started before it, never unticks a box under the person's cursor, and an error takes
// only its own change back. One counter numbers each write (and each read the card makes itself) as
// it starts and as it ends, and each page refresh as it arrives:
// - a write's answer was read after the write; it holds every write that ended before it started;
// - an answer to something started before the base's own request is older than the base: dropped;
// - the router runs refreshes one after another, so a refresh was read after the one before it
//   arrived, and holds the writes that ended before that.
// A change is forgotten once the base holds it and every to-do the card may still take will too.
import { normalizeTitle } from '@/modules/reports/todoText';
import { groupKey, lineUndoKey, projectUndoKey, withLinesAdded } from './todoModel';

/**
 * @typedef {{ id: number, show: ((todo: object) => object) | null, read: boolean, sent: number,
 *   ended: number | null }} Write
 *   show: the change at once (null: nothing to show); read: a GET the card makes, not a change
 * @typedef {{ base: object, clock: number, since: number, own: number | null, floor: number,
 *   refreshed: number, writes: Write[] }} Sync
 *   base: the server's to-do; since: it was read after this; own: the write (or read) it answers;
 *   floor: answers to anything started before this are older than the base; refreshed: when the
 *   last page refresh arrived
 */

/** @returns {Sync} the state for the page's first to-do */
export function syncOf(todo) {
  return { base: todo, clock: 0, since: 0, own: null, floor: 0, refreshed: 0, writes: [] };
}

/** Whether the base already holds the write's change. */
function holds(sync, write) {
  return write.id === sync.own || (write.ended !== null && write.ended < sync.since);
}

/** Drops the writes nothing needs any more: ended, held, and held by anything still to come. */
function forget(sync) {
  const safe = Math.min(sync.floor, sync.refreshed);
  const writes = sync.writes.filter(
    (write) => write.ended === null || (write.show && !(holds(sync, write) && write.ended < safe)),
  );
  return writes.length === sync.writes.length ? sync : { ...sync, writes };
}

/** A write (or the card's own read) starts. */
export function started(sync, { id, show = null, read = false }) {
  const clock = sync.clock + 1;
  return { ...sync, clock, writes: [...sync.writes, { id, show, read, sent: clock, ended: null }] };
}

/** A write failed: its change goes (the server has none of it). */
export function failed(sync, id) {
  return forget({ ...sync, writes: sync.writes.filter((write) => write.id !== id) });
}

/** A write (or read) answered; its to-do, when it brings one, becomes the base unless older. */
export function answered(sync, { id, todo }) {
  const write = sync.writes.find((item) => item.id === id);
  if (!write) return sync;
  const clock = sync.clock + 1;
  const writes = sync.writes.map((item) => (item.id === id ? { ...item, ended: clock } : item));
  const next = { ...sync, clock, writes };
  if (!todo || write.sent < sync.floor) return forget(next);
  return forget({ ...next, base: todo, since: write.sent, own: id, floor: write.sent });
}

/**
 * A page refresh brought a to-do. It becomes the base only while no write is on its way (`take`);
 * either way it marks when the next refresh can have been read.
 */
export function refreshed(sync, { todo, take }) {
  const clock = sync.clock + 1;
  const next = { ...sync, clock, refreshed: clock };
  if (!take) return forget(next);
  return forget({
    ...next,
    base: todo,
    since: sync.refreshed,
    own: null,
    floor: Math.max(sync.floor, clock),
  });
}

/** A to-do from elsewhere, read at a time the card doesn't know: every change goes on top of it. */
export function applied(sync, todo) {
  return { ...sync, base: todo, since: 0, own: null };
}

/** Whether a write (not the card's own read) is still on its way. */
export const inFlight = (sync) => sync.writes.some((write) => write.ended === null && !write.read);

/** How many writes are on their way. */
export const writingCount = (sync) =>
  sync.writes.filter((write) => write.ended === null && !write.read).length;

/** The to-do as it stands: the base with the changes it doesn't hold yet. */
export function shownOf(sync) {
  return sync.writes.reduce(
    (todo, write) => (write.show && !holds(sync, write) ? write.show(todo) : todo),
    sync.base,
  );
}

/**
 * The to-do with lines added to a project, leaving out the titles it already has (so a change put
 * on top of an answer that already holds it adds nothing twice).
 */
export function withNewLines(todo, target, lines) {
  const key = groupKey(target);
  const group = todo.groups.find((item) => groupKey(item) === key);
  const have = new Set((group?.lines ?? []).map((line) => normalizeTitle(line.title)));
  const fresh = lines.filter((line) => !have.has(normalizeTitle(line.title)));
  return fresh.length ? withLinesAdded(todo, target, fresh) : todo;
}

/**
 * The rows waiting behind the Undo toast (or whose DELETE is on its way) that an add to a project
 * would run into: the project itself, or its lines with one of the titles or linking the same
 * priority task. The add sends their DELETE first and waits for it, so the server neither skips
 * the new line as a duplicate nor puts it into an entry that is about to go.
 * @param {object} todo the to-do with the hidden rows still in it
 * @param {{ project?: object, request?: object }} target
 * @param {{ titles: string[], projectTaskId?: number | null }} adding
 * @param {(key: string) => boolean} isHidden the Undo queue's hidden keys
 * @returns {{ keys: string[], entryIds: number[], lineIds: Array<number | string> }}
 */
export function heldRows(todo, target, { titles, projectTaskId = null }, isHidden) {
  const key = groupKey(target);
  const wanted = new Set(titles.map(normalizeTitle));
  const held = { keys: [], entryIds: [], lineIds: [] };
  for (const group of todo.groups) {
    if (groupKey(group) !== key) continue;
    if (group.entryId && isHidden(projectUndoKey(group.entryId))) {
      held.keys.push(projectUndoKey(group.entryId));
      held.entryIds.push(group.entryId);
      continue;
    }
    for (const line of group.lines) {
      const same =
        wanted.has(normalizeTitle(line.title)) ||
        (projectTaskId != null && Number(line.projectTaskId) === Number(projectTaskId));
      if (!same || !isHidden(lineUndoKey(line.id))) continue;
      held.keys.push(lineUndoKey(line.id));
      held.lineIds.push(line.id);
    }
  }
  return held;
}

/** Several heldRows results as one. */
export function joinHeld(list) {
  return {
    keys: list.flatMap((held) => held.keys),
    entryIds: list.flatMap((held) => held.entryIds),
    lineIds: list.flatMap((held) => held.lineIds),
  };
}

/** The to-do without the held rows (they are being deleted), counts updated. */
export function withoutHeld(todo, { entryIds, lineIds }) {
  if (!entryIds.length && !lineIds.length) return todo;
  const entries = new Set(entryIds);
  const lines = new Set(lineIds);
  const groups = todo.groups
    .filter((group) => !entries.has(group.entryId))
    .map((group) =>
      group.lines.some((line) => lines.has(line.id))
        ? { ...group, lines: group.lines.filter((line) => !lines.has(line.id)) }
        : group,
    );
  const all = groups.flatMap((group) => group.lines);
  return {
    ...todo,
    groups,
    done: all.filter((line) => line.done).length,
    total: all.length,
  };
}
