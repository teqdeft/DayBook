'use client';
// The Screen time table: everyone tracked, for one day. Filter pills (live state today, "reported"
// on earlier days) and a name search work in the browser; rows come sorted by active time. Below
// 1280 px the table gives way to stacked person cards (ScreenTimeCards.jsx).
import { useState } from 'react';
import { Info } from 'lucide-react';
import Button from '@/components/Button';
import DataTable from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import FilterPills from '@/components/FilterPills';
import SearchBox from '@/components/SearchBox';
import DayTimeline, { StateLegend, TimelineScale } from './DayTimeline';
import PersonCards, { PersonCell, StateCell } from './ScreenTimeCards';
import styles from './ScreenTimeBoard.module.css';

const LIVE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active now' },
  { value: 'idle', label: 'Idle' },
  { value: 'locked', label: 'Locked' },
  { value: 'offline', label: 'Offline' },
];

const PAST_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'reported', label: 'Reported' },
  { value: 'none', label: 'No data' },
];

const EMPTY = {
  all: ['Nobody to show yet', 'People who check in show up here with their screen time.'],
  active: ['Nobody is active right now', 'People show up here while they use their computer.'],
  idle: ['Nobody is idle right now', 'Nobody has left their computer for long.'],
  locked: ['No screens are locked', 'Nobody has locked their screen right now.'],
  offline: ['Everyone is online', 'Everyone has Daybook open right now.'],
  reported: ['Nobody reported that day', 'No screen time was recorded on this day.'],
  none: ['Everyone reported that day', 'Every tracked person has screen time on this day.'],
};

const WINDOW_ONLY = 'Only the Daybook window is measured on this computer, not the whole screen.';

function Dash() {
  return <span className={styles.dash}>—</span>;
}

/** A cell renderer for one of the formatted durations ('active', 'idle', 'locked'). */
function duration(key) {
  return function renderDuration(row) {
    return row.hasData ? <span className={styles.number}>{row[key]}</span> : <Dash />;
  };
}

function nowColumn(isToday) {
  if (!isToday) {
    return {
      key: 'seen',
      header: 'Last seen',
      width: 104,
      render: (row) => (row.seenAt ? <span className={styles.time}>{row.seenAt}</span> : <Dash />),
    };
  }
  return {
    key: 'now',
    header: 'Now',
    width: 116,
    render: (row) => (
      <span className={styles.now}>
        <StateCell state={row.state} />
        {row.note ? (
          <span className={styles.nowNote} title={row.windowOnly ? WINDOW_ONLY : undefined}>
            {row.note}
          </span>
        ) : null}
      </span>
    ),
  };
}

function columns({ isToday, ticks }) {
  return [
    {
      key: 'person',
      header: 'Person',
      width: 200,
      render: (row) => <PersonCell row={row} />,
    },
    nowColumn(isToday),
    { key: 'active', header: 'Active', width: 76, render: duration('active') },
    { key: 'idle', header: 'Idle', width: 70, render: duration('idle') },
    { key: 'locked', header: 'Locked', width: 72, render: duration('locked') },
    {
      key: 'span',
      header: 'First to last active',
      width: 128,
      render: (row) => (row.span ? <span className={styles.time}>{row.span}</span> : <Dash />),
    },
    {
      key: 'day',
      header: (
        <>
          <span className="visually-hidden">Day</span>
          <TimelineScale ticks={ticks} />
        </>
      ),
      label: 'Day',
      render: (row) => <DayTimeline blocks={row.blocks} ticks={ticks} label={row.label} />,
    },
  ];
}

function matches(row, query) {
  if (!query) return true;
  return `${row.user.name} ${row.user.designation ?? ''}`.toLowerCase().includes(query);
}

/**
 * @param {{
 *   title: string, isToday: boolean, rows: object[], counts: Record<string, number>,
 *   ticks: object[], measured: string,
 * }} props  rows and ticks come from screenTimeData.js.
 */
export default function ScreenTimeBoard({ title, isToday, rows, counts, ticks, measured }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const filters = (isToday ? LIVE_FILTERS : PAST_FILTERS).map((item) => ({
    ...item,
    label: `${item.label} (${counts[item.value] ?? 0})`,
  }));
  const shown = rows.filter(
    (row) => (filter === 'all' || row.state === filter) && matches(row, query),
  );
  const reset = () => {
    setFilter('all');
    setSearch('');
  };
  const [emptyTitle, emptyBody] =
    query && rows.length
      ? [`Nobody matches “${search.trim()}”`, 'Check the spelling, or clear the search.']
      : (EMPTY[filter] ?? EMPTY.all);

  return (
    <section className={styles.board} aria-labelledby="screen-time-title">
      <div className={styles.head}>
        <h2 id="screen-time-title" className={styles.title}>
          {title}
        </h2>
        <FilterPills
          items={filters}
          value={filter}
          onChange={setFilter}
          label="Show"
          className={styles.pills}
        />
        <SearchBox
          placeholder="Search people"
          value={search}
          onChange={(value) => setSearch(value)}
          className={styles.search}
        />
      </div>
      {shown.length ? (
        <>
          <DataTable
            className={styles.table}
            columns={columns({ isToday, ticks })}
            rows={shown}
            caption={title}
          />
          <PersonCards
            rows={shown}
            isToday={isToday}
            ticks={ticks}
            label={title}
            className={styles.cards}
          />
        </>
      ) : (
        <EmptyState
          compact
          title={emptyTitle}
          body={emptyBody}
          className={styles.empty}
          action={
            filter !== 'all' || query ? (
              <Button variant="secondary" size="compact" onClick={reset}>
                Show everyone
              </Button>
            ) : null
          }
        />
      )}
      <div className={styles.foot}>
        <p className={styles.measured}>
          <Info size={16} strokeWidth={1.8} aria-hidden="true" className={styles.infoIcon} />
          <span>{measured}</span>
        </p>
        <StateLegend />
      </div>
    </section>
  );
}
