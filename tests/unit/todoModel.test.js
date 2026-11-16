// Today's to-do card, pure (CONTRACT 24): the to-do as the card shows it (lines and projects
// waiting behind Undo left out, projects picked without a line yet added), the changes a write
// shows at once, the header's count and subtitle, every state of the Slack button, the suggestion
// helpers, the picker's projects for the paste dialog, and the timer form's to-do offers.
import { describe, expect, it } from 'vitest';
import {
  addedToTodayText,
  carryEntries,
  doneText,
  groupKey,
  hasTitle,
  headOfPick,
  isLocked,
  isPendingLine,
  linkedTaskIds,
  pendingLine,
  pickables,
  slackView,
  subtitleOf,
  suggestionFor,
  targetOf,
  tickedStatus,
  visibleTodo,
  withLinePatched,
  withLinesAdded,
  withoutLines,
} from '@/app/(app)/today/todoModel';
import { todoOffers } from '@/app/(app)/today/timerData';

const TZ = 'Asia/Kolkata';
const PTL = { id: 3, name: 'Pine Tree Lane', color: 'green' };
const SU = { id: 5, name: 'Studio Ubique', color: 'violet' };
const REQ = { id: 4, name: 'Blue Harbour' };

const line = (id, title, extra = {}) => ({
  id,
  title,
  status: 'in_progress',
  done: false,
  projectTaskId: null,
  now: false,
  carriedFrom: null,
  canStart: true,
  ...extra,
});

function todo(extra = {}) {
  return {
    workDate: '2026-11-13',
    reportId: 9,
    editable: true,
    submitted: false,
    done: 1,
    total: 3,
    post: { state: 'none', at: null, changed: false, postedAt: null },
    slack: { canPost: true },
    timer: { canStart: true },
    groups: [
      {
        entryId: 1,
        project: PTL,
        minutes: 0,
        lines: [line(11, 'Monitoring google ads', { status: 'done', done: true, canStart: false })],
      },
      {
        entryId: 2,
        project: SU,
        minutes: 90,
        lines: [line(21, '1 web blog publish', { projectTaskId: 7 }), line(22, 'Analysing gsc')],
      },
    ],
    suggestions: {},
    ...extra,
  };
}

const NOTHING = () => false;

describe('the to-do as the card shows it', () => {
  it('leaves out lines and projects waiting behind Undo and counts what is left', () => {
    const hidden = new Set(['line:21']);
    const view = visibleTodo(todo(), (key) => hidden.has(key));
    expect(view.groups[1].lines.map((item) => item.id)).toEqual([22]);
    expect([view.done, view.total]).toEqual([1, 2]);

    const noProject = visibleTodo(todo(), (key) => key === 'project:1');
    expect(noProject.groups.map(groupKey)).toEqual(['p5']);
    expect([noProject.done, noProject.total]).toEqual([0, 2]);
  });

  it('adds projects picked on the page that have no line yet, once', () => {
    const view = visibleTodo(todo(), NOTHING, [{ project: SU }, { request: REQ }]);
    expect(view.groups.map(groupKey)).toEqual(['p3', 'p5', 'r4']);
    expect(view.groups[2]).toMatchObject({ entryId: null, minutes: 0, lines: [] });
  });

  it('shows an add at once, in its project or in a new group, and takes it back', () => {
    const pending = pendingLine({ id: 'new1', title: '  Write  the brief ' });
    expect(pending).toMatchObject({ title: 'Write the brief', status: 'in_progress', done: false });
    expect(isPendingLine(pending)).toBe(true);
    expect(isPendingLine(line(5, 'x'))).toBe(false);

    const there = withLinesAdded(todo(), { project: SU }, [pending]);
    expect(there.groups[1].lines.map((item) => item.id)).toEqual([21, 22, 'new1']);
    expect(there.total).toBe(4);

    const fresh = withLinesAdded(todo(), { request: REQ }, [pending]);
    expect(fresh.groups[2]).toMatchObject({ entryId: null, request: REQ, minutes: 0 });
    // A failed add takes its line back, and the group made only for it.
    expect(withoutLines(fresh, ['new1']).groups.map(groupKey)).toEqual(['p3', 'p5']);
    expect(withoutLines(there, ['new1']).groups[1].lines).toHaveLength(2);
  });

  it('changes one line and recounts', () => {
    const ticked = withLinePatched(todo(), 22, { done: true, status: 'done' });
    expect(ticked.groups[1].lines[1]).toMatchObject({ done: true, status: 'done' });
    expect(ticked.done).toBe(2);
  });

  it('unticks Done to In progress and keeps Blocked', () => {
    expect(tickedStatus('in_progress', true)).toBe('done');
    expect(tickedStatus('blocked', true)).toBe('done');
    expect(tickedStatus('done', false)).toBe('in_progress');
    expect(tickedStatus('blocked', false)).toBe('blocked');
  });
});

