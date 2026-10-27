// "Timer lines remember their note" (CONTRACT 21, fix found testing 1.06): a line written by
// "Fill report from timers" keeps the timer note it came from (`timerNote`), so after it is
// reworded (by hand, the top-bar Polish dialog or a line's sparkle) the next fill doesn't add the
// note again. The bug: fill, polish, fill, polish, fill showed "Deploying new features" twice and
// "Deploting new features" once on one card.
import { describe, expect, it } from 'vitest';
import { suggestionToApply } from '@/app/(app)/report/reportLinePolish';
import {
  applySuggestions,
  changedSuggestions,
  polishLineFor,
  polishableLines,
} from '@/app/(app)/report/reportPolish';
import { entriesFromView, newTask, serialize, unlinkTasks } from '@/app/(app)/report/reportState';
import {
  mergeTimerSummary,
  mergeTimerTasks,
  rememberTimerNotes,
} from '@/app/(app)/report/reportTimers';
import { saveReportSchema } from '@/modules/reports/schemas';
import { summarizeDay } from '@/modules/timers/rules';

const TYPO = 'Deploting new features';
const FIXED = 'Deploying new features';

function note(text) {
  return { note: text, projectTaskId: null, priority: null, projectTaskTitle: null };
}

/**
 * A priority task's timer line as the day summary gives it (timers/rules.js summarizeDay): without
 * a note of its own, the note is the task's title.
 */
function linked(projectTaskId, title, text = null) {
  const [project] = summarizeDay([
    {
      projectId: 7,
      projectName: 'acme-app',
      projectColor: 'green',
      isUrgent: false,
      projectTaskId,
      priority: 'p2',
      projectTaskTitle: title,
      note: text,
      minutes: 30,
    },
  ]).projects;
  return project.tasks[0];
}

/** A summary with one project (7, 2h) and these timer tasks. */
function summary(tasks) {
  return {
    projects: [
      {
        projectId: 7,
        projectName: 'acme-app',
        projectColor: 'green',
        isUrgent: false,
        minutes: 120,
        roundedMinutes: 120,
        tasks,
      },
    ],
  };
}

/** Today's report as it opens: project 7 with one empty saved line. */
function openedReport() {
  return entriesFromView({
    entries: [
      {
        id: 100,
        projectId: 7,
        projectRequestId: null,
        projectName: 'acme-app',
        projectColor: 'green',
        minutes: 0,
        tasks: [{ id: 1000, title: '', status: 'in_progress', carriedFromTaskId: null }],
      },
    ],
  });
}

const titles = (rows) => rows[0].tasks.map((task) => task.title);

/** A hand edit of one line's title (TaskLine's onUpdate merges only the title). */
function retitle(rows, key, title) {
  return rows.map((entry) => ({
    ...entry,
    tasks: entry.tasks.map((task) => (task.key === key ? { ...task, title } : task)),
  }));
}

/** The top-bar "Polish my tasks" dialog: every line sent, Gemini fixes the typo, all ticked. */
function polishAll(rows) {
  const sent = polishableLines(rows);
  const answer = sent.map(({ key, title }) => ({ key, title: title.replace(TYPO, FIXED) }));
  return applySuggestions(rows, changedSuggestions(sent, answer)).rows;
}

/** A line's sparkle, then Use (useLinePolish: suggestionToApply, then applySuggestions). */
function polishLine(rows, key) {
  const sent = polishLineFor(rows, key);
  const [suggestion] = changedSuggestions([sent], [{ key, title: FIXED }]);
  const { rows: next, applied } = applySuggestions(rows, [
    suggestionToApply(key, { sent: sent.title, after: suggestion.after }),
  ]);
  expect(applied).toBe(1);
  return next;
}

