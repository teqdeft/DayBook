// The Summary tab (CONTRACT 27): the health box and Critical tasks on the left, the AI summary (with
// the AI phase line) on the right. Files, notes, summary text and the AI line are only ever loaded
// for people who can manage the project, so another PM's page (a member of the project or not) has
// none of it in its props or stream: they get the health box and Critical tasks at full width.
// Only the PM view has this tab.
import { getSessionUser } from '@/lib/session';
import { ai } from '@/modules/ai';
import { guardPlanRead } from '@/modules/projectPlan/migrationGuard';
import { projectSummaries } from '@/modules/projectSummaries';
import { projectTasks } from '@/modules/projectTasks';
import CriticalTasksCard, { criticalTasks } from './CriticalTasksCard';
import HealthBox from './HealthBox';
import SummaryCard from './SummaryCard';
import { aiSuggestion } from './summaryView';
import styles from './Overview.module.css';

const NO_DOCUMENTS = { counts: { files: 0, notes: 0 }, summary: null };

/** How many files and notes there are and the summary, or none of it before migration 015. */
function loadSummary(user, projectId) {
  return guardPlanRead(
    async () => {
      const [documents, summary] = await Promise.all([
        projectSummaries.listDocuments({ user, projectId }),
        projectSummaries.getSummary({ user, projectId }),
      ]);
      const files = documents.filter((document) => document.kind === 'file').length;
      return { counts: { files, notes: documents.length - files }, summary };
    },
    () => NO_DOCUMENTS,
  );
}

/** Everything the AI card needs. Only call this for someone who can manage the project. */
async function loadAi(user, project) {
  const [available, { counts, summary }] = await Promise.all([
    ai.isAvailable('project_summary').catch(() => false),
    loadSummary(user, project.id),
  ]);
  return { available, counts, summary };
}

/**
 * The summary as the card needs it: a summary whose files and notes are all gone no longer counts,
 * and neither its text nor its AI line go any further.
 */
function shownSummary({ counts, summary }) {
  return counts.files + counts.notes > 0 ? summary : null;
}

/** The AI summary card with the AI phase line, from what loadAi read. */
function AiCard({ project, plan, aiParts }) {
  const summary = shownSummary(aiParts);
  const suggestion = aiSuggestion({
    summary,
    currentPhase: plan.currentPhase,
    status: project.status,
  });
  return (
    <SummaryCard
      projectId={project.id}
      status={project.status}
      available={aiParts.available}
      counts={aiParts.counts}
      summary={
        summary && {
          body: summary.body,
          stale: summary.stale,
          truncated: summary.truncated,
          sources: summary.sources,
        }
      }
      currentPhase={plan.currentPhase}
      suggestion={suggestion}
    />
  );
}

/**
 * @param {{ head: object, user?: object }} props head: loadProjectHead (PM view: `project`, `plan`,
 *   `forecast`, `today`, `canManage`); user: the session user (read here when left out)
 */
export default async function SummaryTab({ head, user }) {
  const { project, plan, forecast, today, canManage } = head;
  const viewer = user ?? (await getSessionUser());
  const [tasks, aiParts] = await Promise.all([
    projectTasks.listForProject({ viewer, projectId: project.id, status: 'open' }),
    canManage ? loadAi(viewer, project) : null,
  ]);
  return (
    <div className={`${styles.summary} ${aiParts ? '' : styles.single}`}>
      <div className={styles.column}>
        <HealthBox forecast={forecast} />
        <CriticalTasksCard
          projectId={project.id}
          tasks={criticalTasks(tasks)}
          today={today}
          canManage={canManage}
        />
      </div>
      {aiParts ? (
        <div className={styles.column}>
          <AiCard project={project} plan={plan} aiParts={aiParts} />
        </div>
      ) : null}
    </div>
  );
}
