// Today's to-do as the Today card shows it (CONTRACT 24), pure: groups and lines from the report's
// entries (view.entryView), "Now", the plan that goes to Slack with its hash, the post state and
// the timer note a line's Play button starts with.
import { createHash } from 'node:crypto';
import { dayjs } from '@/lib/time';
import { MAX_TIMER_NOTE_LENGTH } from './schemas';
import { dayLabel, normalizeTitle } from './todoText';

/** Spaces collapsed and trimmed, as formatTodo writes a title. */
function oneLine(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 'p12' for a project, 'r4' for a project request. */
function keyOf(entry) {
  return entry.projectId ? `p${entry.projectId}` : `r${entry.projectRequestId}`;
}

/** The lines of an entry with something written (blank rows of the report page never show). */
function writtenLines(entry) {
  return entry.tasks.filter((task) => oneLine(task.title));
}

const iso = (value) => (value ? dayjs(value).toISOString() : null);

/**
 * "Now": the person's running timer is on the line's project and its note, normalised, equals the
 * line's timer note or its title.
 * @param {{ title: string, timerNote?: string | null }} line
 * @param {number | null} projectId the line's project (a project request never has a timer)
 * @param {{ projectId: number, note: string | null } | null} running timers.getState().running
 * @returns {boolean}
 */
export function isNowLine(line, projectId, running) {
  if (!running || !projectId || Number(running.projectId) !== Number(projectId)) return false;
  const note = normalizeTitle(running.note);
  if (!note) return false;
  return note === normalizeTitle(line.timerNote) || note === normalizeTitle(line.title);
}

/**
 * A line's status after a tick (done true) or an untick (done false). Ticked is Done. Unticking
 * a Done line makes it In progress (not ticked = In progress, as the prototype does; a line that
 * was Blocked before it was ticked doesn't remember it: Blocked can be set again in the report).
 * A line that isn't Done keeps its status when unticked, so Blocked stays Blocked.
 * @param {'done' | 'in_progress' | 'blocked'} status
 * @param {boolean} done
 * @returns {'done' | 'in_progress' | 'blocked'}
 */
export function tickedStatus(status, done) {
  if (done) return 'done';
  return status === 'done' ? 'in_progress' : status;
}

/**
 * The note a line's timer starts with: the first 200 characters of its title (never half an
 * emoji), trimmed. The line's timer_note gets the same text, so Fill report from timers merges
 * the timer into this line even after the title is reworded.
 * @param {string} title
 * @returns {string | null}
 */
export function noteFromTitle(title) {
  let note = '';
  for (const char of String(title ?? '').trim()) {
    if (note.length + char.length > MAX_TIMER_NOTE_LENGTH) break;
    note += char;
  }
  return note.trim() || null;
}

/**
 * What the to-do post shows: every project with a written line, in report order, and its lines
 * with their status (formatTodo input, plus each project's key for the hash).
 * @param {Array<{ projectId?: number | null, projectRequestId?: number | null,
 *   projectName: string, tasks: Array<{ title: string, status: string }> }>} entries
 * @returns {Array<{ key: string, projectName: string, lines: Array<{ title: string,
 *   status: string }> }>}
 */
export function planOf(entries) {
  return entries
    .map((entry) => ({
      key: keyOf(entry),
      projectName: entry.projectName,
      lines: writtenLines(entry).map((task) => ({
        title: oneLine(task.title),
        status: task.status,
      })),
    }))
    .filter((group) => group.lines.length > 0);
}

/**
 * The plan's fingerprint (daily_reports.todo_post_hash): sha256 hex of the project ids and line
 * titles in order, without statuses, so ticking a line or a PM renaming a project never asks for
 * "Update post".
 * @param {ReturnType<typeof planOf>} plan
 * @returns {string}
 */
export function planHash(plan) {
  const content = plan.map((group) => [group.key, group.lines.map((line) => line.title)]);
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * Where the to-do message stands.
 * @param {{ todoPost: { postedAt, hash } | null, delivery: { status, at }, hash: string }} input
 *   todoPost: reports.findTodoPost; delivery: slack.latestTodoDelivery; hash: the current plan's
 * @returns {{ state: 'none' | 'sending' | 'sent' | 'failed', at: string | null,
 *   changed: boolean, postedAt: string | null }} at: when it was queued (sending), reached Slack
 *   (sent) or gave up (failed); changed: the list changed since the last post; postedAt: when the
 *   current message last reached Slack, whatever the latest delivery did
 */
export function postState({ todoPost, delivery, hash }) {
  const postedAt = iso(todoPost?.postedAt);
  const changed = Boolean(todoPost?.hash) && todoPost.hash !== hash;
  if (delivery.status === 'sending' || delivery.status === 'failed') {
    return { state: delivery.status, at: iso(delivery.at), changed, postedAt };
  }
  // Sent outbox rows are cleaned up after a while; the report still remembers the post.
  if (delivery.status === 'sent' || postedAt) {
    return { state: 'sent', at: postedAt ?? iso(delivery.at), changed, postedAt };
  }
  return { state: 'none', at: null, changed: false, postedAt: null };
}

function groupHead(entry) {
  if (entry.projectId) {
    return {
      entryId: entry.id,
      project: { id: entry.projectId, name: entry.projectName, color: entry.projectColor ?? null },
    };
  }
  return { entryId: entry.id, request: { id: entry.projectRequestId, name: entry.projectName } };
}

/**
 * The to-do's groups, one per project in report order, with their written lines.
 * @param {object[]} entries view.entryView objects of today's report
 * @param {{ today: string, running: object | null, sourceDays: Map<number, string>,
 *   canStart: boolean }} context running: the person's running timer; sourceDays: carried
 *   line's source id -> its report day; canStart: the person may start a timer now
 * @returns {object[]} [{ entryId, project | request, minutes, lines: [{ id, title, status, done,
 *   projectTaskId, now, carriedFrom, canStart }] }]
 */
export function todoGroups(entries, { today, running, sourceDays, canStart }) {
  return entries.map((entry) => {
    const timeable = Boolean(entry.projectId) && entry.projectStatus === 'active';
    return {
      ...groupHead(entry),
      minutes: Number(entry.minutes) || 0,
      lines: writtenLines(entry).map((task) => {
        const from = task.carriedFromTaskId ? sourceDays.get(Number(task.carriedFromTaskId)) : null;
        const done = task.status === 'done';
        const now = isNowLine(task, entry.projectId, running);
        return {
          id: task.id,
          title: task.title,
          status: task.status,
          done,
          projectTaskId: task.projectTaskId ?? null,
          now,
          carriedFrom: from ? { workDate: from, dayLabel: dayLabel(from, today) } : null,
          canStart: canStart && timeable && !done && !now,
        };
      }),
    };
  });
}

/**
 * The id of the line with this normalised title on a project of a to-do (after an add: the new
 * line, or the one it duplicates), or null.
 * @param {{ groups: object[] }} todo getTodo
 * @param {string} projectKey 'p12' or 'r4'
 * @param {string} title
 * @returns {number | null}
 */
export function lineIdIn(todo, projectKey, title) {
  const wanted = normalizeTitle(title);
  for (const group of todo.groups) {
    const key = group.project ? `p${group.project.id}` : `r${group.request.id}`;
    if (key !== projectKey) continue;
    const line = group.lines.find((row) => normalizeTitle(row.title) === wanted);
    if (line) return line.id;
  }
  return null;
}
