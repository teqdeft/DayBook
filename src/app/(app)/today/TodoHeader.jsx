'use client';
// The to-do card's header (CONTRACT 24): "Today's to-do", muted "2 of 5 done" beside it while it
// has lines, the subtitle, and on the right "Paste a list" (once the list has a project) and the
// Slack button: "Post to Slack", then "Posting…", "Posted at 9:41 AM", "Update post" after the
// list changed (a tick doesn't count) and "Updating…", or "Couldn't post to Slack." with "Try
// again". After submit only the title and "2 of 5 done. Your report is in." stay.
import { CircleAlert, CircleCheck, ClipboardPaste, Send } from 'lucide-react';
import Button from '@/components/Button';
import { doneText, slackView, subtitleOf } from './todoModel';
import styles from './TodoCard.module.css';

/**
 * @param {{ titleId: string, todo: object, locked: boolean, posting: boolean, tz: string,
 *   showPaste: boolean, onPaste: () => void, onPost: () => void }} props todo: the to-do as
 *   shown; posting: a post request is on its way
 */
export default function TodoHeader({
  titleId,
  todo,
  locked,
  posting,
  tz,
  showPaste,
  onPaste,
  onPost,
}) {
  const slack = locked ? null : slackView({ todo, busy: posting, tz });
  const paste = !locked && showPaste;
  return (
    <div className={`${styles.head} ${locked ? styles.headLocked : ''}`}>
      <div className={styles.headText}>
        <div className={styles.titleRow}>
          <h2 id={titleId} className={styles.cardTitle}>
            Today&apos;s to-do
          </h2>
          {!locked && todo.total > 0 ? (
            <span className={styles.count}>{doneText(todo)}</span>
          ) : null}
        </div>
        <p className={styles.subtitle}>{subtitleOf(todo)}</p>
      </div>
      {paste || slack ? (
        <div className={styles.actions}>
          {slack?.posted ? (
            <span className={styles.posted} role="status">
              <CircleCheck size={16} strokeWidth={1.8} aria-hidden="true" />
              {slack.posted}
            </span>
          ) : null}
          {slack?.failed ? (
            <span className={`${styles.posted} ${styles.failed}`} role="alert">
              <CircleAlert size={16} strokeWidth={1.8} aria-hidden="true" />
              Couldn&apos;t post to Slack.
            </span>
          ) : null}
          {paste ? (
            <Button
              variant="secondary"
              size="compact"
              className={styles.headButton}
              icon={<ClipboardPaste size={16} strokeWidth={1.8} aria-hidden="true" />}
              onClick={onPaste}
            >
              Paste a list
            </Button>
          ) : null}
          {slack?.secondary ? (
            <Button
              variant="secondary"
              size="compact"
              className={styles.headButton}
              disabled={slack.secondary.busy}
              onClick={onPost}
            >
              {slack.secondary.label}
            </Button>
          ) : null}
          {slack?.primary ? (
            <Button
              size="compact"
              className={styles.headButton}
              icon={<Send size={16} strokeWidth={1.8} aria-hidden="true" />}
              disabled={slack.primary.busy}
              onClick={onPost}
            >
              {slack.primary.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
