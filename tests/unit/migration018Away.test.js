// Migration 018's backfill rule (CONTRACT 25 Data step 7, db/lib/removedSpans018.js): which spans
// of one person-day a 1.09 "Remove" took off a timer, and which candidates are skipped.
import { describe, expect, it } from 'vitest';
import { removedSpans } from '../../db/lib/removedSpans018.js';

const DAY = '2026-11-10';
/** A Kolkata clock ('10:30', '10:30:20' or '10:30:20.400') on the day as a Date. */
const at = (clock) => new Date(`${DAY}T${clock.length === 5 ? `${clock}:00` : clock}+05:30`);

let nextId = 0;

/** A time_entries row as the migration reads it (camelCase, Dates). */
function entry({
  id = (nextId += 1),
  projectId = 1,
  source = 'timer',
  from,
  to = null,
  stopReason = to ? 'stopped' : null,
  checked = null,
  created = from,
  updated = to ?? from,
}) {
  return {
    id,
    projectId,
    source,
    startedAt: at(from),
    endedAt: to ? at(to) : null,
    stopReason,
    awayCheckedUntil: checked ? at(checked) : null,
    createdAt: at(created),
    updatedAt: at(updated),
  };
}

/** A 1.09 split Remove: the head ended at `from` (away), the tail started at `to` at `answered`. */
function split({ start = '10:00', from, to, answered, end = null, projectId = 1, tail = {} }) {
  const head = entry({ projectId, from: start, to: from, stopReason: 'away', updated: answered });
  const rest = entry({
    projectId,
    from: to,
    to: end,
    checked: to,
    created: answered,
    updated: end ?? answered,
  });
  return [head, { ...rest, ...tail }];
}

/** A timer whose start a 1.09 Remove moved from `created` to `from`. */
const lone = (from, to, created) => entry({ from, to, checked: from, created });

const row = (checkIn = '09:00', checkOut = null) => ({
  id: 7,
  checkInAt: at(checkIn),
  checkOutAt: checkOut ? at(checkOut) : null,
});
const breakRow = (from, to = null) => ({
  id: 99,
  startedAt: at(from),
  endedAt: to ? at(to) : null,
});
const span = (from, to, awayEntryId) => ({ startedAt: at(from), endedAt: at(to), awayEntryId });

