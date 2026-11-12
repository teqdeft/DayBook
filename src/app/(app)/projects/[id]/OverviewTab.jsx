// The Overview tab (CONTRACT 22): are we on track? The health box, then Progress, Deadline and Phase,
// then Critical tasks and the AI summary. Files, notes and summary text are only ever loaded for
// people who can manage the project, so another PM's page has none of it in its props or stream: in
// place of the AI summary they get nothing, and Critical tasks takes the width.
import { ai } from '@/modules/ai';
import { guardPlanRead } from '@/modules/projectPlan/migrationGuard';
import { projectSummaries } from '@/modules/projectSummaries';
import { projectTasks } from '@/modules/projectTasks';
import CriticalTasksCard, { criticalTasks } from './CriticalTasksCard';
import DeadlineCard from './DeadlineCard';
import HealthBox from './HealthBox';
import PhaseCard from './PhaseCard';
import ProgressCard from './ProgressCard';
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

/** Everything the AI parts need. Only call this for someone who can manage the project. */
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

/**
 * @param {{ user: object, project: object, plan: object, forecast: object, today: string,
 *   canManage: boolean }} props see loadProjectHead
 */
export default async function OverviewTab({ user, project, plan, forecast, today, canManage }) {
  const [tasks, aiParts] = await Promise.all([
    projectTasks.listForProject({ viewer: user, projectId: project.id, status: 'open' }),
    canManage ? loadAi(user, project) : null,
  ]);
  const summary = aiParts ? shownSummary(aiParts) : null;
  const suggestion = aiSuggestion({
    summary,
    currentPhase: plan.currentPhase,
    status: project.status,
  });

  return (
    <div className={styles.overview}>
      <HealthBox forecast={forecast} />
      <div className={styles.row}>
        <ProgressCard forecast={forecast} />
        <DeadlineCard
          projectId={project.id}
          deadline={plan.deadline}
          today={today}
          canManage={canManage}
        />
        <PhaseCard
          projectId={project.id}
          plan={plan}
          today={today}
          canManage={canManage}
          suggestion={suggestion}
        />
      </div>
      <div className={styles.row}>
        <CriticalTasksCard
          projectId={project.id}
          tasks={criticalTasks(tasks)}
          today={today}
          canManage={canManage}
        />
        {aiParts ? (
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
          />
        ) : null}
      </div>
    </div>
  );
}
