// Priority tasks (CONTRACT 13) for the demo projects: what each PM marked P1, P2 or P3, for one
// person or for anyone on the project, a couple already done. Report task lines with a matching
// title on the same project (by the person the task is for, on or after the day it was added) are
// linked to it, the way people pick a priority task in their daily report (a task for anyone can be
// picked by anyone logging hours on the project); Vishal's "Working on backend" lines are his work
// on the leave form API.
//
// `created` and `done` are [working-day offset, local clock] (0 = anchor day). Vishal's My
// projects cards (04) all show a count on the first row and none on the second, so the cards in a
// row keep one height.

export const PRIORITY_TASKS = [
  {
    project: 'iwill',
    title: 'Homepage content changes',
    details: 'Client needs the new homepage copy live today. The copy is in the shared drive.',
    priority: 'p1',
    for: 'vishal',
    created: [0, '11:08'],
    links: ['Content changes'],
  },
  {
    project: 'iwill',
    title: 'SEO meta tags',
    details: null,
    priority: 'p3',
    for: null,
    created: [4, '15:00'],
    links: ['SEO meta tags'],
  },
  {
    project: 'iwill',
    title: 'Contact page',
    details: 'New form fields and the map.',
    priority: 'p2',
    for: 'vishal',
    created: [10, '10:30'],
    links: ['Contact page'],
    done: [9, '18:45'],
  },
  {
    project: 'internal',
    title: 'API for leave form',
    details:
      'Apply, approve and cancel endpoints for the leave form. HR wants to try it next week, so ' +
      'keep the request and response shapes in the API doc up to date as you go.',
    priority: 'p1',
    for: 'vishal',
    created: [6, '10:00'],
    links: ['API for leave form', 'Working on backend'],
  },
  {
    project: 'internal',
    title: 'Permissions check',
    details: 'Check every API route against the roles table before the release.',
    priority: 'p2',
    for: null,
    created: [8, '12:00'],
    links: ['Permissions check'],
  },
  {
    project: 'internal',
    title: 'Session timeout fix',
    details: null,
    priority: 'p3',
    for: 'rohit',
    created: [7, '16:00'],
    links: ['Session timeout fix'],
  },
  {
    project: 'internal',
    title: 'Leave form validation',
    details: null,
    priority: 'p2',
    for: 'vishal',
    created: [6, '10:05'],
    links: ['Leave form validation'],
    done: [5, '18:50'],
  },
  {
    project: 'store',
    title: 'Checkout fix before client demo',
    details: 'Card payments fail on the last step. The demo with Acme Retail is on Friday.',
    priority: 'p1',
    for: 'simran',
    created: [1, '11:00'],
    links: ['Checkout QA'],
  },
  {
    project: 'store',
    title: 'Payment settings page',
    details: 'Waiting on the payment gateway keys from the client.',
    priority: 'p2',
    for: 'vishal',
    created: [5, '09:45'],
    links: ['Payment settings page'],
  },
  {
    project: 'store',
    title: 'Product image zoom',
    details: null,
    priority: 'p3',
    for: null,
    created: [3, '12:00'],
    links: ['Product image zoom'],
  },
  {
    project: 'seo',
    title: 'Monthly ranking report',
    details: 'Acme Retail wants it by the 2nd.',
    priority: 'p1',
    for: 'priya',
    created: [2, '10:00'],
    links: ['Monthly ranking report'],
  },
  {
    project: 'seo',
    title: 'Schema markup',
    details: null,
    priority: 'p3',
    for: null,
    created: [5, '10:00'],
    links: ['Schema markup'],
  },
  {
    project: 'app',
    title: 'Appointment booking API',
    details: null,
    priority: 'p1',
    for: 'rohit',
    created: [5, '11:00'],
    links: ['Appointment booking API'],
  },
  {
    project: 'app',
    title: 'App login screens',
    details: null,
    priority: 'p2',
    for: 'karan',
    created: [5, '11:05'],
    links: ['App login screens'],
    done: [2, '17:30'],
  },
];

const PRIORITY_LABELS = { p1: 'P1', p2: 'P2', p3: 'P3' };