describe('Fill report from timers after a reworded line (the 1.06 bug)', () => {
  it('fills the line with its timer note, and a second fill after a hand edit adds nothing', () => {
    const filled = mergeTimerSummary(openedReport(), summary([note(TYPO)]));
    expect(titles(filled)).toEqual([TYPO]);
    expect(filled[0].tasks[0]).toMatchObject({ id: 1000, timerNote: TYPO });

    const edited = retitle(filled, filled[0].tasks[0].key, FIXED);
    expect(edited[0].tasks[0].timerNote).toBe(TYPO);
    expect(mergeTimerSummary(edited, summary([note(TYPO)]))).toBe(edited);
  });

  it('adds nothing after the top-bar Polish dialog rewords the line', () => {
    const filled = mergeTimerSummary(openedReport(), summary([note(TYPO)]));
    const polished = polishAll(filled);
    expect(polished[0].tasks[0]).toMatchObject({ title: FIXED, timerNote: TYPO });
    expect(mergeTimerSummary(polished, summary([note(TYPO)]))).toBe(polished);
  });

  it("adds nothing after a line's sparkle suggestion is used", () => {
    const filled = mergeTimerSummary(openedReport(), summary([note(TYPO)]));
    const polished = polishLine(filled, filled[0].tasks[0].key);
    expect(polished[0].tasks[0]).toMatchObject({ title: FIXED, timerNote: TYPO });
    expect(mergeTimerSummary(polished, summary([note(TYPO)]))).toBe(polished);
  });

  it('keeps one line through fill, polish, fill, polish, fill (the screenshot)', () => {
    const timers = summary([note(TYPO)]);
    /** The owner's day; `forget` drops the notes, as lines saved before migration 014 have. */
    function day(forget = (rows) => rows) {
      let rows = forget(mergeTimerSummary(openedReport(), timers));
      rows = forget(polishAll(rows));
      rows = forget(mergeTimerSummary(rows, timers));
      // The second polish: a line's sparkle on each line that still has the typo.
      for (const task of rows[0].tasks) {
        if (task.title === TYPO) rows = forget(polishLine(rows, task.key));
      }
      return mergeTimerSummary(rows, timers);
    }
    expect(titles(day())).toEqual([FIXED]);
    // Without the note the lines were matched by title only: exactly what the owner saw.
    const forget = (rows) => rows.map((entry) => ({ ...entry, tasks: unlinkTasks(entry.tasks) }));
    expect(titles(day(forget))).toEqual([FIXED, FIXED, TYPO]);
  });

  it('matches the note in any case and without outer spaces', () => {
    const [line] = mergeTimerTasks([newTask()], [note(`  ${TYPO} `)]);
    expect(line.timerNote).toBe(TYPO);
    const reworded = [{ ...line, title: 'Shipped the release' }];
    expect(mergeTimerTasks(reworded, [note('deploting NEW features')])).toBe(reworded);
  });

  it('still adds the other notes of the card, and a note whose line was removed', () => {
    const lines = mergeTimerTasks([newTask()], [note(TYPO), note('Code review')]);
    const reworded = [{ ...lines[0], title: FIXED }, lines[1]];
    const next = mergeTimerTasks(reworded, [note(TYPO), note('Code review'), note('Standup')]);
    expect(next.map((line) => [line.title, line.timerNote])).toEqual([
      [FIXED, TYPO],
      ['Code review', 'Code review'],
      ['Standup', 'Standup'],
    ]);
    // Nothing is removed, and Fill brings back what is missing.
    const removed = [reworded[1]];
    expect(mergeTimerTasks(removed, [note(TYPO)]).map((line) => line.title)).toEqual([
      'Code review',
      TYPO,
    ]);
  });

  it("doesn't let a line emptied by hand stand for its note", () => {
    const [line] = mergeTimerTasks([newTask()], [note(TYPO)]);
    // The only line, emptied: it is the card's lone empty line again and takes the note back.
    const emptied = [{ ...line, title: '  ' }];
    const [refilled] = mergeTimerTasks(emptied, [note(TYPO)]);
    expect(refilled).toMatchObject({ key: line.key, title: TYPO, timerNote: TYPO });
    // Next to another line: the note comes back as a new line.
    const other = { ...newTask(), title: 'Standup' };
    const next = mergeTimerTasks([other, { ...line, title: '' }], [note(TYPO)]);
    expect(next.map((item) => item.title)).toEqual(['Standup', '', TYPO]);
  });

  it("doesn't match lines typed by hand by their (missing) note", () => {
    const typed = [{ ...newTask(), title: 'Shipped the release' }];
    expect(typed[0].timerNote).toBeNull();
    const next = mergeTimerTasks(typed, [note(TYPO)]);
    expect(next.map((line) => [line.title, line.timerNote])).toEqual([
      ['Shipped the release', null],
      [TYPO, TYPO],
    ]);
  });
});

