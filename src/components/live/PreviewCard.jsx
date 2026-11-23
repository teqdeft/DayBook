'use client';
// One preview card (CONTRACT 26): a single new notification (its icon, title, body, time, Open,
// Mark as read and Dismiss) or the summary of a batch of 3 or more ("3 new notifications", See
// them, Mark these as read). The text is exactly the bell's: the row's title and body as stored
// and the time as the bell writes it. Cards never take focus when they appear.
import { useId } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  Clock,
  FileText,
  FolderKanban,
  ListTodo,
  Sparkles,
  Timer,
  X,
} from 'lucide-react';
import { alertGroup } from '@/modules/notifications/alerts';
import { BellIcon } from '../NotificationBell';
import { isInAppLink, itemTime } from '../NotificationBell.list';
import { seeLabel, summaryMore, summaryTitle } from './liveRules';
import styles from './PreviewStack.module.css';

const GROUP_ICONS = {
  attendance: Clock,
  calendar: CalendarDays,
  project: FolderKanban,
  task: ListTodo,
  report: FileText,
  timer: Timer,
  ai: Sparkles,
};

/** The tile's icon by the type's group; system and anything else get the bell's own bell. */
function TypeIcon({ type }) {
  const Icon = GROUP_ICONS[alertGroup(type)];
  return Icon ? <Icon size={18} strokeWidth={1.8} aria-hidden="true" /> : <BellIcon size={18} />;
}

function Time({ item, tz, today }) {
  const text = itemTime(item, tz, today);
  if (!text) return null;
  return (
    <time className={styles.time} dateTime={String(item.createdAt)}>
      {text}
    </time>
  );
}

function Dismiss({ titleId, onAction }) {
  return (
    <button
      type="button"
      className={styles.close}
      onClick={(event) => onAction('dismiss', event)}
      aria-label="Dismiss"
      aria-describedby={titleId}
    >
      <X size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

function SingleCard({ item, tz, today, onAction }) {
  const titleId = useId();
  const bodyId = useId();
  const hasBody = Boolean(item.body);
  // A middle click opens a new tab (the browser's), and still marks it read.
  const onAuxClick = (event) => {
    if (event.button === 1) onAction('open', event);
  };
  return (
    <article
      className={styles.card}
      aria-labelledby={titleId}
      aria-describedby={hasBody ? bodyId : undefined}
    >
      <span className={styles.tile} aria-hidden="true">
        <TypeIcon type={item.type} />
      </span>
      <div className={styles.text}>
        <p className={styles.title} id={titleId}>
          {item.title}
        </p>
        {hasBody ? (
          <p className={styles.body} id={bodyId}>
            {item.body}
          </p>
        ) : null}
        <Time item={item} tz={tz} today={today} />
        <div className={styles.actions}>
          {isInAppLink(item.link) ? (
            <Link
              href={item.link}
              className={styles.open}
              onClick={(event) => onAction('open', event)}
              onAuxClick={onAuxClick}
              aria-describedby={titleId}
            >
              Open
            </Link>
          ) : null}
          <button
            type="button"
            className={styles.read}
            onClick={(event) => onAction('read', event)}
            aria-describedby={titleId}
          >
            Mark as read
          </button>
        </div>
      </div>
      <Dismiss titleId={titleId} onAction={onAction} />
    </article>
  );
}

function SummaryCard({ entry, tz, today, maxCards, hasBell, onAction }) {
  const titleId = useId();
  const bodyId = useId();
  const count = entry.items.length;
  const newest = entry.items[0];
  const see = seeLabel(count, maxCards, hasBell);
  return (
    <article className={styles.card} aria-labelledby={titleId} aria-describedby={bodyId}>
      <span className={styles.tile} aria-hidden="true">
        <BellIcon size={18} />
      </span>
      <div className={styles.text}>
        <p className={styles.title} id={titleId}>
          {summaryTitle(count, entry.more)}
        </p>
        <div id={bodyId}>
          <p className={styles.newest}>{newest.title}</p>
          <p className={styles.more}>{summaryMore(count, entry.more)}</p>
        </div>
        <Time item={newest} tz={tz} today={today} />
        <div className={styles.actions}>
          {see ? (
            <button
              type="button"
              className={styles.open}
              onClick={(event) => onAction('see', event)}
              aria-describedby={titleId}
            >
              {see}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.read}
            onClick={(event) => onAction(entry.more ? 'read-all' : 'read-many', event)}
            aria-describedby={titleId}
          >
            {entry.more ? 'Mark all as read' : 'Mark these as read'}
          </button>
        </div>
      </div>
      <Dismiss titleId={titleId} onAction={onAction} />
    </article>
  );
}

/**
 * @param {{ entry: { key: string, kind: 'single' | 'summary', items: object[], more?: boolean },
 *   tz: string, today: string, maxCards: number, hasBell: boolean,
 *   onAction: (action: 'open' | 'read' | 'dismiss' | 'see' | 'read-many' | 'read-all',
 *   event: object) => void }} props
 */
export default function PreviewCard({ entry, tz, today, maxCards, hasBell, onAction }) {
  if (entry.kind === 'summary') {
    return (
      <SummaryCard
        entry={entry}
        tz={tz}
        today={today}
        maxCards={maxCards}
        hasBell={hasBell}
        onAction={onAction}
      />
    );
  }
  return <SingleCard item={entry.items[0]} tz={tz} today={today} onAction={onAction} />;
}
