// Ask Daybook (CONTRACT 20): a viewer's question answered by Gemini's smart model with function
// calling over read-only tools that keep to the viewer's scope (scope.js). Who may ask: viewers
// with team.view or attendance.view_all (Admin, PM, HR), while ai.isAvailable('ask'). Questions
// and answers are not stored; ai.generate writes the ai_usage rows and enforces the limits.
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { now, workDate } from '@/lib/time';
import { ai } from '@/modules/ai';
import { settings } from '@/modules/settings';
import { attendanceSummary } from './attendance';
import * as handlers from './handlers';
import { questionPrompt, systemPrompt } from './prompt';
import { loadScope } from './scope';
import { TOOLS } from './tools';

export { TOOLS, TOOL_NAMES } from './tools';
export { askBodySchema, MAX_RANGE_DAYS, MAX_ROWS } from './schemas';

const HANDLERS = {
  list_projects: handlers.listProjects,
  list_people: handlers.listPeople,
  hours_by_project: handlers.hoursByProject,
  hours_by_person: handlers.hoursByPerson,
  report_tasks: handlers.reportTasks,
  attendance_summary: attendanceSummary,
  priority_tasks: handlers.priorityTasks,
};

/**
 * Whether someone may use Ask Daybook at all (whatever the AI settings): team.view or
 * attendance.view_all.
 * @param {{ role: string, status?: string } | null | undefined} user
 * @returns {boolean}
 */
export function canAsk(user) {
  return can(user, 'team.view') || can(user, 'attendance.view_all');
}

/**
 * Whether to show Ask Daybook to this person now: canAsk and ai.isAvailable('ask') (key set,
 * AI on, Ask Daybook on). For the nav item and the /ask page.
 * @param {object | null | undefined} user the session user
 * @returns {Promise<boolean>}
 */
export async function isAvailableFor(user) {
  if (!canAsk(user)) return false;
  return ai.isAvailable('ask');
}

/**
 * Runs one tool for Gemini. Unknown names never get here (ai.generate answers them). A problem
 * the person can fix (a 4xx AppError) goes back as its message; anything else is logged — the
 * tool's name only, never its arguments — and goes back as a plain error, so Gemini can still
 * answer gracefully.
 */
async function runTool(name, args, context) {
  const handler = HANDLERS[name];
  if (!handler) return { error: 'Unknown tool.' };
  try {
    const scope = await context.scope();
    return await handler(args ?? {}, { ...context, scope });
  } catch (error) {
    if (isAppError(error) && error.status < 500) return { error: error.message };
    logger.error({ err: error, tool: name, userId: context.userId }, 'Ask Daybook tool failed');
    return { error: "Daybook couldn't read this data just now." };
  }
}

/** The request context the tools share: settings, today, now and the scope (read once). */
function contextFor(user, values) {
  let scope = null;
  const at = now();
  return {
    userId: user.id,
    tz: values.timezone,
    today: workDate(values.timezone, at),
    at,
    workingDays: values.workingDays,
    scope: () => {
      scope ??= loadScope(user);
      return scope;
    },
  };
}

/**
 * Which scope the viewer gets (the same split as loadScope): 'admin' everything, 'pm' their own
 * projects and the people on them, 'hr' attendance only.
 * @param {{ role: string, status?: string }} user
 * @returns {'admin' | 'pm' | 'hr'}
 */
export function viewerKind(user) {
  if (user.role === 'admin') return 'admin';
  return can(user, 'team.view') ? 'pm' : 'hr';
}

/** The answer as plain text, in case Gemini still used markdown: no bold, headings or "*" bullets. */
function plainAnswer(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^(\s*)[*•]\s+/gm, '$1- ')
    .trim();
}

/**
 * Answers a question about hours, tasks and attendance from Daybook's data.
 * @param {{ user: object, question: string, history?: Array<{ question: string,
 *   answer: string }> }} input user = the session user; question 2–500 characters; history =
 *   this visit's earlier turns, oldest first (at most 4), so follow-ups make sense
 * @returns {Promise<{ answer: string }>}
 * @throws AppError FORBIDDEN (no team.view or attendance.view_all) | AI_OFF | AI_LIMIT | AI_BUSY |
 *   AI_ERROR (see ai.generate)
 */
export async function ask({ user, question, history = [] }) {
  if (!canAsk(user)) throw new AppError('FORBIDDEN');
  const values = await settings.getAll();
  const context = contextFor(user, values);
  const { text } = await ai.generate({
    feature: 'ask',
    userId: user.id,
    model: 'smart',
    system: systemPrompt({
      user,
      kind: viewerKind(user),
      companyName: values.companyName,
      today: context.today,
      timezone: values.timezone,
      workingDays: values.workingDays,
    }),
    prompt: questionPrompt(question, history),
    tools: TOOLS,
    onToolCall: (name, args) => runTool(name, args, context),
  });
  return { answer: plainAnswer(text) };
}