describe('timerNote on lines from priority tasks', () => {
  it("is the task's title without a note (the summary's text); the line matches by task", () => {
    expect(linked(55, 'Checkout bug')).toEqual({
      note: 'Checkout bug',
      projectTaskId: 55,
      priority: 'p2',
      projectTaskTitle: 'Checkout bug',
    });
    const [line] = mergeTimerTasks([newTask()], [linked(55, 'Checkout bug')]);
    expect(line).toMatchObject({
      title: 'Checkout bug',
      projectTaskId: 55,
      timerNote: 'Checkout bug',
    });
    const reworded = [{ ...line, title: 'Fixed the checkout bug' }];
    expect(mergeTimerTasks(reworded, [linked(55, 'Checkout bug')])).toBe(reworded);
    // The task is marked done later: the summary gives a plain line with the title as its note
    // (timers/state.js), and the stored title still stands for it, so it isn't added again.
    expect(mergeTimerTasks(reworded, [note('Checkout bug')])).toBe(reworded);
  });

  it('is the note when the timer had one', () => {
    const [line] = mergeTimerTasks([newTask()], [linked(55, 'Checkout bug', 'Card form')]);
    expect(line).toMatchObject({ title: 'Card form', projectTaskId: 55, timerNote: 'Card form' });
    // Unlinked by hand and reworded: the note still stands for it.
    const reworded = [{ ...line, title: 'Card form layout', projectTaskId: null, priority: null }];
    expect(mergeTimerTasks(reworded, [note('Card form')])).toBe(reworded);
  });
});

describe('a card moved to another project', () => {
  it('drops its timer notes with its priority links (unlinkTasks)', () => {
    const lines = mergeTimerTasks(
      [newTask()],
      [note(TYPO), linked(55, 'Checkout bug', 'Card form')],
    );
    const typed = { ...newTask(), title: 'Standup' };
    const tasks = [...lines, typed];
    const moved = unlinkTasks(tasks);
    expect(moved.map((line) => [line.title, line.projectTaskId, line.timerNote])).toEqual([
      [TYPO, null, null],
      ['Card form', null, null],
      ['Standup', null, null],
    ]);
    // Lines with nothing to drop keep their identity; a card without any is returned as is.
    expect(moved[2]).toBe(typed);
    const plain = [typed];
    expect(unlinkTasks(plain)).toBe(plain);
    // So the new project's fill of the same words matches only by title.
    const reworded = moved.map((line, i) => (i === 0 ? { ...line, title: FIXED } : line));
    expect(mergeTimerTasks(reworded, [note(TYPO)]).map((line) => line.title)).toEqual([
      FIXED,
      'Card form',
      'Standup',
      TYPO,
    ]);
  });
});

