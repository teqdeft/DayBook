// The task window's header line and note (CONTRACT 27 and 28, Task window), drawn from TaskDetails:
// "#8", the project label, the phase and a "Current" tag over the title; the note with its line
// breaks, or "No note.". Plain components without hooks, so tests render them on the server. The
// rail is TaskWindowRail.jsx, Updates and Latest report TaskUpdates.jsx.
import ProjectLabel from '@/components/ProjectLabel';
import Tag from '@/components/Tag';
import { NO_NOTE, isCurrentPhase, phaseText, taskNumber } from './taskWindowView';
import styles from './TaskWindow.module.css';

/** "#8  acme-store  Development  Current" over the title. */
export function TaskContext({ task, currentPhase }) {
  return (
    <div className={styles.context}>
      <span className={styles.number}>{taskNumber(task)}</span>
      <ProjectLabel project={task.project} />
      <span>{phaseText(task.phase)}</span>
      {isCurrentPhase(task, currentPhase) ? (
        <Tag tone="primary" size="sm">
          Current
        </Tag>
      ) : null}
    </div>
  );
}

/** The note, line breaks kept; "No note." muted. */
export function TaskNote({ task, headingId }) {
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} className="visually-hidden">
        Note
      </h3>
      {task.details ? (
        <p className={styles.note}>{task.details}</p>
      ) : (
        <p className={styles.muted}>{NO_NOTE}</p>
      )}
    </section>
  );
}