describe('split Removes', () => {
  it("pairs a head with its tail when the tail's created_at is the head's updated_at", () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20' });
    expect(removedSpans({ entries: [tail, head], row: row() })).toEqual({
      spans: [span('10:30', '11:15', head.id)],
      skipped: 0,
    });
  });

  it('compares to the second: a part of a second apart pairs, a whole second does not', () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20:00.400' });
    tail.createdAt = at('11:20:00.900');
    expect(removedSpans({ entries: [head, tail], row: row() }).spans).toHaveLength(1);
    tail.createdAt = at('11:20:01');
    expect(removedSpans({ entries: [head, tail], row: row() })).toEqual({ spans: [], skipped: 0 });
  });

  it("needs the head's project and a timer tail", () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20' });
    const other = { ...tail, projectId: 2 };
    expect(removedSpans({ entries: [head, other], row: row() }).spans).toEqual([]);
    const byHand = { ...tail, source: 'manual' };
    expect(removedSpans({ entries: [head, byHand], row: row() }).spans).toEqual([]);
  });

  it('needs a finished timer head that stopped as away', () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20' });
    for (const changed of [
      { ...head, stopReason: 'stopped' },
      { ...head, source: 'manual' },
      { ...head, endedAt: null },
    ]) {
      expect(removedSpans({ entries: [changed, tail], row: row() }).spans).toEqual([]);
    }
  });

  it("pairs only with the head's next entry by start, ties by id", () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20' });
    // Time added by hand inside the gap is now the next entry: no pair, no candidate.
    const between = entry({ source: 'manual', from: '10:35', to: '10:55', created: '11:30' });
    expect(removedSpans({ entries: [head, tail, between], row: row() })).toEqual({
      spans: [],
      skipped: 0,
    });
    // Same start as the tail but a higher id: the tail is still next.
    const twin = entry({ id: tail.id + 50, from: '11:15', to: '11:16', created: '11:16' });
    expect(removedSpans({ entries: [twin, head, tail], row: row() }).spans).toEqual([
      span('10:30', '11:15', head.id),
    ]);
  });

  it('takes the whole span when a later Remove moved the tail on', () => {
    // 11:05 split [10:30, 11:00]; 11:45 a Remove from the tail's first minute moved it to 11:40.
    const [head, tail] = split({
      from: '10:30',
      to: '11:00',
      answered: '11:05',
      tail: { startedAt: at('11:40'), awayCheckedUntil: at('11:40'), updatedAt: at('11:45') },
    });
    // The tail is paired, so its moved start is not a second (smaller) candidate.
    expect(removedSpans({ entries: [head, tail], row: row() })).toEqual({
      spans: [span('10:30', '11:40', head.id)],
      skipped: 0,
    });
  });

  it('pairs each split of a chain once', () => {
    const [a, b] = split({ from: '10:30', to: '11:00', answered: '11:05' });
    b.endedAt = at('12:00');
    b.stopReason = 'away';
    b.updatedAt = at('12:35');
    const c = entry({ from: '12:30', checked: '12:30', created: '12:35' });
    expect(removedSpans({ entries: [c, b, a], row: row() }).spans).toEqual([
      span('10:30', '11:00', a.id),
      span('12:00', '12:30', b.id),
    ]);
  });

  it('never matches a fresh, resumed or hand-added entry after an away head', () => {
    const head = entry({ from: '10:00', to: '10:30', stopReason: 'away', updated: '11:05' });
    const fresh = entry({ from: '11:20', to: '12:00', created: '11:20' });
    const resumed = entry({ from: '13:45', to: '14:30', created: '13:45:00.350' });
    const byHand = entry({ source: 'manual', from: '11:00', to: '11:18', created: '11:19' });
    for (const next of [fresh, resumed, byHand]) {
      expect(removedSpans({ entries: [head, next], row: row() })).toEqual({
        spans: [],
        skipped: 0,
      });
    }
  });
});

describe('moved starts', () => {
  it('takes [created_at, started_at] from a timer whose start moved to away_checked_until', () => {
    const moved = entry({ from: '09:40', to: '10:30', checked: '09:40', created: '09:00' });
    expect(removedSpans({ entries: [moved], row: row('08:55') })).toEqual({
      spans: [span('09:00', '09:40', moved.id)],
      skipped: 0,
    });
  });

  it('compares the start and away_checked_until to the second', () => {
    const moved = entry({ from: '09:40', to: '10:30', checked: '09:40', created: '09:00' });
    moved.awayCheckedUntil = at('09:40:00.700');
    expect(removedSpans({ entries: [moved], row: row('08:55') }).spans).toHaveLength(1);
    moved.awayCheckedUntil = at('09:40:01');
    expect(removedSpans({ entries: [moved], row: row('08:55') }).spans).toEqual([]);
  });

  it('skips a start answered Keep since, a fresh or resumed timer and a hand-added entry', () => {
    const kept = entry({ from: '09:40', to: '10:30', checked: '10:15', created: '09:00' });
    const fresh = entry({ from: '11:00', to: '11:30', checked: '11:00', created: '11:00' });
    const resumed = entry({
      from: '13:45',
      to: '14:00',
      checked: '13:45',
      created: '13:45:00.400',
    });
    const byHand = entry({ source: 'manual', from: '15:00', to: '15:30', created: '14:00' });
    const manualMoved = entry({
      source: 'manual',
      from: '16:00',
      to: '16:30',
      checked: '16:00',
      created: '15:40',
    });
    const entries = [kept, fresh, resumed, byHand, manualMoved];
    expect(removedSpans({ entries, row: row('08:55') })).toEqual({ spans: [], skipped: 0 });
  });
});