describe('timerNote travels with the line', () => {
  it('goes out with the save, comes back from the view, and is left out when null', () => {
    const filled = mergeTimerSummary(openedReport(), summary([note(TYPO)]));
    const rows = [
      { ...filled[0], tasks: [...filled[0].tasks, { ...newTask(), title: 'Standup' }] },
    ];
    const { body } = serialize(rows);
    expect(body[0].tasks[0]).toMatchObject({ id: 1000, title: TYPO, timerNote: TYPO });
    expect(JSON.parse(JSON.stringify(body))[0].tasks[1]).not.toHaveProperty('timerNote');

    // The API takes what the page sends: '' or missing mean none.
    const [entry] = saveReportSchema.parse({ entries: body }).entries;
    expect(entry.tasks.map((task) => task.timerNote)).toEqual([TYPO, null]);

    // The view sends it back on every task; the editor rows keep it.
    const back = entriesFromView({
      entries: [
        {
          id: 100,
          projectId: 7,
          projectName: 'acme-app',
          minutes: 120,
          tasks: [
            { id: 1000, title: FIXED, status: 'in_progress', timerNote: TYPO },
            { id: 1001, title: 'Standup', status: 'done', timerNote: null },
            { id: 1002, title: 'Older copy', status: 'done' },
          ],
        },
      ],
    });
    expect(back[0].tasks.map((task) => task.timerNote)).toEqual([TYPO, null, null]);
    expect(serialize(back).body[0].tasks[0].timerNote).toBe(TYPO);
    expect(mergeTimerSummary(back, summary([note(TYPO)]))).toBe(back);
  });

  it('is trimmed by the API, and a note longer than a timer note is refused', () => {
    const parse = (timerNote) =>
      saveReportSchema.safeParse({
        entries: [
          { projectId: 7, minutes: 60, tasks: [{ title: 'A', status: 'done', timerNote }] },
        ],
      });
    expect(parse(`  ${TYPO}  `).data.entries[0].tasks[0].timerNote).toBe(TYPO);
    expect(parse('   ').data.entries[0].tasks[0].timerNote).toBeNull();
    expect(parse(null).data.entries[0].tasks[0].timerNote).toBeNull();
    expect(parse('x'.repeat(200)).success).toBe(true);
    const tooLong = parse('x'.repeat(201));
    expect(tooLong.success).toBe(false);
    expect(tooLong.error.issues[0]).toMatchObject({
      path: ['entries', 0, 'tasks', 0, 'timerNote'],
      message: 'Keep the timer note to 200 characters or fewer.',
    });
    expect(parse(5).success).toBe(false);
  });
});

/** "Fill report from timers" as the page runs it (useTimerFill): notes first, then the merge. */
function fill(rows, timers) {
  return mergeTimerSummary(rememberTimerNotes(rows, timers), timers);
}

/** A saved line of project 7 as the view returns it, without a stored note (before 014). */
function savedLine(id, title, extra = {}) {
  return { id, title, status: 'in_progress', carriedFromTaskId: null, timerNote: null, ...extra };
}

/** The report as it opens with these saved lines on project 7. */
function openedWith(tasks) {
  return entriesFromView({
    entries: [
      {
        id: 100,
        projectId: 7,
        projectName: 'acme-app',
        projectColor: 'green',
        minutes: 120,
        tasks,
      },
    ],
  });
}

const notesOf = (rows) => rows[0].tasks.map((task) => [task.title, task.timerNote]);

