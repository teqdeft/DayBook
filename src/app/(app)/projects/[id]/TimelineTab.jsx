// The Timeline tab (CONTRACT 22): plan against actual, one row per phase, from timelineLayout.js. The
// tab needs nothing more than the page's plan and forecast. Server-safe.
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import { tabHref } from './ProjectTabs';
import { timelineLayout } from './timelineLayout';
import styles from './TimelineTab.module.css';

const LEGEND = [
  { label: 'Planned', className: styles.keyPlanned },
  { label: 'Actual', className: styles.keyActual },
  { label: 'Late', className: styles.keyLate },
];

const LATE_TONES = { red: styles.lateRed, marigold: styles.lateMarigold, muted: styles.lateMuted };

const TODAY_ALIGN = { start: styles.alignStart, center: styles.alignCenter, end: styles.alignEnd };

function classes(...names) {
  return names.filter(Boolean).join(' ');
}

/** Month names, week numbers and the Today, Deadline and Expected finish labels. */
function ChartHeader({ layout }) {
  const { months, weeks, today, deadline, expected, headerHeight } = layout;
  return (
    <div className={styles.row}>
      <div className={styles.labelCell} />
      <div className={styles.headerTrack} style={{ height: headerHeight }}>
        {months.map((month) => (
          <span key={month.left} className={styles.month} style={{ left: month.left }}>
            {month.label}
          </span>
        ))}
        {weeks.map((week) => (
          <span key={week.left} className={styles.week} style={{ left: week.left }}>
            {week.label}
          </span>
        ))}
        <span
          className={classes(styles.todayChip, TODAY_ALIGN[today.align])}
          style={{ left: today.x }}
        >
          {today.label}
        </span>
        {deadline ? (
          <span
            className={classes(styles.deadlineChip, deadline.leftward && styles.deadlineLeftward)}
            style={{ left: deadline.x, top: deadline.top }}
          >
            {deadline.label}
          </span>
        ) : null}
        {expected ? (
          <span
            className={classes(
              styles.expectedChip,
              expected.early ? styles.expectedEarly : styles.expectedLate,
              expected.leftward && styles.expectedLeftward,
            )}
            style={{ left: expected.x, top: expected.top }}
          >
            <span aria-hidden="true" className={styles.diamond} />
            {expected.label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** One phase: its name and dates in the sticky column, its bars on the chart. */
function PhaseRow({ row }) {
  const { planned, actual, late } = row.bars;
  return (
    <div className={classes(styles.row, styles.phaseRow)}>
      <div className={classes(styles.labelCell, styles.phaseCell)}>
        <span className={styles.phaseName}>{row.label}</span>
        <span className={styles.phaseDates}>{row.planned}</span>
        {row.late ? (
          <span className={classes(styles.phaseLate, LATE_TONES[row.late.tone])}>
            {row.late.text}
          </span>
        ) : null}
      </div>
      <div aria-hidden="true" className={styles.barTrack}>
        {planned ? (
          <span
            className={styles.barPlanned}
            style={{ left: planned.left, width: planned.width }}
          />
        ) : null}
        {actual ? (
          <span
            className={classes(styles.barActual, actual.square && styles.barActualOpen)}
            style={{ left: actual.left, width: actual.width }}
          />
        ) : null}
        {late ? (
          <span
            className={classes(styles.barLate, late.joined && styles.barLateJoined)}
            style={{ left: late.left, width: late.width }}
          />
        ) : null}
      </div>
    </div>
  );
}

function Chart({ layout }) {
  const { deadline, expected, today, weeks, rows, minWidth } = layout;
  return (
    // On a narrow screen the chart scrolls sideways; keyboard users can focus it to scroll it.
    <div className={styles.scroll} tabIndex={0} role="region" aria-label="Timeline chart">
      <div className={styles.chart} style={{ minWidth }}>
        <div aria-hidden="true" className={styles.gridLines}>
          {weeks.map((week) => (
            <span key={week.left} className={styles.gridLine} style={{ left: week.left }} />
          ))}
        </div>
        <ChartHeader layout={layout} />
        {rows.map((row) => (
          <PhaseRow key={row.key} row={row} />
        ))}
        <div aria-hidden="true" className={styles.markerLines}>
          <span className={styles.todayLine} style={{ left: today.x }} />
          {deadline ? <span className={styles.deadlineLine} style={{ left: deadline.x }} /> : null}
          {expected ? (
            <span
              className={expected.early ? styles.expectedLineEarly : styles.expectedLineLate}
              style={{ left: expected.x, top: expected.lineTop }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{ project: { id: number }, plan: object, forecast: { finishOn: string | null },
 *   today: string, canManage: boolean }} props see loadProjectHead
 */
export default function TimelineTab({ project, plan, forecast, today, canManage }) {
  const layout = timelineLayout({ plan, today, finishOn: forecast.finishOn });
  if (!layout) {
    return (
      <Card as="section" aria-label="Timeline">
        <EmptyState
          compact
          title="No planned dates yet."
          body={canManage ? 'Add dates to each phase in the Phases tab.' : undefined}
          action={
            canManage ? (
              <Button variant="secondary" size="compact" href={tabHref(project.id, 'phases')}>
                Go to phases
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }
  return (
    <Card as="section" aria-label="Timeline" className={styles.card}>
      {layout.summary ? <p className={styles.summary}>{layout.summary}</p> : null}
      <ul aria-label="Legend" className={styles.legend}>
        {LEGEND.map((item) => (
          <li key={item.label} className={styles.legendItem}>
            <span aria-hidden="true" className={classes(styles.key, item.className)} />
            {item.label}
          </li>
        ))}
      </ul>
      <Chart layout={layout} />
    </Card>
  );
}
