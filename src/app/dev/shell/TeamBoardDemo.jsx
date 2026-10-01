'use client';
// Team board (artboard 05) built from DataTable groups, with working group toggles.
import { useState } from 'react';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import DataTable from '@/components/DataTable';
import DayBar from '@/components/DayBar';
import FilterPills from '@/components/FilterPills';
import ProjectLabel from '@/components/ProjectLabel';
import StatusCell from '@/components/StatusCell';
import Tag from '@/components/Tag';
import { formatTime } from '@/lib/time';
import { NOW, TEAM_GROUPS, TZ } from './demoData';
import styles from './page.module.css';

const COLOR = { office: 'primary', wfh: 'violet', missing: 'primary' };

function columns(groupKey) {
  return [
    {
      key: 'person',
      header: 'Person',
      width: 279,
      render: (row) => (
        <span className={styles.person}>
          <Avatar user={row} size={34} />
          <span className={styles.personText}>
            <span className={styles.personName}>{row.name}</span>
            <span className={styles.personSub}>{row.designation}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'in',
      header: 'Check-in',
      width: 141,
      render: (row) =>
        row.in ? (
          <span className={styles.checkIn}>
            <span className="num">{formatTime(row.in, TZ)}</span>
            {row.late ? <Tag tone="marigold">{`Late ${row.late}m`}</Tag> : null}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'day',
      header: 'Day, 9:30 to 6:30',
      width: 199,
      render: (row) => (
        <DayBar
          variant="compact"
          checkInAt={row.in}
          checkOutAt={row.out}
          now={NOW.replace('09:40', '13:22')}
          start="09:30"
          end="18:30"
          tz={TZ}
          color={COLOR[groupKey(row)] ?? 'primary'}
        />
      ),
    },
    { key: 'logged', header: 'Logged', width: 106, render: (row) => row.logged ?? '—' },
    {
      key: 'report',
      header: 'Report',
      width: 153,
      align: 'center',
      render: (row) => <StatusCell status={row.report} />,
    },
    {
      key: 'projects',
      header: 'Projects today',
      render: (row) =>
        row.projects.length ? (
          <span className={styles.labels}>
            {row.projects.map((project) => (
              <ProjectLabel key={project.name} project={project} />
            ))}
          </span>
        ) : row.report === 'missing' ? (
          <span className={styles.muted}>No report yet</span>
        ) : null,
    },
  ];
}

export default function TeamBoardDemo() {
  const [collapsed, setCollapsed] = useState({});
  const [filter, setFilter] = useState('everyone');
  const groupOf = (row) => TEAM_GROUPS.find((g) => g.rows.includes(row))?.key;

  const groups = TEAM_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    tone: group.tone,
    count: group.total,
    rows: group.rows,
    collapsed: Boolean(collapsed[group.key]),
    onToggle: () => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] })),
    footer:
      group.total > group.rows.length ? (
        <button type="button">Show {group.total - group.rows.length} more</button>
      ) : null,
  }));

  return (
    <div className={styles.board}>
      <div className={styles.boardHead}>
        <h2 className={styles.boardTitle}>Team board</h2>
        <FilterPills
          items={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'missing', label: 'Report missing (3)' },
            { value: 'late', label: 'Late (3)' },
          ]}
          value={filter}
          onChange={setFilter}
          label="Filter the team board"
        />
        <Button variant="secondary" className={styles.boardAction}>
          Download Excel
        </Button>
      </div>
      <DataTable columns={columns(groupOf)} groups={groups} rowKey="id" caption="Team board" />
    </div>
  );
}
