// The month view's table (CONTRACT 25, item 4): one row per person with their payroll month's
// numbers, each with its muted lines, under the filter pills, and the rules line under it. Below
// 1280 px each row is a card (DataTable's stackBelow), so no column hides off to the side.
// Server Component. Numbers use the heading font, tabular; a muted line is 12 px and may wrap.
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Card from '@/components/Card';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import Tag from '@/components/Tag';
import styles from './page.module.css';

const DASH = <span className={styles.dash}>—</span>;

/** A muted line (12 px); `tone` red or marigold for the lines that need attention. */
function Line({ children, tone }) {
  if (!children) return null;
  return <span className={`${styles.mline} ${tone ? styles[tone] : ''}`}>{children}</span>;
}

/** The big number and the muted lines under it. */
function Stack({ value, red, children }) {
  return (
    <span className={styles.stack}>
      <span className={`${styles.num} ${red ? styles.numRed : ''}`}>{value}</span>
      {children}
    </span>
  );
}

function PersonCell({ row }) {
  return (
    <span className={styles.person}>
      <Avatar user={row.user} size={34} />
      <span className={styles.personText}>
        <Link href={row.personHref} className={styles.personName}>
          {row.user.name}
        </Link>
        {row.user.designation ? (
          <span className={styles.personRole}>{row.user.designation}</span>
        ) : null}
        {row.look ? (
          <>
            <span className={styles.tagsWrap}>
              <Tag tone="marigold" padX={8} className={styles.lookTag}>
                Needs a look
              </Tag>
            </span>
            <Line>{row.look}</Line>
          </>
        ) : null}
        <Line>{row.employment}</Line>
      </span>
    </span>
  );
}

function CheckoutsCell({ lines }) {
  if (!lines) return DASH;
  return (
    <span className={styles.stack}>
      {lines.missing ? <span className={styles.missing}>{lines.missing}</span> : null}
      <Line>{lines.notFixed}</Line>
      <Line>{lines.auto}</Line>
      <Line>{lines.self}</Line>
      <Line tone="marigold">{lines.check}</Line>
    </span>
  );
}

const COLUMNS = [
  { key: 'person', header: 'Person', width: 230, render: (row) => <PersonCell row={row} /> },
  {
    key: 'present',
    header: 'Present',
    render: ({ present: p }) => (
      <Stack value={p.value}>
        <Line>{p.of}</Line>
        <Line>{p.split}</Line>
        <Line>{p.daysOff}</Line>
        <Line>{p.holidays}</Line>
      </Stack>
    ),
  },
  {
    key: 'leave',
    header: 'Leave',
    render: ({ leave }) =>
      leave ? (
        <Stack value={leave.value}>
          <Line>{leave.split}</Line>
          <Line>{leave.planned}</Line>
        </Stack>
      ) : (
        DASH
      ),
  },
  {
    key: 'absent',
    header: 'Absent',
    render: ({ absent }) => (absent ? <Stack value={absent} red /> : DASH),
  },
  {
    key: 'late',
    header: 'Late',
    render: ({ late }) =>
      late ? (
        <Stack value={late.value}>
          <Line>{late.time}</Line>
        </Stack>
      ) : (
        DASH
      ),
  },
  {
    key: 'short',
    header: 'Short days',
    render: ({ short }) =>
      short ? (
        <Stack value={short.value}>
          <Line>{short.half}</Line>
          <Line>{short.early}</Line>
        </Stack>
      ) : (
        DASH
      ),
  },
  {
    key: 'worked',
    header: 'Worked',
    render: ({ worked }) => (
      <Stack value={worked.value}>
        <Line>{worked.breaks}</Line>
        {worked.over ? (
          <span className={styles.tagsWrap}>
            <Tag tone="red" padX={6} className={styles.cellTag}>
              {worked.over}
            </Tag>
          </span>
        ) : null}
      </Stack>
    ),
  },
  {
    key: 'checkouts',
    header: 'Check-outs',
    render: ({ checkouts }) => <CheckoutsCell lines={checkouts} />,
  },
  {
    key: 'reports',
    header: 'Reports',
    render: ({ reports }) =>
      reports ? (
        <Stack value={reports.value}>
          <Line tone="red">{reports.missing}</Line>
        </Stack>
      ) : (
        DASH
      ),
  },
];

/** @param {{ data: object }} props data = monthData.loadMonth() */
export default function MonthTable({ data }) {
  return (
    <Card padding="none" className={styles.everyone}>
      <div className={styles.everyoneHead}>
        <h2 className={styles.cardTitle}>{data.title}</h2>
        <div className={styles.headTools}>
          <FilterPills
            items={data.pills}
            value={data.filter}
            label="Show"
            className={styles.pills}
          />
        </div>
      </div>
      <DataTable
        className={styles.table}
        columns={COLUMNS}
        rows={data.rows}
        caption={data.title}
        stackBelow={1280}
        empty={
          <EmptyState
            compact
            icon={<CalendarDays size={20} strokeWidth={1.8} />}
            title={data.empty.title}
            body={data.empty.body ?? undefined}
            action={
              data.filter === 'all' ? null : (
                <Link href={data.allHref} className={styles.emptyLink} scroll={false}>
                  Show everyone
                </Link>
              )
            }
          />
        }
      />
      <p className={styles.foot}>{data.foot}</p>
    </Card>
  );
}
