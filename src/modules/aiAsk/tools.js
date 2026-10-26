// The read-only tools Gemini may call for Ask Daybook (CONTRACT 20), as function declarations
// (parameters are JSON schemas). Every tool is declared for every viewer; one the viewer can't
// use answers { error: 'not allowed' } (handlers.js).

const date = (what) => ({
  type: 'string',
  description: `${what} company date, YYYY-MM-DD (inclusive). At most 366 days in a range.`,
});
const projectName = {
  type: 'string',
  description: 'Only this project (its name, as the person wrote it).',
};
const personName = {
  type: 'string',
  description: 'Only this person (their name, as the person wrote it).',
};
const range = { from: date('First'), to: date('Last') };

export const TOOLS = Object.freeze([
  {
    name: 'list_projects',
    description:
      'Projects the person asking can see: name, client, project manager, status (active, on hold, completed) and whether it is marked urgent.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'on_hold', 'completed', 'all'] },
      },
    },
  },
  {
    name: 'list_people',
    description:
      'People the person asking can see: name, role, designation, department and whether they are deactivated.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'hours_by_project',
    description:
      'Hours logged per project in submitted daily reports between two dates, with how many people and days. Largest first.',
    parameters: {
      type: 'object',
      properties: { ...range, projectName },
      required: ['from', 'to'],
    },
  },
  {
    name: 'hours_by_person',
    description:
      'Hours each person logged per project in submitted daily reports between two dates, with totals per person.',
    parameters: {
      type: 'object',
      properties: { ...range, personName, projectName },
      required: ['from', 'to'],
    },
  },
  {
    name: 'report_tasks',
    description:
      "Task lines from submitted daily reports between two dates: the latest status of each task (done, in progress, blocked), who reported it, on which project and day, and its priority (P1-P3) when linked to a project's priority task.",
    parameters: {
      type: 'object',
      properties: {
        ...range,
        projectName,
        personName,
        status: { type: 'string', enum: ['done', 'in_progress', 'blocked'] },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'attendance_summary',
    description:
      'Attendance per person between two dates: days checked in (office, work from home), late days and total late time, worked and break time, average check-in, missing and automatic check-outs, working days without a check-in. For one person over at most 31 days it also lists each day.',
    parameters: {
      type: 'object',
      properties: { ...range, personName },
      required: ['from', 'to'],
    },
  },
  {
    name: 'priority_tasks',
    description:
      "Projects' priority tasks (P1 highest, then P2, P3): title, project, priority, open or done, who it is assigned to, when it was added and done.",
    parameters: {
      type: 'object',
      properties: { projectName, status: { type: 'string', enum: ['open', 'done'] } },
    },
  },
]);

export const TOOL_NAMES = Object.freeze(TOOLS.map((tool) => tool.name));
