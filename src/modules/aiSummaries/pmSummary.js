// The daily report summary for PMs (CONTRACT 20, worker ai-pm-summary): for each active PM whose
// active projects had a submitted report today, one Gemini request (fast model) about those
// projects. People go to Gemini as "Person 1" tokens with their minutes and task lines; project
// names, task text and numbers go as they are. The names come back in the saved summary, the
// bell and the Slack DM. Projects without a report today are listed by the code itself.
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { formatDay, formatDayShort, formatDuration } from '@/lib/time';
import { ai } from '@/modules/ai';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { slack } from '@/modules/slack';
import { escapeSlackText } from '@/modules/slack/format';
import { users } from '@/modules/users';
import { dayBounds } from './calendar';
import * as repo from './repo';
import { AI_NOTE, bellBody } from './text';
import { logFailure, writeSummary } from './writing';

export const PM_SUMMARY_TITLE = 'Today on your projects';
/** The longest body kept, the "No reports yet" line included (CONTRACT 20). */
export const PM_BODY_MAX = 1500;
const JOB = 'ai-pm-summary';
const QUIET_NAMES_MAX = 12;
const STATUS_TEXT = { done: 'done', in_progress: 'in progress', blocked: 'blocked' };
// No new request starts after this long, so a run fits the cron worker's one-minute slot
// (src/worker/cron.js starts this job in a run's first 15 s and ends a run after 80 s; a request
// may take 30 s). The PMs left are logged and skipped.
const RUN_BUDGET_MS = 25_000;
let runBudgetMs = RUN_BUDGET_MS;

/** Tests only: how long a run may keep starting requests (ms); null restores 25 s. */
export function setRunBudgetForTests(ms) {
  runBudgetMs = ms ?? RUN_BUDGET_MS;
}

const SYSTEM = [
  "You write a project manager's end-of-day summary of their projects in Daybook, a work log app,",
  'from the daily reports their team submitted today. Use only the data given; never add facts,',
  'guesses or advice. Write plain text without Markdown (no **, # or tables): one short opening',
  'sentence, then for each project its name on its own line followed by short "- " lists under',
  'the labels "Done:", "In progress:", "Blocked:" and "Hours:" (leave out a label with nothing',
  'under it). Mention priority tasks with their label (P1, P2 or P3). Write durations exactly as',
  'given, like "2h 15m". Keep the body under 1,200 characters and the title under 80 characters.',
  ai.PEOPLE_TOKEN_NOTE,
].join(' ');

/** Report lines by project, then by person: minutes once per entry, task lines in order. */
function groupByProject(lines) {
  const projects = new Map();
  const counted = new Set();
  for (const line of lines) {
    if (!projects.has(line.projectId)) projects.set(line.projectId, new Map());
    const people = projects.get(line.projectId);
    if (!people.has(line.userId)) {
      people.set(line.userId, { id: line.userId, name: line.userName, minutes: 0, tasks: [] });
    }
    const person = people.get(line.userId);
    if (!counted.has(line.entryId)) {
      counted.add(line.entryId);
      person.minutes += Number(line.minutes) || 0;
    }
    if (line.taskId) {
      const { title, status, priority, firstReportedOn } = line;
      person.tasks.push({ title, status, priority, firstReportedOn });
    }
  }
  return projects;
}

/**
 * What to write for each PM: only PMs with at least one active project reported on today.
 * @returns {Array<{ pm: object, projects: Array<{ name: string, people: object[],
 *   done: object[] }>, quiet: string[] }>} quiet = their active projects without a report
 */
export function planSummaries({ pms, projects, lines, done }) {
  const reported = groupByProject(lines);
  const plans = [];
  for (const pm of pms) {
    const own = projects.filter((project) => project.pmId === pm.id);
    const withReports = own.filter((project) => reported.has(project.id));
    if (withReports.length === 0) continue;
    plans.push({
      pm,
      projects: withReports.map((project) => ({
        name: project.name,
        people: [...reported.get(project.id).values()],
        done: done.filter((task) => task.projectId === project.id),
      })),
      quiet: own.filter((project) => !reported.has(project.id)).map((project) => project.name),
    });
  }
  return plans;
}

function taskView(task, date) {
  return {
    title: task.title,
    status: STATUS_TEXT[task.status] ?? task.status,
    ...(task.priority ? { priority: task.priority.toUpperCase() } : {}),
    ...(task.firstReportedOn && task.firstReportedOn < date
      ? { since: formatDayShort(task.firstReportedOn) }
      : {}),
  };
}