/** Guards against editing mistakes: real projects, members as assignees, valid lengths. */
export function checkPriorityTasks({ projects, people }) {
  const fail = (message) => {
    throw new Error(`Demo priority tasks: ${message}`);
  };
  const byKey = new Map(projects.map((project) => [project.key, project]));
  const active = new Set(
    people.filter((person) => person.status === 'active').map((person) => person.key),
  );
  for (const task of PRIORITY_TASKS) {
    const project = byKey.get(task.project);
    if (!project) fail(`unknown project ${task.project}`);
    if (project.status === 'completed') fail(`${task.title} is on a completed project`);
    if (task.title.length < 2 || task.title.length > 200) fail(`bad title ${task.title}`);
    if (task.details && task.details.length > 1000) fail(`details too long on ${task.title}`);
    if (!PRIORITY_LABELS[task.priority]) fail(`bad priority on ${task.title}`);
    if (task.for && (!project.members.includes(task.for) || !active.has(task.for))) {
      fail(`${task.for} is not an active member of ${project.name}`);
    }
    if (task.done && task.done[0] > task.created[0])
      fail(`${task.title} is done before it was added`);
  }
}

/**
 * project_tasks rows (ids 1..n, in list order) plus what linking needs.
 * @param {{ when: (offset: number, clock: string) => Date, dateOf: (offset: number) => string,
 *   users: Map<string, { id: number }>, projects: Map<string, { id: number, pm: string }> }} ctx
 * @returns {Array<{ row: object, task: object }>}
 */
export function buildPriorityTasks(ctx) {
  return PRIORITY_TASKS.map((task, i) => {
    const project = ctx.projects.get(task.project);
    const pmId = ctx.users.get(project.pm).id;
    const createdAt = ctx.when(...task.created);
    const doneAt = task.done ? ctx.when(...task.done) : null;
    return {
      task,
      row: {
        id: i + 1,
        projectId: project.id,
        title: task.title,
        details: task.details,
        priority: task.priority,
        assigneeId: task.for ? ctx.users.get(task.for).id : null,
        status: task.done ? 'done' : 'open',
        doneAt,
        doneBy: task.done ? pmId : null,
        createdBy: pmId,
        updatedBy: pmId,
        createdAt,
        updatedAt: doneAt ?? createdAt,
      },
      from: ctx.dateOf(task.created[0]),
      until: task.done ? ctx.dateOf(task.done[0]) : null,
    };
  });
}

/**
 * Sets report_tasks.project_task_id on the report lines that worked on a priority task: same
 * project, a title from `links`, written by the person it is for (anyone's for a task for anyone,
 * as the report's task picker offers it), dated from the day it was added until the day it was
 * done.
 * @param {{ reports: object[], entries: object[], tasks: object[] }} rows from buildRows
 * @param {ReturnType<typeof buildPriorityTasks>} priorityTasks
 * @returns {number} how many lines were linked
 */
export function linkReportLines(rows, priorityTasks) {
  const reports = new Map(rows.reports.map((report) => [report.id, report]));
  const entries = new Map(rows.entries.map((entry) => [entry.id, entry]));
  let linked = 0;
  for (const line of rows.tasks) {
    const entry = entries.get(line.entryId);
    const report = reports.get(entry.reportId);
    const match = priorityTasks.find(
      ({ task, row, from, until }) =>
        row.projectId === entry.projectId &&
        task.links.includes(line.title) &&
        (row.assigneeId === null || row.assigneeId === report.userId) &&
        report.workDate >= from &&
        (until === null || report.workDate <= until),
    );
    line.projectTaskId = match ? match.row.id : null;
    if (match) linked += 1;
  }
  return linked;
}

/**
 * The bell lines people got when the open tasks were added (project_task.added): the person it is
 * for, or every active member for a task for anyone. Today's are unread. Desktop pushes are long
 * done (pushed_at = created_at).
 */
export function buildPriorityNotifications(priorityTasks, ctx) {
  const lines = [];
  for (const { task, row } of priorityTasks) {
    if (task.done) continue;
    const project = ctx.projects.get(task.project);
    const pm = ctx.users.get(project.pm);
    const keys = task.for
      ? [task.for]
      : project.members.filter((key) => ctx.users.get(key)?.status === 'active');
    const lead = task.for
      ? `${pm.name} assigned it to you.`
      : `${pm.name} added it for anyone on the project.`;
    for (const key of keys) {
      lines.push({
        userId: ctx.users.get(key).id,
        type: 'project_task.added',
        title: `New ${PRIORITY_LABELS[task.priority]} task on ${project.name}: ${task.title}`,
        body: (task.details ? `${lead} ${task.details}` : lead).slice(0, 500),
        link: '/today',
        readAt: task.created[0] === 0 ? null : ctx.when(task.created[0], '19:30'),
        pushedAt: row.createdAt,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      });
    }
  }
  return lines;
}
