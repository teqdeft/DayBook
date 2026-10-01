// "Recently handled": the last 10 decisions on report edits and project requests.
import Avatar from '@/components/Avatar';
import Card, { CardHeader } from '@/components/Card';
import StatusCell from '@/components/StatusCell';
import { formatDayMonthShort } from '@/lib/time';
import styles from './page.module.css';

const LIMIT = 10;

function toItems(edits, projectRequests) {
  const items = [
    ...edits.map((request) => ({
      key: `edit-${request.id}`,
      person: request.requester,
      text: `${request.requester?.name}, report for ${formatDayMonthShort(request.workDate)}`,
      status: request.status === 'approved' ? 'approved' : 'declined',
      handledAt: request.handledAt,
    })),
    ...projectRequests.map((request) => ({
      key: `project-${request.id}`,
      person: request.requester,
      text: `${request.requester?.name}, project ${request.projectName ?? request.name}`,
      status: request.status === 'approved' ? 'created' : 'declined',
      handledAt: request.handledAt,
    })),
  ];
  return items
    .sort((a, b) => new Date(b.handledAt ?? 0) - new Date(a.handledAt ?? 0))
    .slice(0, LIMIT);
}

export default function RecentlyHandled({ edits, projectRequests }) {
  const items = toItems(edits, projectRequests);
  return (
    <Card className={styles.handledCard}>
      <CardHeader title="Recently handled" className={styles.handledHeader} />
      {items.length > 0 ? (
        <ul className={styles.handledList}>
          {items.map((item) => (
            <li key={item.key} className={styles.handledRow}>
              <Avatar user={item.person} size={30} />
              <span className={styles.handledText}>{item.text}</span>
              <StatusCell status={item.status} size="pill" className={styles.handledStatus} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.handledEmpty}>Your decisions on requests show up here.</p>
      )}
    </Card>
  );
}