/** The prompt: today's reports on the PM's projects as JSON, people as tokens. */
function promptFor(plan, date, tokenFor) {
  const projects = plan.projects.map((project) => {
    const blocked = project.people.flatMap((person) =>
      person.tasks
        .filter((task) => task.status === 'blocked')
        .map((task) => ({ person: tokenFor(person.id), ...taskView(task, date) })),
    );
    return {
      project: project.name,
      totalHours: formatDuration(project.people.reduce((sum, person) => sum + person.minutes, 0)),
      people: project.people.map((person) => ({
        person: tokenFor(person.id),
        hours: formatDuration(person.minutes),
        tasks: person.tasks.map((task) => taskView(task, date)),
      })),
      ...(blocked.length > 0 ? { blocked } : {}),
      ...(project.done.length > 0
        ? {
            priorityTasksDoneToday: project.done.map(
              (t) => `${t.priority.toUpperCase()} ${t.title}`,
            ),
          }
        : {}),
    };
  });
  const data = { date: formatDay(date), projects };
  return `Daily reports submitted today on the PM's projects (JSON):\n${JSON.stringify(data, null, 1)}`;
}

/** "No reports yet: acme-seo, internal-tool" (at most 12 names, then "and 3 more"). */
function quietLine(names) {
  if (names.length === 0) return '';
  const shown = names.slice(0, QUIET_NAMES_MAX);
  const more = names.length - shown.length;
  return `No reports yet: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

async function writeFor(plan, date) {
  const { tokenFor, names } = ai.pseudonymize(plan.projects.flatMap((project) => project.people));
  const quiet = quietLine(plan.quiet);
  const written = await writeSummary({
    feature: 'pm_summary',
    system: SYSTEM,
    prompt: promptFor(plan, date, tokenFor),
    names,
    maxLength: PM_BODY_MAX - (quiet ? quiet.length + 2 : 0),
    fallbackTitle: PM_SUMMARY_TITLE,
  });
  return { title: written.title, body: quiet ? `${written.body}\n\n${quiet}` : written.body };
}

/** The Slack DM: the full text with a link to the summary page. */
function slackText({ id, date, title, body }) {
  return [
    `*${PM_SUMMARY_TITLE}* · ${formatDayShort(date)}`,
    ...(title === PM_SUMMARY_TITLE ? [] : [`*${escapeSlackText(title)}*`]),
    escapeSlackText(body),
    `<${env.appOrigin}/summaries/${id}|Open in Daybook> · ${AI_NOTE}`,
  ].join('\n\n');
}

/** Saves the summary, rings the bell and queues the Slack DM, in one transaction. */
function deliver({ pm, date, summary }) {
  return db.transaction(async (trx) => {
    const id = await ai.saveSummary(
      { kind: 'pm_daily', recipientId: pm.id, periodFrom: date, periodTo: date, ...summary },
      trx,
    );
    await notifications.notify(
      {
        userIds: [pm.id],
        type: 'ai.pm_summary',
        title: PM_SUMMARY_TITLE,
        body: bellBody(summary.body),
        link: `/summaries/${id}`,
      },
      trx,
    );
    await slack.queueDm(
      {
        slackUserId: pm.slackUserId,
        text: slackText({ id, date, ...summary }),
        settingKey: 'aiSummarySlack',
        relatedType: 'ai_summary',
        relatedId: id,
      },
      trx,
    );
    return id;
  });
}

/**
 * Writes today's summary for each active PM (role pm) whose active projects have at least one
 * submitted report on `date` and who has no summary for `date` yet (so the worker can run it
 * again after a failure): one Gemini request each, saved in ai_summaries ('pm_daily'), a bell
 * notification (ai.pm_summary, link /summaries/<id>) and, with aiSummarySlack, a Slack DM. A
 * failed request is logged and the next PM goes on; once the daily limit is reached (or AI is
 * turned off) the rest are skipped. Never logs the prompt or the answer.
 * @param {string} date 'YYYY-MM-DD', the company's today
 * @returns {Promise<{ sent: number, failed: number, skipped: number }>} PMs who already had
 *   theirs aren't counted
 */
export async function sendPmSummaries(date) {
  const started = performance.now();
  const written = new Set(await ai.summaryRecipients({ kind: 'pm_daily', periodFrom: date }));
  const pms = (await users.listByRole('pm')).filter((pm) => !written.has(Number(pm.id)));
  const projects = await repo.listActiveProjectsOf(pms.map((pm) => pm.id));
  const projectIds = projects.map((project) => project.id);
  const { timezone } = await settings.getAll();
  const [lines, done] = await Promise.all([
    repo.listSubmittedLines(date, projectIds),
    repo.listPriorityDone(projectIds, dayBounds(date, timezone)),
  ]);
  const plans = planSummaries({ pms, projects, lines, done });
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const [index, plan] of plans.entries()) {
    if (index > 0 && performance.now() - started > runBudgetMs) {
      result.skipped = plans.length - index;
      logger.warn({ job: JOB, skipped: result.skipped }, 'PM summaries: out of time, rest skipped');
      break;
    }
    try {
      await deliver({ pm: plan.pm, date, summary: await writeFor(plan, date) });
      result.sent += 1;
    } catch (error) {
      if (logFailure(error, { job: JOB, recipientId: plan.pm.id })) {
        result.skipped = plans.length - index;
        break;
      }
      result.failed += 1;
    }
  }
  return result;
}
