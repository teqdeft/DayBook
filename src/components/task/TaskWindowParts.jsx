'use client';
// The task window's content (CONTRACT 27, Task window), drawn from TaskDetails: the header's
// project and phase line, the facts (Owner, Due, Priority, Added by), the note and the latest
// report. Plain components without hooks, so tests render them on the server.
import { Users } from 'lucide-react';
import Avatar from '@/components/Avatar';
import PriorityTag from '@/components/PriorityTag';
import ProjectLabel from '@/components/ProjectLabel';
import Tag from '@/components/Tag';
import DueTag from '@/app/(app)/projects/[id]/DueTag';
import {
  NO_NOTE,
  NO_REPORT,
  addedByText,
  isCurrentPhase,
  ownerFact,
  phaseText,
  reportParts,
} from './taskWindowView';
import styles from './TaskWindow.module.css';

/** "acme-store  Development  Current" over the title. */
export function TaskContext({ task, currentPhase }) {
  return (
    <div className={styles.context}>
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

function Owner({ task }) {
  const owner = ownerFact(task);
  if (owner.anyone) {
    return (
      <>
        <span className={styles.anyone} aria-hidden="true">
          <Users size={14} strokeWidth={1.8} />
        </span>
        {owner.name}
      </>
    );
  }
  return (
    <>
      <Avatar user={owner.person} size={26} />
      {owner.name}
      {owner.away ? <span className={styles.away}>{owner.away}</span> : null}
    </>
  );
}

/** Owner, Due, Priority and Added by, two columns (one on a phone, label left). */
export function TaskFacts({ task, today }) {
  const added = addedByText(task);
  return (
    <dl className={styles.facts}>
      <div>
        <dt>Owner</dt>
        <dd>
          <Owner task={task} />
        </dd>
      </div>
      <div>
        <dt>Due</dt>
        <dd>
          <DueTag dueDate={task.dueDate} today={today} done={task.status === 'done'} />
        </dd>
      </div>
      <div>
        <dt>Priority</dt>
        <dd>
          <PriorityTag priority={task.priority} />
          {task.priority === 'p1' ? <span>critical</span> : null}
        </dd>
      </div>
      {added ? (
        <div>
          <dt>Added by</dt>
          <dd>{added}</dd>
        </div>
      ) : null}
    </dl>
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

const TONE_CLASS = { red: styles.red, green: styles.green, primary: styles.primary };

/** "Simran, Fri, 20 Nov: In progress" (Blocked in red); members see only their own line. */
export function TaskReport({ task, today, headingId }) {
  const parts = reportParts(task.latestReport, today);
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading}>
        Latest report
      </h3>
      {parts ? (
        <p>
          {parts.lead}: <span className={TONE_CLASS[parts.tone]}>{parts.status}</span>
        </p>
      ) : (
        <p className={styles.muted}>{NO_REPORT}</p>
      )}
    </section>
  );
}
