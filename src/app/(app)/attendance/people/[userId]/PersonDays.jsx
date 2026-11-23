// The person month's "Each day" table (CONTRACT 25, item 8). Server Component; the Breaks cell is
// B's BreaksButton (it opens the break list) and the Action cell HR's RowAction, both client
// components with serialisable props. Weekends show only when the person checked in. Below 1280 px
// each day is a card (DataTable's stackBelow), so Report and Action never hide off to the side.
import Card, { CardHeader } from '@/components/Card';
import DataTable from '@/components/DataTable';
import StatusCell from '@/components/StatusCell';
import Tag from '@/components/Tag';
import BreaksButton from '../../BreaksButton';
import RowAction from '../../RowAction';
import styles from './PersonDays.module.css';

const DASH = <span className={styles.dash}>—</span>;

function Line({ children, className = '' }) {
  if (!children) return null;
  return <span className={`${styles.mline} ${className}`}>{children}</span>;
}

function CheckInCell({ row }) {
  if (!row.checkIn) return DASH;
  const count = row.lateCount;
  return (
    <span className={styles.stack}>
      <span className={styles.checkInTime}>{row.checkIn}</span>
      {row.late ? <span className={styles.late}>{row.late}</span> : null}
      {count ? (
        <span className={`${styles.mline} ${count.alert ? styles.alert : ''}`} title={count.title}>
          {count.label}
        </span>
      ) : null}
    </span>
  );
}

function OutCell({ out }) {
  if (!out?.time) return out?.missing ? <span className={styles.missing}>Missing</span> : DASH;
  return (
    <span className={styles.stack}>
      <span className={styles.time}>{out.time}</span>
      {out.auto || out.early ? (
        <span className={styles.tagsWrap}>
          {out.auto ? (
            <Tag tone="neutral" padX={6} className={styles.cellTag}>
              Auto<span className="visually-hidden"> check-out</span>
            </Tag>
          ) : null}
          {out.early ? (
            <Tag tone="marigold" padX={6} className={styles.cellTag} title={out.early.title}>
              {out.early.label}
            </Tag>
          ) : null}
        </span>
      ) : null}
      {out.by ? (
        <span className={styles.mline} title={out.by.title}>
          <span className="visually-hidden">Check-out entered </span>By {out.by.name}
        </span>
      ) : null}
      {out.check ? (
        <span className={styles.tagsWrap}>
          <Tag tone="marigold" padX={6} className={styles.cellTag} title={out.check}>
            Check
          </Tag>
        </span>
      ) : null}
    </span>
  );
}

function BreaksCell({ breaks }) {
  if (!breaks) return DASH;
  return (
    <BreaksButton row={breaks.button}>
      <span className={styles.stack}>
        <span className={styles.time}>{breaks.text}</span>
        {breaks.over ? (
          <Tag tone="red" padX={6} className={styles.cellTag}>
            {breaks.over}
          </Tag>
        ) : null}
      </span>
    </BreaksButton>
  );
}

function WorkedCell({ row }) {
  if (!row.worked) return DASH;
  return (
    <span className={styles.stack}>
      <span className={styles.time}>{row.worked}</span>
      {row.mark ? (
        <span className={styles.tagsWrap}>
          <Tag tone="marigold" padX={6} className={styles.cellTag} title={row.mark.title}>
            {row.mark.label}
          </Tag>
        </span>
      ) : null}
    </span>
  );
}

function ReportCell({ report }) {
  if (!report) return DASH;
  if (report.tone === 'red') return <span className={styles.missing}>{report.text}</span>;
  return (
    <span className={report.tone === 'muted' ? styles.muted : styles.time}>{report.text}</span>
  );
}

function columns(canChange) {
  const list = [
    {
      key: 'day',
      header: 'Day',
      width: 116,
      render: (row) => (
        <span className={styles.stack}>
          <span className={styles.time}>{row.day}</span>
          <Line>{row.daySub}</Line>
        </span>
      ),
    },
    {
      key: 'where',
      header: 'Where',
      width: 104,
      render: ({ where }) => (
        <span className={styles.stack}>
          <StatusCell status={where.status} label={where.label} size="cellCompact" />
          <Line>{where.line}</Line>
        </span>
      ),
    },
    { key: 'checkIn', header: 'Check-in', width: 96, render: (row) => <CheckInCell row={row} /> },
    { key: 'out', header: 'Out', width: 104, render: (row) => <OutCell out={row.out} /> },
    {
      key: 'breaks',
      header: 'Breaks',
      width: 84,
      render: (row) => <BreaksCell breaks={row.breaks} />,
    },
    { key: 'worked', header: 'Worked', width: 96, render: (row) => <WorkedCell row={row} /> },
    { key: 'report', header: 'Report', render: (row) => <ReportCell report={row.report} /> },
  ];
  if (canChange) {
    list.push({
      key: 'action',
      header: <span className="visually-hidden">Action</span>,
      label: 'Action',
      width: 76,
      render: (row) =>
        row.action ? <RowAction kind={row.action.kind} row={row.action.row} /> : null,
    });
  }
  return list;
}

/**
 * @param {{ rows: object[], canChange: boolean, className?: string }} props rows =
 *   personDayRows.dayRows()
 */
export default function PersonDays({ rows, canChange, className }) {
  return (
    <Card padding="none" className={className}>
      <CardHeader title="Each day" subtitle="Weekends show only when they checked in." divider />
      <DataTable
        className={styles.table}
        columns={columns(canChange)}
        rows={rows}
        caption="Each day"
        stackBelow={1280}
        empty={<p className={styles.emptyLine}>No days to show yet.</p>}
      />
    </Card>
  );
}
