// "Changes this month" on the person month (CONTRACT 25, item 8): what HR, Admins and the person
// changed, newest first, each with its details, reason, HR note and time. Server Component.
import Card, { CardHeader } from '@/components/Card';
import styles from './page.module.css';

/** @param {{ changes: object[], more: boolean }} props changes = personMonthData's changes */
export default function PersonChanges({ changes, more }) {
  return (
    <Card className={styles.changes}>
      <CardHeader
        title="Changes this month"
        subtitle="By HR, Admins and the person, with their reasons."
      />
      {changes.length === 0 ? (
        <p className={styles.sideEmpty}>No changes this month.</p>
      ) : (
        <ul className={styles.changeList}>
          {changes.map((change) => (
            <li key={change.id} className={styles.change}>
              <p className={styles.changeTitle}>{change.title}</p>
              {change.details.map((line) => (
                <p key={line} className={styles.changeDetail}>
                  {line}
                </p>
              ))}
              {change.reason ? <p className={styles.changeDetail}>{change.reason}</p> : null}
              {change.note ? <p className={styles.changeDetail}>{change.note}</p> : null}
              <p className={styles.changeTime}>{change.time}</p>
            </li>
          ))}
        </ul>
      )}
      {more ? <p className={styles.sideFoot}>Showing the latest 50.</p> : null}
    </Card>
  );
}