describe('skipped candidates (counted)', () => {
  it('a span under one minute; exactly one minute is kept', () => {
    const short = lone('10:00:59', '10:30', '10:00');
    const minute = lone('11:01', '11:30', '11:00');
    expect(removedSpans({ entries: [short, minute], row: row() })).toEqual({
      spans: [span('11:00', '11:01', minute.id)],
      skipped: 1,
    });
  });

  it('without an attendance row that day', () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20' });
    expect(removedSpans({ entries: [head, tail], row: null })).toEqual({ spans: [], skipped: 1 });
    expect(removedSpans({ entries: [head, tail] })).toEqual({ spans: [], skipped: 1 });
  });

  it("outside the row's present window; its edges count as inside", () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20', end: '12:00' });
    const entries = [head, tail];
    expect(removedSpans({ entries, row: row('10:45', '18:00') }).skipped).toBe(1);
    expect(removedSpans({ entries, row: row('09:00', '11:00') }).skipped).toBe(1);
    expect(removedSpans({ entries, row: row('10:30', '11:15') }).spans).toHaveLength(1);
  });

  it('an open or missing row has no end', () => {
    const [head, tail] = split({ from: '21:00', to: '22:30', answered: '22:35', start: '20:00' });
    expect(removedSpans({ entries: [head, tail], row: row('09:00', null) })).toEqual({
      spans: [span('21:00', '22:30', head.id)],
      skipped: 0,
    });
    expect(removedSpans({ entries: [head, tail], row: row('21:30', null) }).skipped).toBe(1);
  });

  it('overlapping a break of the person; an open break has no end; touching is not overlap', () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20', end: '12:00' });
    const entries = [head, tail];
    const result = (breaks) => removedSpans({ entries, breaks, row: row() });
    expect(result([breakRow('11:00', '11:30')])).toEqual({ spans: [], skipped: 1 });
    expect(result([breakRow('10:50')])).toEqual({ spans: [], skipped: 1 });
    expect(result([breakRow('10:00', '10:30'), breakRow('11:15')]).spans).toHaveLength(1);
  });

  it('overlapping an entry of the person (a running one has no end)', () => {
    const moved = lone('10:40', '11:30', '10:00');
    const byHand = entry({ source: 'manual', from: '10:10', to: '10:30', created: '10:50' });
    expect(removedSpans({ entries: [moved, byHand], row: row() })).toEqual({
      spans: [],
      skipped: 1,
    });
    const running = entry({ projectId: 3, source: 'manual', from: '09:50', created: '09:50' });
    expect(removedSpans({ entries: [moved, running], row: row() }).skipped).toBe(1);
  });

  it('overlapping a span already chosen (the earlier one wins)', () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20', end: '12:00' });
    const twin = entry({
      id: tail.id + 50,
      projectId: 2,
      from: '11:15',
      to: '11:45',
      checked: '11:15',
      created: '10:45',
    });
    expect(removedSpans({ entries: [head, tail, twin], row: row() })).toEqual({
      spans: [span('10:30', '11:15', head.id)],
      skipped: 1,
    });
  });

  it('keeps spans that only touch the entries around them', () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20', end: '12:00' });
    const moved = lone('12:40', '13:00', '12:00');
    expect(removedSpans({ entries: [head, tail, moved], row: row() })).toEqual({
      spans: [span('10:30', '11:15', head.id), span('12:00', '12:40', moved.id)],
      skipped: 0,
    });
  });
});

describe('a second run', () => {
  it('inserts nothing: every span overlaps the break it made', () => {
    const [head, tail] = split({ from: '10:30', to: '11:15', answered: '11:20', end: '12:00' });
    const moved = lone('12:40', '13:00', '12:00');
    const entries = [head, tail, moved];
    const first = removedSpans({ entries, row: row() });
    const breaks = first.spans.map((made) => ({ ...made, id: 1 }));
    expect(removedSpans({ entries, breaks, row: row() })).toEqual({ spans: [], skipped: 2 });
  });

  it('answers nothing for no entries', () => {
    expect(removedSpans({ entries: [] })).toEqual({ spans: [], skipped: 0 });
    expect(removedSpans({ entries: undefined, breaks: undefined })).toEqual({
      spans: [],
      skipped: 0,
    });
  });
});
