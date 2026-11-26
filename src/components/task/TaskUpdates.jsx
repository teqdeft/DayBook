// The task window's "Updates (2)" and "Latest report" (CONTRACT 28, Task window; Task number, status
// chip, time and updates per viewer): the newest 10 daily-report lines on the task that the viewer
// may see (members only their own), each a 28 px avatar, "Simran Kaur · Mon, 23 Nov · In progress"
// (the status in its tone) and the line's text; "Showing the newest 10." past 10; "No updates yet.
// They come from the daily reports." without any. Latest report is the first of them, the same
// line as the card's status chip: "In progress · Mon, 23 Nov." then "Simran Kaur: …", or "No report
// on this task yet.". Plain components without hooks, so tests render them on the server.
import Avatar from '@/components/Avatar';
import {
  MORE_UPDATES,
  NO_REPORT,
  NO_UPDATES,
  latestParts,
  updateLine,
  updatesPart,
} from './taskWindowView';
import styles from './TaskWindow.module.css';
import own from './TaskUpdates.module.css';

const TONE_CLASS = { red: styles.red, green: styles.green, primary: styles.primary };

/** One report line on the task. */
function UpdateRow({ update }) {
  const line = updateLine(update);
  const person = { name: update.userName, avatarUrl: update.avatarUrl ?? null };
  return (
    <li className={own.update}>
      <Avatar user={person} size={28} />
      <div className={own.updateText}>
        <span className={own.updateLead}>
          {line.lead}
          <span className={TONE_CLASS[line.tone]}>{line.status}</span>
        </span>
        <p>{line.text}</p>
      </div>
    </li>
  );
}

/** "Updates (2)" with the newest 10 lines. */
export function TaskUpdates({ task, headingId }) {
  const part = updatesPart(task);
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} className={`${styles.heading} ${own.updatesHeading}`}>
        Updates <span className={`${styles.muted} num`}>({part.count})</span>
      </h3>
      {part.shown.length > 0 ? (
        <ul className={own.updates}>
          {part.shown.map((update, at) => (
            <UpdateRow key={`${update.workDate}-${update.userId}-${at}`} update={update} />
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>{NO_UPDATES}</p>
      )}
      {part.more ? <p className={own.small}>{MORE_UPDATES}</p> : null}
    </section>
  );
}

/** "Latest report": the first update in its tone, or "No report on this task yet.". */
export function TaskLatest({ task, headingId }) {
  const latest = task.latestReport ?? task.updates?.[0] ?? null;
  const parts = latestParts(latest);
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading}>
        Latest report
      </h3>
      {parts ? (
        <p>
          <span className={`${TONE_CLASS[parts.tone]} ${own.strong}`}>{parts.head}</span>{' '}
          {parts.text}
        </p>
      ) : (
        <p className={styles.muted}>{NO_REPORT}</p>
      )}
    </section>
  );
}
