// Today's to-do kept in step with the server (CONTRACT 24), pure: answers arriving in any order,
// a page refresh started before the latest change, a failed write taking only its own change back,
// changes forgotten once nothing can miss them, and the rows waiting behind Undo that an add would
// run into.
import { describe, expect, it } from 'vitest';
import { lineUndoKey, projectUndoKey, withLinePatched } from '@/app/(app)/today/todoModel';
import {
  answered,
  applied,
  failed,
  heldRows,
  inFlight,
  joinHeld,
  refreshed,
  shownOf,
  started,
  syncOf,
  withNewLines,
  withoutHeld,
  writingCount,
} from '@/app/(app)/today/todoSync';

const SU = { id: 5, name: 'Studio Ubique', color: 'violet' };
const PTL = { id: 3, name: 'Pine Tree Lane', color: 'green' };

const line = (id, title, extra = {}) => ({
  id,
  title,
  status: 'in_progress',
  done: false,
  projectTaskId: null,
  ...extra,
});

/** The to-do with these lines Done (ids), the rest In progress. */
function todo(doneIds = [], extra = {}) {
  const lines = [line(21, 'One'), line(22, 'Two'), line(23, 'Three')].map((item) =>
    doneIds.includes(item.id) ? { ...item, done: true, status: 'done' } : item,
  );
  return {
    groups: [{ entryId: 2, project: SU, minutes: 0, lines }],
    done: doneIds.length,
    total: lines.length,
    ...extra,
  };
}

const tickShow = (id) => (current) => withLinePatched(current, id, { done: true, status: 'done' });
const doneIds = (sync) =>
  shownOf(sync)
    .groups.flatMap((group) => group.lines)
    .filter((item) => item.done)
    .map((item) => item.id);

describe('answers and refreshes', () => {
  it('keeps a later tick on top of an answer read before it', () => {
    let sync = syncOf(todo());
    sync = started(sync, { id: 1, show: tickShow(21) });
    sync = started(sync, { id: 2, show: tickShow(22) });
    expect(doneIds(sync)).toEqual([21, 22]);
    expect(writingCount(sync)).toBe(2);
    // The first answer was read before the second tick reached the server.
    sync = answered(sync, { id: 1, todo: todo([21]) });
    expect(doneIds(sync)).toEqual([21, 22]);
    sync = answered(sync, { id: 2, todo: todo([21, 22]) });
    expect(doneIds(sync)).toEqual([21, 22]);
    expect(inFlight(sync)).toBe(false);
  });

  it('drops an older answer that arrives after a newer one', () => {
    let sync = syncOf(todo());
    sync = started(sync, { id: 1, show: tickShow(21) });
    sync = started(sync, { id: 2, show: tickShow(22) });
    sync = answered(sync, { id: 2, todo: todo([21, 22], { mark: 'new' }) });
    sync = answered(sync, { id: 1, todo: todo([21], { mark: 'old' }) });
    expect(shownOf(sync).mark).toBe('new');
    expect(doneIds(sync)).toEqual([21, 22]);
  });

  it('keeps recent ticks over a refresh read before them, and trusts the next one', () => {
    let sync = syncOf(todo());
    sync = started(sync, { id: 1, show: tickShow(23) });
    sync = answered(sync, { id: 1, todo: todo([23]) });
    // A refresh started before the tick ended: it still says 23 isn't done.
    sync = refreshed(sync, { todo: todo([], { mark: 'stale' }), take: true });
    expect(shownOf(sync).mark).toBe('stale');
    expect(doneIds(sync)).toEqual([23]);
    // The next one was read after that one arrived, so after the tick: it wins, even unticked
    // (someone unticked it in the report since), and the tick is forgotten.
    sync = refreshed(sync, { todo: todo([], { mark: 'fresh' }), take: true });
    expect(doneIds(sync)).toEqual([]);
    expect(sync.writes).toEqual([]);
  });

  it('leaves the base alone for a refresh while a write is on its way', () => {
    let sync = syncOf(todo());
    sync = started(sync, { id: 1, show: tickShow(21) });
    const next = refreshed(sync, { todo: todo([], { mark: 'refresh' }), take: !inFlight(sync) });
    expect(shownOf(next).mark).toBeUndefined();
    expect(doneIds(next)).toEqual([21]);
  });

  it('takes back only the change that failed', () => {
    let sync = syncOf(todo());
    sync = started(sync, { id: 1, show: tickShow(21) });
    sync = started(sync, { id: 2, show: tickShow(22) });
    sync = answered(sync, { id: 1, todo: todo([21]) });
    sync = failed(sync, 2);
    expect(doneIds(sync)).toEqual([21]);
    expect(writingCount(sync)).toBe(0);
  });

  it('takes its own read only when it is newer, and puts every change on a to-do from elsewhere', () => {
    let sync = syncOf(todo());
    sync = started(sync, { id: 1, read: true });
    expect(inFlight(sync)).toBe(false);
    sync = started(sync, { id: 2, show: tickShow(22) });
    sync = answered(sync, { id: 2, todo: todo([22], { mark: 'write' }) });
    sync = answered(sync, { id: 1, todo: todo([], { mark: 'read' }) });
    expect(shownOf(sync).mark).toBe('write');
    sync = applied(sync, todo([], { mark: 'timer' }));
    expect(shownOf(sync).mark).toBe('timer');
    expect(doneIds(sync)).toEqual([22]);
  });

  it('forgets a write once a later write was sent after it ended and a refresh came after', () => {
    let sync = syncOf(todo());
    sync = started(sync, { id: 1, show: tickShow(21) });
    sync = answered(sync, { id: 1, todo: todo([21]) });
    sync = refreshed(sync, { todo: todo([21]), take: true });
    sync = started(sync, { id: 2, show: tickShow(22) });
    sync = answered(sync, { id: 2, todo: todo([21, 22]) });
    expect(sync.writes.map((write) => write.id)).toEqual([2]);
  });
});

