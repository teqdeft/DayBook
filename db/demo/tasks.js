// Gives every report entry its tasks. Each person's reports are walked oldest first; a task that
// is still in progress or blocked continues in the person's next report of the same project as a
// carried task (carried_from_task_id, same first_reported_on), the way carry-over works in the app.
import { TASK_BANK } from './projects.js';
import { VISHAL_DAYS } from './schedule.js';
import { hash } from './calendar.js';

const CHAIN_LENGTHS = [1, 1, 1, 2, 2, 3];

/**
 * Fills `entry.tasks` for every planned report. Explicit tasks (Vishal's September) keep their
 * titles and statuses and are only linked. A generated task that is not carried into the person's
 * next report was finished in its last one, and all generated work is wrapped up on the last report
 * before this week, so the only long-running tasks are the ones on the canvas.
 * @param {Map<string, object[]>} plansByPerson from planAllDays
 */
export function assignTasks(plansByPerson) {
  for (const [key, plans] of plansByPerson) {
    const reports = plans.filter((plan) => !plan.absent && plan.report);
    const boundary = key === 'vishal' ? VISHAL_DAYS.length : 3;
    const closeIndex = reports.findLastIndex((plan) => plan.offset >= boundary);
    const state = { key, open: new Map(), counters: new Map() };
    reports.forEach((plan, index) => {
      const projects = new Set(plan.report.entries.map((entry) => entry.project));
      finishGenerated(state, (chain) => !projects.has(chain.project));
      for (const entry of plan.report.entries) {
        entry.tasks = entry.tasks
          ? linkExplicit(entry, plan, state)
          : generate(entry, plan, state, index === closeIndex);
      }
      if (index === closeIndex) finishGenerated(state, () => true);
    });
  }
}

/** Marks open generated tasks as done in the last report that has them. */
function finishGenerated(state, shouldFinish) {
  for (const [id, chain] of state.open) {
    if (chain.explicit || !shouldFinish(chain)) continue;
    chain.task.status = 'done';
    state.open.delete(id);
  }
}

function linkExplicit(entry, plan, state) {
  return entry.tasks.map(({ title, status }) =>
    track(state, entry.project, plan.date, title, status, { explicit: true }),
  );
}

/** Records a task version and keeps the open-chain map up to date. */
function track(state, project, date, title, status, chain = null) {
  const id = `${project}|${title}`;
  const previous = state.open.get(id);
  const task = {
    title,
    status,
    firstReportedOn: previous ? previous.firstReportedOn : date,
    carriedFrom: previous ? previous.task : null,
  };
  if (status === 'done') state.open.delete(id);
  else {
    state.open.set(id, {
      task,
      project,
      firstReportedOn: task.firstReportedOn,
      seen: (previous?.seen ?? 0) + 1,
      length: chain?.length ?? previous?.length ?? 2,
      explicit: chain?.explicit ?? previous?.explicit ?? false,
    });
  }
  return task;
}

function generate(entry, plan, state, close) {
  const { key } = state;
  const tasks = [];
  const carried = [...state.open.values()].filter((c) => c.project === entry.project).slice(0, 2);
  for (const chain of carried) {
    const finished = close || chain.seen + 1 >= chain.length;
    const status = finished ? 'done' : chain.task.status;
    tasks.push(track(state, entry.project, plan.date, chain.task.title, status));
  }
  const wanted = entry.minutes >= 240 ? 1 + (hash(key, plan.offset, entry.project, 'n') % 2) : 1;
  while (tasks.length < wanted) {
    const title = nextTitle(state, entry.project);
    const length = close
      ? 1
      : CHAIN_LENGTHS[hash(key, plan.offset, title, 'len') % CHAIN_LENGTHS.length];
    let status = length === 1 ? 'done' : 'in_progress';
    if (length > 1 && hash(key, plan.offset, title, 'blocked') % 9 === 0) status = 'blocked';
    tasks.push(track(state, entry.project, plan.date, title, status, { length }));
  }
  return tasks;
}

/** The next title from the project's bank that isn't already an open task for this person. */
function nextTitle(state, project) {
  const bank = TASK_BANK[project] ?? ['Project work'];
  let counter = state.counters.get(project) ?? hash(state.key, project) % bank.length;
  for (let tries = 0; tries < bank.length; tries += 1) {
    const title = bank[counter % bank.length];
    counter += 1;
    if (!state.open.has(`${project}|${title}`)) {
      state.counters.set(project, counter);
      return title;
    }
  }
  state.counters.set(project, counter);
  return `${bank[counter % bank.length]} (part ${counter})`;
}
