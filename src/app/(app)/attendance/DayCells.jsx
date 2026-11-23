// The Everyone table's cells (artboard 09; CONTRACT 25, "The Attendance day screen"): Person,
// Where, Check-in, Out, Present, Note and HR's Action. Server Components; the pieces other
// builders own (BreaksButton B, RowMenu F, ReminderNote D) are client components with
// serialisable props. Each line shows only when it applies, and every new muted line may wrap to
// two lines (never the nowrap of "Late 38m" and "Breaks 45m").
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import StatusCell from '@/components/StatusCell';
import Tag from '@/components/Tag';
import BreaksButton from './BreaksButton';
import ReminderNote from './ReminderNote';
import RowAction from './RowAction';
import RowMenu from './RowMenu';
import styles from './page.module.css';

export const DASH = <span className={styles.dash}>—</span>;
const AUTO_TITLE = 'Auto check-out: no activity after office hours';

/** Avatar, the name (a link to the person month for HR and Admins) and the designation. */
export function PersonCell({ row }) {
  return (
    <span className={styles.person}>
      <Avatar user={row.user} size={34} />
      <span className={styles.personText}>
        {row.personHref ? (
          <Link href={row.personHref} className={`${styles.personName} ${styles.personLink}`}>
            {row.user.name}
          </Link>
        ) : (
          <span className={styles.personName}>{row.user.name}</span>
        )}
        {row.user.designation ? (
          <span className={styles.personRole}>{row.user.designation}</span>
        ) : null}
      </span>
    </span>
  );
}

/** The status block, and a muted line for leave ("First half") or "WFH approved". */
export function WhereCell({ row }) {
  return (
    <span className={styles.where}>
      <StatusCell status={row.where} size="cellCompact" title={row.whereTitle ?? undefined} />
      {row.whereLine ? <span className={styles.mline}>{row.whereLine}</span> : null}
    </span>
  );
}

/** The time, "Late 22m" (effective late) and "4th this month". */
export function CheckInCell({ row }) {
  if (!row.checkIn) return DASH;
  const count = row.lateCount;
  return (
    <span className={styles.stack}>
      <span className={styles.checkInTime}>{row.checkIn}</span>
      {row.late ? <span className={styles.late}>{row.late}</span> : null}
      {count ? (
        <span
          className={`${styles.mline} ${count.alert ? styles.alert : ''}`}
          title={count.title ?? undefined}
        >
          {count.label}
        </span>
      ) : null}
    </span>
  );
}

/** "Auto" and "Early" under the check-out time. */
function OutTags({ row }) {
  if (!row.autoOut && !row.early) return null;
  return (
    <span className={styles.tagsWrap}>
      {row.autoOut ? (
        <Tag tone="neutral" padX={6} className={styles.cellTag} title={AUTO_TITLE}>
          Auto<span className="visually-hidden"> check-out</span>
        </Tag>
      ) : null}
      {row.early ? (
        <Tag tone="marigold" padX={6} className={styles.cellTag} title={row.early.title}>
          <span className="visually-hidden">Left {row.early.minutes} </span>Early
        </Tag>
      ) : null}
    </span>
  );
}

/** The check-out time; "Auto", "Early", "By Priya" and HR's "Check" tag; or red "Missing". */
export function OutCell({ row }) {
  if (!row.checkOut) {
    return row.missing ? <span className={styles.missing}>Missing</span> : DASH;
  }
  const entered = row.enteredBy;
  return (
    <span className={styles.stack}>
      <span className={styles.time}>{row.checkOut}</span>
      <OutTags row={row} />
      {entered ? (
        <span className={styles.mline} title={entered.title}>
          <span className="visually-hidden">Check-out entered </span>By {entered.name}
        </span>
      ) : null}
      {entered?.check ? (
        <span className={styles.tagsWrap}>
          <Tag tone="marigold" padX={6} className={styles.cellTag} title={entered.check.title}>
            Check
          </Tag>
        </span>
      ) : null}
    </span>
  );
}

/** Worked (or present) time, On break since, Breaks, Over and the Half day or Short day tag. */
function PresentLines({ row }) {
  return (
    <>
      <span className={styles.time}>{row.present}</span>
      {row.onBreakSince ? (
        <>
          <span className={styles.tagsWrap}>
            <Tag tone="marigold" padX={6} dot className={styles.cellTag}>
              On break
            </Tag>
          </span>
          <span className={styles.mline}>since {row.onBreakSince}</span>
        </>
      ) : null}
      {row.breaks ? <span className={styles.breaks}>{row.breaks}</span> : null}
      {row.over ? (
        <Tag tone="red" padX={6} className={styles.cellTag}>
          {row.over}
        </Tag>
      ) : null}
      {row.mark ? (
        <span className={styles.tagsWrap}>
          <Tag tone="marigold" padX={6} className={styles.cellTag} title={row.mark.title}>
            {row.mark.label}
          </Tag>
        </span>
      ) : null}
    </>
  );
}

/** The Present cell; the whole cell opens the break list once the row has a break (B). */
export function PresentCell({ row }) {
  if (!row.present) return DASH;
  if (row.attendanceId) {
    return (
      <BreaksButton row={row}>
        <PresentLines row={row} />
      </BreaksButton>
    );
  }
  return (
    <span className={styles.stack} title={row.presentTitle ?? undefined}>
      <PresentLines row={row} />
    </span>
  );
}

export function NoteCell({ row }) {
  if (!row.note) return <span className={styles.noteDash}>—</span>;
  return (
    <span className={styles.note} title={row.note}>
      {row.note}
    </span>
  );
}

/** One line (RowAction and RowMenu), and under it the reminder line (HR and Admin only). */
export function ActionCell({ row }) {
  if (!row.action) return null;
  const { menu, reminder } = row;
  return (
    <span className={styles.act}>
      <span className={styles.actLine}>
        <RowAction kind={row.action.kind} row={row.action.row} />
        {menu ? (
          <RowMenu
            person={menu.person}
            date={menu.date}
            leave={menu.leave}
            remind={menu.remind}
            canMarkLeave={menu.canMarkLeave}
          />
        ) : null}
      </span>
      {reminder ? <ReminderNote reminded={reminder.reminded} nextAt={reminder.nextAt} /> : null}
    </span>
  );
}
