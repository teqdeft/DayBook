// The pure rule behind migration 018's backfill: which spans of one person-day were taken off a
// timer by a 1.09 "Remove" and never became a break. No database, no `@/` imports (the knex CLI
// loads the migration without the app's aliases). Unit tested in tests/unit/migration018Away.test.js.

const MINUTE_MS = 60_000;

const ms = (value) => new Date(value).getTime();
const toSecond = (value) => Math.floor(ms(value) / 1000);
const sameId = (a, b) => Number(a) === Number(b);
const byStart = (a, b) => ms(a.startedAt) - ms(b.startedAt) || Number(a.id) - Number(b.id);
// Half-open, to the millisecond: touching is not overlapping.
const overlaps = (a, b) => a.from < b.to && b.from < a.to;
const stretch = (item) => ({
  from: ms(item.startedAt),
  to: item.endedAt ? ms(item.endedAt) : Infinity,
});

/**
 * A split: the head ended at the span's start (stop reason away) and the tail was inserted by the
 * same Remove, so the tail's created_at is the head's updated_at, to the second (1.09's
 * removeAwayTime wrote both from one `at`). A fresh, resumed or hand-added entry never matches.
 * Span = [head end, tail start], also when a later Remove moved the tail's start on.
 */
function splitCandidates(sorted, paired) {
  const found = [];
  sorted.forEach((head, index) => {
    if (head.source !== 'timer' || head.stopReason !== 'away' || !head.endedAt) return;
    const tail = sorted[index + 1];
    if (!tail || tail.source !== 'timer' || !sameId(tail.projectId, head.projectId)) return;
    if (!tail.createdAt || !head.updatedAt) return;
    if (toSecond(tail.createdAt) !== toSecond(head.updatedAt)) return;
    paired.add(Number(tail.id));
    found.push({ from: ms(head.endedAt), to: ms(tail.startedAt), awayEntryId: Number(head.id) });
  });
  return found;
}

/**
 * A moved start: a timer row is created at its first start, and a Remove from its first minute
 * moved the start to away_checked_until. Span = [created_at, started_at], what the move took off.
 */
function movedCandidates(sorted, paired) {
  const found = [];
  for (const entry of sorted) {
    if (entry.source !== 'timer' || paired.has(Number(entry.id))) continue;
    if (!entry.awayCheckedUntil || !entry.createdAt) continue;
    if (toSecond(entry.startedAt) !== toSecond(entry.awayCheckedUntil)) continue;
    if (toSecond(entry.createdAt) >= toSecond(entry.startedAt)) continue;
    found.push({
      from: ms(entry.createdAt),
      to: ms(entry.startedAt),
      awayEntryId: Number(entry.id),
    });
  }
  return found;
}

/**
 * The away breaks to rebuild for one person and work date.
 * @param {{ entries: object[], breaks?: object[], row?: { id: number, checkInAt: Date,
 *   checkOutAt: Date | null } | null }} input entries: every time_entries row of the person-day
 *   (camelCase: id, projectId, source, startedAt, endedAt, stopReason, awayCheckedUntil,
 *   createdAt, updatedAt); breaks: every attendance_breaks row of the person-day; row: that day's
 *   attendance row, or null
 * @returns {{ spans: Array<{ startedAt: Date, endedAt: Date, awayEntryId: number }>,
 *   skipped: number }} skipped: candidates under a minute, without a row, outside the row's
 *   present window, or overlapping a break, an entry or a span already chosen
 */
export function removedSpans({ entries, breaks = [], row = null }) {
  const sorted = [...(entries ?? [])].sort(byStart);
  const paired = new Set();
  const candidates = [...splitCandidates(sorted, paired), ...movedCandidates(sorted, paired)];
  candidates.sort((a, b) => a.from - b.from);
  const busy = [...breaks.map(stretch), ...sorted.map(stretch)];
  const spans = [];
  let skipped = 0;
  for (const span of candidates) {
    const inside =
      Boolean(row) &&
      span.from >= ms(row.checkInAt) &&
      (!row.checkOutAt || span.to <= ms(row.checkOutAt));
    const free =
      !busy.some((other) => overlaps(span, other)) &&
      !spans.some((chosen) => overlaps(span, stretch(chosen)));
    if (!inside || span.to - span.from < MINUTE_MS || !free) {
      skipped += 1;
      continue;
    }
    spans.push({
      startedAt: new Date(span.from),
      endedAt: new Date(span.to),
      awayEntryId: span.awayEntryId,
    });
  }
  return { spans, skipped };
}