describe('rows waiting behind Undo', () => {
  const list = () => ({
    groups: [
      { entryId: 1, project: PTL, minutes: 0, lines: [line(11, 'Ads report')] },
      {
        entryId: 2,
        project: SU,
        minutes: 0,
        lines: [line(21, 'Analysing the gsc stats'), line(22, 'Sitemap', { projectTaskId: 40 })],
      },
    ],
    done: 0,
    total: 3,
  });

  it('finds a hidden line with the same title or priority task, or the hidden project', () => {
    const hidden = new Set([lineUndoKey(21), lineUndoKey(22)]);
    const isHidden = (key) => hidden.has(key);
    expect(
      heldRows(list(), { project: SU }, { titles: ['analysing the  GSC stats'] }, isHidden),
    ).toEqual({ keys: ['line:21'], entryIds: [], lineIds: [21] });
    expect(
      heldRows(
        list(),
        { project: SU },
        { titles: ['Fix the sitemap'], projectTaskId: 40 },
        isHidden,
      ),
    ).toEqual({ keys: ['line:22'], entryIds: [], lineIds: [22] });
    expect(heldRows(list(), { project: SU }, { titles: ['Other'] }, isHidden).keys).toEqual([]);
    expect(heldRows(list(), { project: SU }, { titles: ['Sitemap'] }, () => false).keys).toEqual(
      [],
    );
    const project = heldRows(
      list(),
      { project: SU },
      { titles: ['New'] },
      (key) => key === projectUndoKey(2),
    );
    expect(project).toEqual({ keys: ['project:2'], entryIds: [2], lineIds: [] });
    expect(joinHeld([project, { keys: ['line:11'], entryIds: [], lineIds: [11] }])).toEqual({
      keys: ['project:2', 'line:11'],
      entryIds: [2],
      lineIds: [11],
    });
  });

  it('leaves the held rows out, so the new line shows in a new group at once', () => {
    const pending = line('new1', 'Old open thing');
    const shown = withNewLines(
      withoutHeld(list(), { entryIds: [2], lineIds: [] }),
      { project: SU },
      [pending],
    );
    expect(
      shown.groups.map((group) => [group.entryId, group.lines.map((item) => item.id)]),
    ).toEqual([
      [1, [11]],
      [null, ['new1']],
    ]);
    expect(shown.total).toBe(2);
    const line21 = withoutHeld(list(), { entryIds: [], lineIds: [21] });
    expect(line21.groups[1].lines.map((item) => item.id)).toEqual([22]);
  });

  it('adds nothing twice when the to-do already holds the line', () => {
    const again = withNewLines(list(), { project: SU }, [line('new2', 'analysing the gsc  stats')]);
    expect(again).toEqual(list());
  });
});
