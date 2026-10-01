// One waiting request (artboard 08): who, what they want, their reason, when it was sent, and
// Decline / Approve edit (report edits) or Decline / Create project (new projects).
import Avatar from '@/components/Avatar';
import Card from '@/components/Card';
import Tag from '@/components/Tag';
import { addDays, formatDayShort, formatTimeAmPm, workDate } from '@/lib/time';
import ProjectRequestActions from './ProjectRequestActions';
import ReportEditActions from './ReportEditActions';
import styles from './RequestCard.module.css';

/** "Sent today at 10:12", "Sent yesterday at 5:20 PM", "Sent Mon, 28 Sep at 9:15". */
export function sentLabel(createdAt, tz, today) {
  const day = workDate(tz, createdAt);
  // Morning times read without "AM", as on the canvas; afternoon times keep "PM".
  const time = formatTimeAmPm(createdAt, tz).replace(' AM', '');
  if (day === today) return `Sent today at ${time}`;
  if (day === addDays(today, -1)) return `Sent yesterday at ${time}`;
  return `Sent ${formatDayShort(day)} at ${time}`;
}

export default function RequestCard({ kind, request, tz, today, moveTargets }) {
  const requester = request.requester ?? {};
  const isEdit = kind === 'edit';
  const titleId = `${kind}-request-${request.id}`;
  return (
    <Card as="article" className={styles.card} aria-labelledby={titleId}>
      <div className={styles.head}>
        <Avatar user={requester} size={34} />
        <div className={styles.person}>
          <p className={styles.name}>{requester.name}</p>
          {requester.designation ? (
            <p className={styles.designation}>{requester.designation}</p>
          ) : null}
        </div>
        <Tag tone={isEdit ? 'primary' : 'teal'} size="md" padX={11} className={styles.tag}>
          {isEdit ? 'Report edit' : 'New project'}
        </Tag>
      </div>
      <h2 id={titleId} className={styles.title}>
        {isEdit
          ? `Wants to edit the report for ${formatDayShort(request.workDate)}`
          : `Asked to add a project: ${request.name}`}
      </h2>
      <p className={styles.reason}>{isEdit ? request.reason : request.note}</p>
      <div className={styles.foot}>
        <p className={styles.sent}>{sentLabel(request.createdAt, tz, today)}</p>
        {isEdit ? (
          <ReportEditActions
            request={{
              id: request.id,
              day: formatDayShort(request.workDate),
              requesterName: requester.name,
            }}
          />
        ) : (
          <ProjectRequestActions
            request={{
              id: request.id,
              name: request.name,
              note: request.note,
              hasEntries: Boolean(request.hasEntries),
              requester: {
                id: requester.id,
                name: requester.name,
                initials: requester.initials,
                designation: requester.designation,
                role: requester.role,
                status: requester.status,
                avatarUrl: requester.avatarUrl,
              },
            }}
            moveTargets={request.hasEntries ? moveTargets : []}
          />
        )}
      </div>
    </Card>
  );
}
