'use client';
// The bell dropdown's list (CONTRACT 20): loading rows, an error with Try again, "You're all caught
// up", or the notifications with their actions.
import NotificationItem from './NotificationItem';
import styles from './NotificationBell.module.css';

/**
 * @param {{ status: 'idle' | 'loading' | 'error', items: any[] | null, today: string, tz: string,
 *   actions: { open: Function, toggleRead: Function, remove: Function }, onRetry: () => void }} props
 */
export default function NotificationList({ status, items, today, tz, actions, onRetry }) {
  if (status === 'error' && !items) {
    return (
      <div className={styles.message}>
        <p className={styles.messageTitle}>Couldn&apos;t load notifications</p>
        <button type="button" className={styles.retry} onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (!items) {
    return (
      <ul className={styles.list} aria-busy="true" aria-label="Loading notifications">
        {[0, 1, 2].map((i) => (
          <li key={i} className={styles.skeletonRow}>
            <span className={styles.skeletonLine} />
            <span className={`${styles.skeletonLine} ${styles.short}`} />
          </li>
        ))}
      </ul>
    );
  }
  if (items.length === 0) {
    return (
      <div className={styles.message}>
        <p className={styles.messageTitle}>You&apos;re all caught up</p>
        <p className={styles.messageBody}>Requests, reminders and approvals show up here.</p>
      </div>
    );
  }
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <NotificationItem
          key={item.id}
          item={item}
          today={today}
          tz={tz}
          onOpen={actions.open}
          onToggleRead={actions.toggleRead}
          onDelete={actions.remove}
        />
      ))}
    </ul>
  );
}