describe('a line that says a timer note but has none remembers it on Fill', () => {
  it('a line saved before migration 014 (or carried from one): fill, polish, fill adds nothing', () => {
    const timers = summary([note(TYPO)]);
    const rows = openedWith([savedLine(1, TYPO, { carriedFromTaskId: 9 })]);
    // Without the first step the line stays without a note, and polishing it brings the note back.
    const merged = mergeTimerSummary(rows, timers);
    expect(merged).toBe(rows);
    expect(titles(mergeTimerSummary(polishAll(merged), timers))).toEqual([FIXED, TYPO]);

    const filled = fill(rows, timers);
    expect(notesOf(filled)).toEqual([[TYPO, TYPO]]);
    expect(filled[0].tasks[0]).toMatchObject({ id: 1, key: rows[0].tasks[0].key, carried: true });
    // Nothing else changed: no line added, so the page says the report already matches.
    expect(mergeTimerSummary(filled, timers)).toBe(filled);
    const polished = polishAll(filled);
    expect(notesOf(polished)).toEqual([[FIXED, TYPO]]);
    expect(fill(polished, timers)).toBe(polished);
    // And it goes out with the next save.
    expect(serialize(filled).body[0].tasks[0]).toMatchObject({ id: 1, timerNote: TYPO });
  });

  it('a line typed by hand with the same words (any case) takes the timer note', () => {
    const timers = summary([note(TYPO)]);
    const typed = [{ ...newTask(), title: '  deploting NEW features' }];
    const rows = [{ ...openedReport()[0], tasks: typed }];
    const filled = fill(rows, timers);
    expect(notesOf(filled)).toEqual([['  deploting NEW features', TYPO]]);
    const edited = retitle(filled, typed[0].key, FIXED);
    expect(fill(edited, timers)).toBe(edited);
  });

  it("leaves lines that already stand for the note, other notes' lines and idle projects", () => {
    const timers = summary([note(TYPO), linked(55, 'Checkout bug'), note('Code review')]);
    const rows = [
      {
        ...openedReport()[0],
        tasks: [
          // Filled earlier and reworded: it already remembers TYPO.
          { ...newTask(), title: FIXED, timerNote: TYPO },
          // A typed line that says TYPO too: the note already has its line.
          { ...newTask(), title: TYPO },
          // Linked to the priority task: matched by the task, no note needed.
          { ...newTask(), title: 'Checkout bug', projectTaskId: 55, priority: 'p2' },
          // Says "Code review" but was filled from another note: that note stays.
          { ...newTask(), title: 'Code review', timerNote: 'Standup' },
          // Emptied by hand.
          { ...newTask(), title: '' },
        ],
      },
    ];
    expect(rememberTimerNotes(rows, timers)).toBe(rows);
    expect(rememberTimerNotes(rows, null)).toBe(rows);
    expect(rememberTimerNotes(rows, { projects: [] })).toBe(rows);
    // A project with 0 minutes isn't filled, so nothing is remembered for it either.
    const typed = [{ ...openedReport()[0], tasks: [{ ...newTask(), title: TYPO }] }];
    const idle = { projects: [{ ...summary([note(TYPO)]).projects[0], roundedMinutes: 0 }] };
    expect(rememberTimerNotes(typed, idle)).toBe(typed);
  });

  it('prefers a line without a note of its own, and only the first card of a project', () => {
    const timers = summary([note('Code review')]);
    const first = {
      ...openedReport()[0],
      tasks: [
        { ...newTask(), title: 'Code review', timerNote: 'Standup' },
        { ...newTask(), title: 'code review' },
      ],
    };
    const second = {
      ...first,
      key: 'e-second',
      id: 101,
      tasks: [{ ...newTask(), title: 'Code review' }],
    };
    const next = rememberTimerNotes([first, second], timers);
    expect(notesOf(next)).toEqual([
      ['Code review', 'Standup'],
      ['code review', 'Code review'],
    ]);
    expect(next[0].tasks[0]).toBe(first.tasks[0]);
    expect(next[1]).toBe(second);
  });

  it("the owner's report from the screenshot: remove the old lines, fill once, then polish", () => {
    const timers = summary([note(TYPO)]);
    const rows = openedWith([savedLine(1, FIXED), savedLine(2, FIXED), savedLine(3, TYPO)]);
    // As it is: Fill adds nothing, and the typo line remembers its note.
    const filled = fill(rows, timers);
    expect(mergeTimerSummary(filled, timers)).toBe(filled);
    expect(notesOf(filled)).toEqual([
      [FIXED, null],
      [FIXED, null],
      [TYPO, TYPO],
    ]);
    // Keeping an old "Deploying" line instead brings the note back on every fill.
    const keptOld = [{ ...rows[0], tasks: [rows[0].tasks[0]] }];
    expect(titles(fill(keptOld, timers))).toEqual([FIXED, TYPO]);
    // All three removed: Fill writes one line that remembers its note; polish it, fill again.
    const cleared = [{ ...rows[0], tasks: [{ ...newTask(), title: '' }] }];
    const refilled = fill(cleared, timers);
    expect(notesOf(refilled)).toEqual([[TYPO, TYPO]]);
    const polished = polishAll(refilled);
    expect(titles(polished)).toEqual([FIXED]);
    expect(fill(polished, timers)).toBe(polished);
    // Or keep the typo line itself: fill (it remembers its note), then polish it.
    const keptTypo = [{ ...filled[0], tasks: [filled[0].tasks[2]] }];
    const fixed = polishAll(keptTypo);
    expect(notesOf(fixed)).toEqual([[FIXED, TYPO]]);
    expect(fill(fixed, timers)).toBe(fixed);
  });
});
