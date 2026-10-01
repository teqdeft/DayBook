// "People on this project": everyone with hours in the range and every member without any, with
// their hours, days, first and last report and task counts. Server-safe. Below 1024 px the rows
// become cards, where the two dates and the three counts each share one line.
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import { plural } from '@/lib/text';
import { formatDayShort } from '@/lib/time';
import styles from './PeopleTable.module.css';

const dateOf = (date) => (date ? formatDayShort(date) : '—');

function count(value, tone) {
  const classes = [styles.num, value > 0 ? styles[tone] : styles.zero].join(' ');
  return <span className={classes}>{value}</span>;
}

/** The desktop cell, and the longer text the phone card shows in its place. */
function Responsive({ desktop, phone }) {
  return (
    <>
      <span className={styles.desktopOnly}>{desktop}</span>
      <span className={styles.phoneOnly}>{phone}</span>
    </>
  );
}

/** 'Tue, 29 Sep to Thu, 1 Oct' (one date when both are the same day) for the phone card. */
function reportsLine(row) {
  if (!row.firstOn) return 'None yet';
  return row.firstOn === row.lastOn
    ? dateOf(row.firstOn)
    : `${dateOf(row.firstOn)} to ${dateOf(row.lastOn)}`;
}

/** The line under the name: the designation, after "Deactivated" for someone who has left. */
function personSub(user) {
  const parts = [user.status === 'deactivated' ? 'Deactivated' : null, user.designation];
  return parts.filter(Boolean).join(' · ');
}

// The person cell is the Team board's: avatar, name, and the designation under it. A member
// without hours in the range keeps their row; its numbers step back (0h, dashes).
const COLUMNS = [
  {
    key: 'person',
    header: 'Person',
    width: '30%',
    render: (row) => (
      <div className={styles.person}>
        <Avatar user={row.user} size={34} />
        <div className={styles.personText}>
          <Link href={row.user.href} className={styles.name}>
            {row.user.name}
          </Link>
          {personSub(row.user) ? <span className={styles.sub}>{personSub(row.user)}</span> : null}
        </div>
      </div>
    ),
  },
  {
    key: 'hours',
    header: 'Hours',
    width: '9%',
    render: (row) => <span className={styles.strong}>{row.hours}</span>,
  },
  {
    key: 'days',
    header: 'Days worked',
    width: '11%',
    render: (row) => <span className={styles.num}>{row.days}</span>,
  },
  {
    key: 'first',
    header: 'First report',
    label: 'Reports',
    width: '12%',
    render: (row) => (
      <Responsive
        desktop={<span className={styles.text}>{dateOf(row.firstOn)}</span>}
        phone={<span className={styles.text}>{reportsLine(row)}</span>}
      />
    ),
  },
  {
    key: 'last',
    header: 'Last report',
    width: '12%',
    hideOnMobile: true,
    render: (row) => <span className={styles.text}>{dateOf(row.lastOn)}</span>,
  },
  {
    key: 'done',
    header: 'Done',
    label: 'Tasks',
    width: '7%',
    render: (row) => (
      <Responsive
        desktop={count(row.tasksDone, 'green')}
        phone={
          <span className={styles.text}>
            {`${row.tasksDone} done, ${row.tasksInProgress} in progress, ${row.tasksBlocked} blocked`}
          </span>
        }
      />
    ),
  },
  {
    key: 'inProgress',
    header: 'In progress',
    width: '10%',
    hideOnMobile: true,
    render: (row) => count(row.tasksInProgress, 'primary'),
  },
  {
    key: 'blocked',
    header: 'Blocked',
    width: '9%',
    hideOnMobile: true,
    className: styles.lastHidden,
    render: (row) => count(row.tasksBlocked, 'red'),
  },
];

/**
 * @param {{ rows: object[], members: number, people: number }} props byPerson rows of the report
 */
export default function PeopleTable({ rows, members, people }) {
  const summary = [
    `${people} ${plural(people, 'person', 'people')} logged hours`,
    `${members} ${plural(members, 'member')}`,
  ].join(', ');
  return (
    <Card padding="none" className={styles.card}>
      <CardHeader title="People on this project" actions={summary} divider />
      <DataTable
        caption="People on this project"
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.user.id}
        rowClassName={(row) => (row.noHours ? styles.quiet : undefined)}
        empty={
          <EmptyState
            title="Nobody on this project yet"
            body="Add members to the project, or wait for the first report on it."
          />
        }
      />
    </Card>
  );
}
