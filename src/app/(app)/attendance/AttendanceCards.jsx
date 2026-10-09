// Attendance page blocks (artboard 09): the "Everyone today" table (Present shows worked time once
// someone took breaks, CONTRACT 15), the correction requests and the missing check-outs. Server
// Components; row actions are small client components.
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import StatusCell from '@/components/StatusCell';
import Tag from '@/components/Tag';
import CorrectionActions from './CorrectionActions';
import RowAction from './RowAction';
import styles from './page.module.css';

const DASH = <span className={styles.dash}>—</span>;

/**
 * Present time; with breaks, worked time over a muted "Breaks 45m" line (like "Late 38m" under
 * the check-in time) and a red "Over 15m" tag past the daily allowance (CONTRACT 15).
 */
function PresentCell({ row }) {
  if (!row.present) return DASH;
  if (!row.breaks) return <span className={styles.time}>{row.present}</span>;
  return (
    <span className={styles.worked} title={row.presentTitle}>
      <span className={styles.time}>{row.present}</span>
      <span className={styles.breaks}>{row.breaks}</span>
      {row.over ? (
        <Tag tone="red" padX={6} className={styles.over}>
          {row.over}
        </Tag>
      ) : null}
    </span>
  );
}

function columns(canCorrect) {
  const list = [
    {
      key: 'person',
      header: 'Person',
      width: 189.67,
      render: (row) => (
        <span className={styles.person}>
          <Avatar user={row.user} size={34} />
          <span className={styles.personText}>
            <span className={styles.personName}>{row.user.name}</span>
            {row.user.designation ? (
              <span className={styles.personRole}>{row.user.designation}</span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      key: 'where',
      header: 'Where',
      width: 105.67,
      render: (row) => (
        <StatusCell status={row.where} size="cellCompact" className={styles.where} />
      ),
    },
    {
      key: 'checkIn',
      header: 'Check-in',
      width: 89.33,
      render: (row) =>
        row.checkIn ? (
          <span className={styles.checkIn}>
            <span className={styles.checkInTime}>{row.checkIn}</span>
            {row.lateMinutes > 0 ? (
              <span className={styles.late}>Late {row.lateMinutes}m</span>
            ) : null}
          </span>
        ) : (
          DASH
        ),
    },
    {
      key: 'out',
      header: 'Out',
      width: 72.67,
      render: (row) =>
        row.checkOut ? (
          <span className={styles.time}>{row.checkOut}</span>
        ) : row.missing ? (
          <span className={styles.missing}>Missing</span>
        ) : (
          DASH
        ),
    },
    {
      key: 'present',
      header: 'Present',
      width: 81,
      render: (row) => <PresentCell row={row} />,
    },
    {
      // The note takes what is left (142 px on the artboard), so a narrower table never squeezes
      // HR's action out of view.
      key: 'note',
      header: 'Note',
      render: (row) =>
        row.note ? (
          <span className={styles.note} title={row.note}>
            {row.note}
          </span>
        ) : (
          <span className={styles.noteDash}>—</span>
        ),
    },
  ];
  if (canCorrect) {
    list.push({
      key: 'action',
      header: <span className="visually-hidden">Action</span>,
      label: 'Action',
      width: 95.66, // the artboard's 776 px table less the columns before it
      render: (row) =>
        row.action ? <RowAction kind={row.action.kind} row={row.action.row} /> : null,
    });
  }
  return list;
}

const EMPTY = {
  all: ['Nobody tracks attendance yet', 'People who check in show up here.'],
  late: ['Nobody was late', 'Everyone checked in on time.'],
  wfh: ['Nobody worked from home', 'Everyone who checked in was at the office.'],
  not_checked_in: ['Everyone checked in', 'Nobody is missing.'],
  unverified: ['Nothing to confirm', 'Every office check-in came from the office network.'],
};

export function EveryoneCard({ data, pills, title }) {
  const [emptyTitle, emptyBody] = EMPTY[data.filter];
  return (
    <Card padding="none" className={styles.everyone}>
      <div className={styles.everyoneHead}>
        <h2 className={styles.cardTitle}>{title}</h2>
        <FilterPills items={pills} value={data.filter} label="Show" className={styles.pills} />
      </div>
      <DataTable
        className={styles.table}
        columns={columns(data.canCorrect)}
        rows={data.rows}
        caption={title}
        empty={
          <EmptyState
            compact
            title={emptyTitle}
            body={emptyBody}
            action={
              data.filter === 'all' ? null : (
                <Link href={pills[0].href} className={styles.emptyLink} scroll={false}>
                  Show everyone
                </Link>
              )
            }
          />
        }
      />
    </Card>
  );
}

export function CorrectionsCard({ corrections }) {
  const { items, total } = corrections;
  return (
    <Card className={styles.corrections}>
      <CardHeader
        title="Correction requests"
        actions={total > 0 ? <Badge label={`${total} waiting`}>{total}</Badge> : null}
      />
      {items.length === 0 ? (
        <p className={styles.sideEmpty}>No requests waiting. People ask from their Today page.</p>
      ) : (
        <ul className={styles.correctionList}>
          {items.map((item) => (
            <li key={item.id} className={styles.correction}>
              <span className={styles.correctionPerson}>
                <Avatar user={item.user} size={30} />
                <span className={styles.correctionName}>{item.user.name}</span>
              </span>
              <p className={styles.correctionTitle} title={item.reason}>
                {item.reason}
              </p>
              <p className={styles.correctionText}>{item.summary}</p>
              {item.own ? (
                <p className={styles.correctionOwn}>
                  Your own request. Another HR person or an Admin decides.
                </p>
              ) : (
                <CorrectionActions id={item.id} name={item.user.name} title={item.reason} />
              )}
            </li>
          ))}
        </ul>
      )}
      {total > items.length ? (
        <p className={styles.sideMore}>{total - items.length} more after these.</p>
      ) : null}
      <p className={styles.sideFoot}>Your reason is saved with every correction.</p>
    </Card>
  );
}

export function MissingCard({ missing }) {
  return (
    <Card className={styles.missingCard}>
      <CardHeader title="Missing check-outs" />
      {missing.items.length === 0 ? (
        <p className={styles.sideEmpty}>None right now.</p>
      ) : (
        <ul className={styles.missingList}>
          {missing.items.map((item) => (
            <li key={item.id} className={styles.missingItem}>
              <span className={styles.missingText}>
                <span className={styles.missingTitle}>{item.title}</span>
                <span className={styles.missingSub}>Marked at midnight</span>
              </span>
              {item.action ? <RowAction kind="fix" row={item.action.row} /> : null}
            </li>
          ))}
        </ul>
      )}
      {missing.total > missing.items.length ? (
        <p className={styles.sideMore}>{missing.total - missing.items.length} more to fix.</p>
      ) : null}
    </Card>
  );
}
