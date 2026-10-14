// "Work from home requests" on Attendance (CONTRACT 17), for HR and Admins: pending requests with
// their whole reason and Decline / Approve, then the ones handled in the last 7 days with their
// status (and the expired ones nobody decided in time). The page leaves the card out when both
// are empty. `/attendance#wfh` (the request notification) lands here; after a decision the focus
// comes back to the card (tabIndex -1), as the decided tile goes away.
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import Card, { CardHeader } from '@/components/Card';
import StatusCell from '@/components/StatusCell';
import Tag from '@/components/Tag';
import WfhReason from './WfhReason';
import WfhRequestActions from './WfhRequestActions';
import styles from './WfhRequestsCard.module.css';

const STATUS_LABEL = {
  approved: 'Approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

function PendingRequest({ request }) {
  return (
    <li className={styles.request}>
      <span className={styles.person}>
        <Avatar user={request.user} size={30} />
        <span className={styles.name}>{request.user.name}</span>
        {request.today ? (
          <Tag tone="blue" className={styles.today}>
            Today
          </Tag>
        ) : null}
      </span>
      <p className={styles.days}>{request.days}</p>
      <WfhReason text={request.reason} />
      <p className={styles.sent}>{request.sent}</p>
      {request.own ? (
        <p className={styles.own}>{request.ownNote}</p>
      ) : (
        <WfhRequestActions
          id={request.id}
          name={request.user.name}
          days={request.days}
          reason={request.reason}
        />
      )}
    </li>
  );
}

function HandledRequest({ request }) {
  return (
    <li className={styles.handled}>
      <Avatar user={request.user} size={30} />
      <span className={styles.handledText}>
        <span className={styles.handledName}>{request.user.name}</span>
        <span className={styles.handledDays} title={request.reason}>
          {request.days}
        </span>
        <span className={styles.handledLine} title={request.line}>
          {request.line}
        </span>
      </span>
      <StatusCell
        status={request.status}
        label={STATUS_LABEL[request.status]}
        size="pill"
        className={styles.status}
      />
    </li>
  );
}

/**
 * @param {{ wfh: { waiting: number, pending: object[], handled: object[], more: number } }} props
 *   wfh: wfhCard() in wfhCard.js
 */
export default function WfhRequestsCard({ wfh }) {
  const { waiting, pending, handled, more } = wfh;
  return (
    <Card as="section" id="wfh" aria-labelledby="wfh-title" tabIndex={-1} className={styles.card}>
      <CardHeader
        title={<span id="wfh-title">Work from home requests</span>}
        actions={waiting > 0 ? <Badge label={`${waiting} waiting`}>{waiting}</Badge> : null}
      />
      {pending.length > 0 ? (
        <ul className={styles.requests}>
          {pending.map((request) => (
            <PendingRequest key={request.id} request={request} />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No requests waiting. People ask from their Today page.</p>
      )}
      {handled.length > 0 ? (
        <>
          <h3 className={styles.subhead}>Handled in the last 7 days</h3>
          <ul className={styles.handledList}>
            {handled.map((request) => (
              <HandledRequest key={request.id} request={request} />
            ))}
          </ul>
        </>
      ) : null}
      {more > 0 ? <p className={styles.more}>{more} more after these.</p> : null}
      <p className={styles.foot}>On approved days people can check in as WFH.</p>
    </Card>
  );
}
