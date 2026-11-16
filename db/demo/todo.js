// Today's to-do and the unfinished tasks Daybook suggests (CONTRACT 24, Daybook 1.09). Report
// drafts no longer copy unfinished tasks, so a few lines in past submitted reports are left open
// on purpose: picking their project on Today or in the report suggests them ("Still open from past
// reports"), and Today's reminder line lists them. Ankit's draft today is the to-do he wrote in the
// morning: a ticked line, a line he brought in from yesterday ("From yesterday") and a project he
// planned but hasn't worked on yet (0 hours). The midday state's Vishal has one too (his draft).
// tests/e2e/todo.spec.js marks Deepak's blocked line "Done already".

/** Lines left In progress or Blocked in a submitted report this week, carried on by no later line. */
export const OPEN_LINES = [
  {
    key: 'deepak',
    offset: 2,
    project: 'seo',
    title: 'Redirect map for old URLs',
    status: 'blocked',
  },
  {
    key: 'ankit',
    offset: 2,
    project: 'seo',
    title: 'Schema markup for the product pages',
    status: 'blocked',
  },
  {
    key: 'ankit',
    offset: 1,
    project: 'seo',
    title: 'Internal links for the blog',
    status: 'in_progress',
  },
  {
    key: 'sahil',
    offset: 1,
    project: 'internal',
    title: 'Holiday list import',
    status: 'in_progress',
  },
];

/**
 * Ankit's to-do, added to the lines of his draft today. `carried` brings in his open line of the
 * same title (keeping its status); a project not in the draft yet is planned, at 0 minutes.
 */
export const TODO_TODAY = {
  key: 'ankit',
  lines: [
    { project: 'seo', title: 'Meta titles for the category pages', status: 'done' },
    { project: 'seo', title: 'Internal links for the blog', carried: true },
    { project: 'urbanfit', title: 'Backlink list for the gym pages', status: 'in_progress' },
  ],
};

/** A person's report on a working-day offset, or an error naming what the demo data lacks. */
function reportOf(plansByPerson, key, offset, status) {
  const plan = plansByPerson.get(key)?.find((candidate) => candidate.offset === offset);
  if (!plan?.report || plan.report.status !== status) {
    throw new Error(`Demo data: ${key} has no ${status} report at offset ${offset}`);
  }
  return plan;
}

/**
 * Adds the open lines and today's to-do to the planned reports. Runs after assignTasks, so no
 * generated task continues an open line; rows.js gives the lines their ids, oldest report first,
 * so a carried line can point at its source.
 * @param {Map<string, object[]>} plansByPerson plans with tasks assigned
 */
export function addTodoLines(plansByPerson) {
  const open = new Map();
  for (const line of OPEN_LINES) {
    const plan = reportOf(plansByPerson, line.key, line.offset, 'submitted');
    const entry = plan.report.entries.find((candidate) => candidate.project === line.project);
    if (!entry) {
      throw new Error(`Demo data: ${line.key} logged no ${line.project} at ${line.offset}`);
    }
    const task = { title: line.title, status: line.status, firstReportedOn: plan.date };
    entry.tasks.push(task);
    open.set(`${line.key}|${line.project}|${line.title}`, task);
  }

  const today = reportOf(plansByPerson, TODO_TODAY.key, 0, 'draft');
  for (const line of TODO_TODAY.lines) {
    let entry = today.report.entries.find((candidate) => candidate.project === line.project);
    if (!entry) {
      entry = { project: line.project, minutes: 0, tasks: [] };
      today.report.entries.push(entry);
    }
    const source = line.carried
      ? open.get(`${TODO_TODAY.key}|${line.project}|${line.title}`)
      : null;
    if (line.carried && !source) {
      throw new Error(`Demo data: no open line "${line.title}" to carry`);
    }
    entry.tasks.push({
      title: line.title,
      status: source ? source.status : line.status,
      firstReportedOn: source ? source.firstReportedOn : today.date,
      carriedFrom: source,
    });
  }
}
