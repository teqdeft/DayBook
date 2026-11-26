'use client';
// Who a card is for (CONTRACT 28, Cards and the card menu): the 24 px face and the first name. For
// the project's PM and Admins it is a button ("Assigned to Simran Kaur. Change person") that opens
// the people window, with a 12 px chevron on hover; another PM sees the face and name only; a
// member reads "For you" or the dashed circle and "Anyone". Someone away shows faded with "Not on
// the project" or "Deactivated". The face itself (`data-face`) is keyed by the person, so a change
// of person swaps it (the old face fades out, the new one fades in) while the button keeps focus.
import { ChevronDown, Users } from 'lucide-react';
import Avatar from '@/components/Avatar';
import cardStyles from './TaskCard.module.css';
import styles from './CardParts.module.css';

/** "Simran" from "Simran Kaur". */
export const firstName = (name) => String(name ?? '').split(' ')[0] || String(name ?? '');

/** The face button's accessible name. */
export function faceLabel(assignee) {
  return assignee
    ? `Assigned to ${assignee.name}. Change person`
    : 'Assigned to anyone on the project. Change person';
}

/** The dashed "Anyone" circle. */
export function AnyoneCircle() {
  return (
    <span className={cardStyles.anyone} aria-hidden="true">
      <Users size={12} strokeWidth={1.8} />
    </span>
  );
}

/** The face, the first name and the away label of a person (PM view). */
function Person({ assignee }) {
  return (
    <>
      <Avatar user={assignee} size={24} className={assignee.away ? styles.away : undefined} />
      <span>{firstName(assignee.name)}</span>
      {assignee.away ? <span className={styles.awayText}>{assignee.away}</span> : null}
    </>
  );
}

/** A member's words: "For you" on their own task, the circle and "Anyone" on an Anyone task. */
function MemberFace({ assignee }) {
  return assignee ? (
    <span className={styles.own}>For you</span>
  ) : (
    <>
      <AnyoneCircle />
      <span>Anyone</span>
    </>
  );
}

/**
 * @param {{ task: object, access: 'manage' | 'team' | 'member',
 *   onOpen?: (button: HTMLElement) => void }} props onOpen: opens the people window anchored to
 *   the face (managers)
 */
export default function CardFace({ task, access, onOpen }) {
  const assignee = task.assignee ?? null;
  const key = assignee ? String(assignee.id) : 'anyone';
  const face = (
    <span key={key} className={styles.faceIn} data-face={key}>
      {access === 'member' ? (
        <MemberFace assignee={assignee} />
      ) : assignee ? (
        <Person assignee={assignee} />
      ) : (
        <>
          <AnyoneCircle />
          <span>Anyone</span>
        </>
      )}
    </span>
  );
  if (access !== 'manage' || !onOpen) return <span className={styles.face}>{face}</span>;
  return (
    <button
      type="button"
      className={styles.face}
      data-face-button=""
      aria-haspopup="dialog"
      aria-label={faceLabel(assignee)}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {face}
      <ChevronDown className={styles.chevron} size={12} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
