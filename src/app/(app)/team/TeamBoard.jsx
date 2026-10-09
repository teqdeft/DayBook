'use client';
// The team board (artboard 05): people grouped into In office, Working from home and Not checked
// in. Groups collapse from their title and show a few people first ("Show 17 more"). Filters are
// links (?filter=missing|late), so the Overview's "Needs attention" can link straight to them.
// Live status (CONTRACT 15): "On break" under the check-in time, "Now" and the timed project
// first in "Projects today".
import Link from 'next/link';
import { useState } from 'react';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import DataTable from '@/components/DataTable';
import DayBar from '@/components/DayBar';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import StatusCell from '@/components/StatusCell';
import { CheckInCell, ProjectsCell } from './TeamBoardCells';
import styles from './TeamBoard.module.css';

// People shown before "Show N more", per group, as on the canvas. A filtered board shows everyone.
const PREVIEW = { office: 3, wfh: 2, not_checked_in: 3 };
const AVATAR_TONE = { office: 'blue', wfh: 'violet', not_checked_in: 'red' };
const BAR_COLOR = { office: 'primary', wfh: 'violet', not_checked_in: 'primary' };

function columns({ day }) {
  return [
    {
      key: 'person',
      header: 'Person',
      width: 279,
      render: (row) => (
        <span className={styles.person}>
          <Avatar user={row} size={34} tone={AVATAR_TONE[row.group]} />
          <span className={styles.personText}>
            <Link href={row.href} className={styles.personName}>
              {row.name}
            </Link>
            <span className={styles.personSub}>{row.designation}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'checkIn',
      header: 'Check-in',
      width: 141,
      render: (row) => <CheckInCell row={row} tz={day.tz} />,
    },
    {
      key: 'day',
      header: day.label,
      label: 'Day',
      width: 199,
      hideOnMobile: true,
      render: (row) => (
        <DayBar
          variant="compact"
          checkInAt={row.checkInAt}
          checkOutAt={row.checkOutAt}
          now={day.now}
          start={day.start}
          end={day.end}
          tz={day.tz}
          color={BAR_COLOR[row.group]}
          className={styles.dayBar}
        />
      ),
    },
    {
      key: 'logged',
      header: 'Logged',
      width: 106,
      render: (row) => <span className={styles.logged}>{row.logged}</span>,
    },
    {
      key: 'report',
      header: 'Report',
      width: 153,
      align: 'center',
      render: (row) => <StatusCell status={row.report} className={styles.report} />,
    },
    {
      key: 'projects',
      header: 'Projects today',
      render: (row) => <ProjectsCell row={row} />,
    },
  ];
}

/**
 * @param {{
 *   groups: { key: string, title: string, tone: string, count: number, rows: object[] }[],
 *   filter: 'everyone'|'missing'|'late', filterItems: { value: string, label: string, href: string }[],
 *   day: { label: string, now: string, start: string, end: string, tz: string },
 *   exportHref: string, everyoneHref: string,
 * }} props
 */
export default function TeamBoard({ groups, filter, filterItems, day, exportHref, everyoneHref }) {
  const [collapsed, setCollapsed] = useState({});
  const [expanded, setExpanded] = useState({});
  const filtered = filter !== 'everyone';

  const visible = groups
    .filter((group) => group.rows.length > 0)
    .map((group) => {
      const limit = filtered || expanded[group.key] ? Infinity : (PREVIEW[group.key] ?? 3);
      const hidden = Math.max(0, group.rows.length - limit);
      return {
        key: group.key,
        title: group.title,
        tone: group.tone,
        count: group.count,
        rows: group.rows.slice(0, limit),
        collapsed: Boolean(collapsed[group.key]),
        onToggle: () => setCollapsed((state) => ({ ...state, [group.key]: !state[group.key] })),
        footer: hidden ? (
          <button
            type="button"
            className={styles.more}
            onClick={() => setExpanded((state) => ({ ...state, [group.key]: true }))}
          >
            Show {hidden} more
          </button>
        ) : null,
      };
    });

  return (
    <section className={styles.board} aria-labelledby="team-board-title">
      <div className={styles.head}>
        <h2 id="team-board-title" className={styles.title}>
          Team board
        </h2>
        <FilterPills items={filterItems} value={filter} label="Filter the team board" />
        <Button
          variant="secondary"
          size="compact"
          href={exportHref}
          download
          prefetch={false}
          className={styles.download}
        >
          Download Excel
        </Button>
      </div>
      {visible.length ? (
        <DataTable columns={columns({ day })} groups={visible} caption="Team board" />
      ) : (
        <EmptyState
          className={styles.empty}
          title={emptyTitle(filter)}
          body={
            filtered
              ? 'Everyone else is shown under Everyone.'
              : 'People appear here once HR adds them.'
          }
          action={
            filtered ? (
              <Button variant="secondary" href={everyoneHref}>
                Show everyone
              </Button>
            ) : null
          }
        />
      )}
    </section>
  );
}

function emptyTitle(filter) {
  if (filter === 'missing') return 'No reports missing right now.';
  if (filter === 'late') return 'Nobody is late today.';
  return 'Nobody on the team board yet.';
}
