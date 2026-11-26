// The project page's header (CONTRACT 27 and 28): the breadcrumb "Projects › acme-store", the square,
// the name and the tags, the subtitle and the page's button. The PM view shows the health tag and the
// urgent note; the member view only the Urgent tag (no health, no note). A Completed project's
// "Completed" tag fades away when the project is reopened (ReopenProject's CompletedTag).
// Server-safe.
import ProjectSquare from '@/components/ProjectSquare';
import Tag from '@/components/Tag';
import TopBar from '@/components/TopBar';
import { healthTone } from '@/modules/projectPlan/forecast';
import { CompletedTag } from './_board/ReopenProject';
import styles from './page.module.css';

function Subtitle({ project, member }) {
  const parts = [project.clientName, project.pmName ? `PM: ${project.pmName}` : null];
  return (
    <>
      {[...parts, project.statusLabel].filter(Boolean).join(' · ')}
      {project.isUrgent && !member ? (
        <span className={styles.urgent}>
          {' · '}
          {project.urgentNote ? `Urgent: ${project.urgentNote}` : 'Urgent'}
        </span>
      ) : null}
    </>
  );
}

/** The health tag; a Completed project's goes once the page shows it reopened. */
function HealthTag({ forecast }) {
  const tag = (
    <Tag tone={healthTone(forecast.kind)} size="md">
      {forecast.pill}
    </Tag>
  );
  if (forecast.kind !== 'completed') return tag;
  return <CompletedTag className={styles.fading}>{tag}</CompletedTag>;
}

/**
 * @param {{ project: object, forecast?: { kind: string, pill: string } | null,
 *   member?: boolean, actions?: import('react').ReactNode }} props project: the head's (with
 *   `statusLabel`); forecast: the PM view's health (never for a member); actions: the header's
 *   button (NewTaskButton's HeaderAction)
 */
export default function ProjectHeader({ project, forecast, member = false, actions }) {
  return (
    <TopBar
      breadcrumb={[{ label: 'Projects', href: '/projects' }, { label: project.name }]}
      title={
        <span className={styles.title}>
          <ProjectSquare project={project} size={36} className={styles.square} />
          <span className={styles.name}>{project.name}</span>
          {forecast && !member ? <HealthTag forecast={forecast} /> : null}
          {project.isUrgent ? (
            <Tag tone="marigold" size="md">
              Urgent
            </Tag>
          ) : null}
        </span>
      }
      subtitle={<Subtitle project={project} member={member} />}
      actions={actions}
    />
  );
}