describe('the header', () => {
  it('counts the done lines and says when the report is in', () => {
    expect(doneText(todo())).toBe('1 of 3 done');
    expect(subtitleOf(todo())).toBe("What you'll work on today. It becomes your report.");
    expect(subtitleOf(todo({ submitted: true, done: 2, total: 5 }))).toBe(
      '2 of 5 done. Your report is in.',
    );
    expect(isLocked(todo({ submitted: true }))).toBe(true);
    expect(isLocked(todo({ editable: false }))).toBe(true);
    expect(isLocked(todo())).toBe(false);
  });
});

describe('the Slack button', () => {
  const at = '2026-11-13T04:11:00.000Z'; // 9:41 AM in India
  const view = (post, extra = {}) =>
    slackView({
      todo: todo({ post: { at: null, changed: false, postedAt: null, ...post }, ...extra }),
      busy: false,
      tz: TZ,
    });

  it('is hidden while posting is off, the list is empty or the report is in', () => {
    expect(view({ state: 'none' }, { slack: { canPost: false } })).toBeNull();
    expect(view({ state: 'none' }, { total: 0 })).toBeNull();
    expect(view({ state: 'sent', at, postedAt: at }, { submitted: true })).toBeNull();
  });

  it('offers Post to Slack, then Posting… while it sends', () => {
    expect(view({ state: 'none' })).toEqual({
      posted: null,
      failed: false,
      primary: { label: 'Post to Slack', busy: false },
      secondary: null,
    });
    expect(slackView({ todo: todo(), busy: true, tz: TZ }).primary).toEqual({
      label: 'Posting…',
      busy: true,
    });
    expect(view({ state: 'sending', at }).primary).toEqual({ label: 'Posting…', busy: true });
  });

  it('says Posted at 9:41 AM, with Update post only after the list changed', () => {
    expect(view({ state: 'sent', at, postedAt: at })).toEqual({
      posted: 'Posted at 9:41 AM',
      failed: false,
      primary: null,
      secondary: null,
    });
    expect(view({ state: 'sent', at, postedAt: at, changed: true }).secondary).toEqual({
      label: 'Update post',
      busy: false,
    });
    expect(view({ state: 'sending', at, postedAt: at, changed: true })).toMatchObject({
      posted: 'Posted at 9:41 AM',
      secondary: { label: 'Updating…', busy: true },
    });
  });

  it("says Couldn't post to Slack. with Try again", () => {
    expect(view({ state: 'failed', at })).toEqual({
      posted: null,
      failed: true,
      primary: null,
      secondary: { label: 'Try again', busy: false },
    });
  });
});

describe('suggestions, links and picks', () => {
  it('turns groups into report rows for the suggestions and finds a typed title', () => {
    expect(carryEntries(todo().groups)[1]).toEqual({
      projectId: 5,
      projectRequestId: null,
      tasks: [
        { title: '1 web blog publish', carriedFromTaskId: null },
        { title: 'Analysing gsc', carriedFromTaskId: null },
      ],
    });
    const items = [{ taskId: 31, title: 'Fix  the Links' }];
    expect(suggestionFor(items, 'fix the links ')).toBe(items[0]);
    expect(suggestionFor(items, 'other')).toBeNull();
    expect(hasTitle(todo().groups[1], ' ANALYSING   gsc')).toBe(true);
  });

  it('knows the priority tasks the lines link to', () => {
    expect([...linkedTaskIds(todo())]).toEqual([7]);
    expect(linkedTaskIds(null).size).toBe(0);
  });

  it('lists every pickable project once, then the pending requests', () => {
    const list = pickables({
      urgent: [{ id: 3, name: 'Pine Tree Lane', color: 'green' }],
      mine: [
        { id: 3, name: 'Pine Tree Lane', color: 'green' },
        { id: 5, name: 'Studio Ubique', color: 'violet' },
      ],
      others: [{ id: 8, name: 'Dotado', color: null }],
      requests: [{ requestId: 4, name: 'Blue Harbour' }],
    });
    expect(list.map((item) => item.key)).toEqual(['p3', 'p5', 'p8', 'r4']);
    expect(list[3]).toEqual({ key: 'r4', name: 'Blue Harbour', request: REQ });
    expect(targetOf(list[1])).toEqual({ projectId: 5 });
    expect(targetOf(list[3])).toEqual({ projectRequestId: 4 });
  });

  it('turns a picker pick into a group head', () => {
    expect(headOfPick({ projectId: 5, name: 'Studio Ubique', color: 'violet' })).toEqual({
      project: SU,
    });
    expect(headOfPick({ projectRequestId: 4, name: 'Blue Harbour', color: null })).toEqual({
      request: REQ,
    });
    expect(addedToTodayText(1)).toBe('Added to today.');
    expect(addedToTodayText(3)).toBe('Added 3 tasks to today.');
  });

  it("offers the picked project's saved lines that aren't done and can take a timer", () => {
    const groups = withLinesAdded(todo(), { project: SU }, [
      pendingLine({ id: 'new9', title: 'Not saved yet' }),
    ]).groups;
    groups[1].lines.push(line(23, 'Running now', { now: true, canStart: false }));
    expect(todoOffers(groups, 5).map((item) => item.id)).toEqual([21, 22]);
    expect(todoOffers(groups, 3)).toEqual([]);
    expect(todoOffers(undefined, 5)).toEqual([]);
  });
});
