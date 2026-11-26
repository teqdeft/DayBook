'use client';
// The task window's right rail (CONTRACT 28, Task window): a `<dl>` of facts, 14 px apart. Assigned
// to: in manage mode the face button with the full name (it opens the people window) and, under
// it on an open task that isn't the viewer's, the text button "Assign to me"; other modes show the
// avatar and name ("(you)" after the viewer's own, the away label). Due, Priority ("critical"
// after P1), Phase (with "Move to phase…" in manage mode on an open task), Time spent ("5h 40m
// from timers"; "Your time" for a viewer who only gets their own minutes; "None yet"), Added by.
// The people window, Assign to me and Move to phase… are the page's task actions
// (useTaskActions); the rail only asks for them.
import { ChevronDown, UserPlus, Users } from 'lucide-react';
import Avatar from '@/components/Avatar';
import PriorityTag from '@/components/PriorityTag';
import DueTag from '@/app/(app)/projects/[id]/DueTag';
import { NO_TIME } from './taskWindowView';
import styles from './TaskWindowRail.module.css';

/** The dashed "Anyone on the project" circle, as on the cards. */
function AnyoneMark() {
  return (
    <span className={styles.anyone} aria-hidden="true">
      <Users size={14} strokeWidth={1.8} />
    </span>
  );
}

/** The person as a picture and a name (every mode but manage). */
function Person({ owner }) {
  if (owner.anyone) {
    return (
      <span className={styles.person}>
        <AnyoneMark />
        {owner.name}
      </span>
    );
  }
  return (
    <span className={`${styles.person} ${owner.away ? styles.awayPerson : ''}`}>
      <Avatar user={owner.person} size={24} />
      {owner.name}
      {owner.you ? ' (you)' : ''}
      {owner.away ? <span className={styles.away}>{owner.away}</span> : null}
    </span>
  );
}

/** The face button that opens the people window (manage mode). */
function FaceButton({ owner, faceRef, onOpen }) {
  const who = owner.anyone ? 'anyone on the project' : owner.name;
  return (
    <button
      ref={faceRef}
      type="button"
      className={`${styles.face} ${owner.away ? styles.awayPerson : ''}`}
      aria-haspopup="dialog"
      aria-label={`Assigned to ${who}. Change person`}
      data-face-button=""
      data-face={owner.anyone ? 'any' : owner.person.id}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {owner.anyone ? <AnyoneMark /> : <Avatar user={owner.person} size={24} />}
      <span>{owner.name}</span>
      {owner.away ? <span className={styles.away}>{owner.away}</span> : null}
      <ChevronDown className={styles.chevron} size={12} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/** Assigned to: the face button (manage mode) or the person, and "Assign to me" under it. */
function Assigned({ facts, faceRef, onPeople, onTake }) {
  return (
    <div className={styles.assigned}>
      <dt>Assigned to</dt>
      <dd>
        {facts.manage ? (
          <FaceButton owner={facts.owner} faceRef={faceRef} onOpen={onPeople} />
        ) : (
          <Person owner={facts.owner} />
        )}
        {facts.assignToMe ? (
          <button
            type="button"
            className={styles.textButton}
            onClick={(event) => onTake(event.currentTarget)}
          >
            <UserPlus size={15} strokeWidth={1.8} aria-hidden="true" />
            Assign to me
          </button>
        ) : null}
      </dd>
    </div>
  );
}

/** Phase, with "Move to phase…" in manage mode on an open task. */
function Phase({ facts, onMove }) {
  return (
    <div>
      <dt>Phase</dt>
      <dd>
        <span>{facts.phase}</span>
        {facts.moveToPhase ? (
          <button
            type="button"
            className={styles.textButton}
            onClick={(event) => onMove(event.currentTarget)}
          >
            Move to phase…
          </button>
        ) : null}
      </dd>
    </div>
  );
}

/** "5h 40m from timers" (the number in Schibsted), or "None yet". */
function Time({ facts }) {
  return (
    <div>
      <dt>{facts.timeLabel}</dt>
      <dd>
        {facts.time ? (
          <span>
            <span className={styles.number}>{facts.time}</span> from timers
          </span>
        ) : (
          <span className={styles.muted}>{NO_TIME}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * @param {{ task: object, facts: object, today: string, faceRef: object,
 *   onPeople: (anchor: HTMLElement) => void, onTake: (button: HTMLElement) => void,
 *   onMove: (button: HTMLElement) => void }} props facts: railFacts(); the handlers are the
 *   page's task actions, used only in manage mode
 */
export default function TaskWindowRail({ task, facts, today, faceRef, onPeople, onTake, onMove }) {
  return (
    <dl className={styles.rail}>
      <Assigned facts={facts} faceRef={faceRef} onPeople={onPeople} onTake={onTake} />
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
          {facts.critical ? <span>critical</span> : null}
        </dd>
      </div>
      <Phase facts={facts} onMove={onMove} />
      <Time facts={facts} />
      {facts.addedBy ? (
        <div>
          <dt>Added by</dt>
          <dd>{facts.addedBy}</dd>
        </div>
      ) : null}
    </dl>
  );
}
