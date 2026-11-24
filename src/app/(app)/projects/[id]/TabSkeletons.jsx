// The skeleton of each tab of the project page (CONTRACT 27), at the same sizes as the tab: the
// Board (band, pills, columns), Summary, Files, Timeline and Hours. Server-safe.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import { tabsFor } from './ProjectTabs';
import filesStyles from './loadingFiles.module.css';
import hoursStyles from './loadingHours.module.css';
import styles from './loading.module.css';

const KPIS = [0, 1, 2, 3, 4];
const BARS = [0, 1, 2, 3, 4];
const COLUMNS = [0, 1, 2, 3, 4, 5, 6];
const ROWS = [0, 1, 2, 3];
const PHASES = [0, 1, 2, 3, 4, 5];
const PILLS = [96, 92, 110];
const BOARD_COLUMNS = [3, 2, 1, 0];
const PLACES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const FILE_ROWS = [0, 1, 2, 3, 4];

function Busy({ label, children }) {
  return (
    <div className={styles.tab} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

/** The band: the stats row, the six parts with their names, a line for the forecast. */
function BandBlock() {
  return (
    <Card className={styles.band}>
      <div className={styles.bandStats}>
        <Skeleton width={170} height={52} radius={8} />
        <Skeleton width={190} height={52} radius={8} />
        <Skeleton width={150} height={44} radius={10} className={styles.cell} />
      </div>
      <div className={styles.parts}>
        {PHASES.map((phase) => (
          <div key={phase} className={styles.part}>
            <Skeleton width="100%" height={10} radius={6} />
            <Skeleton width="70%" height={14} className={styles.partName} />
            <Skeleton width="40%" height={14} className={styles.partName} />
          </div>
        ))}
      </div>
      <Skeleton width="80%" height={18} />
    </Card>
  );
}

/** Columns of task cards, the busiest first. */
function BoardColumns() {
  return (
    <div className={styles.boardColumns}>
      {BOARD_COLUMNS.map((cards, column) => (
        <div key={column} className={styles.boardColumn}>
          <Skeleton width={120} height={20} />
          <Skeleton width={150} height={14} />
          {Array.from({ length: cards }, (_, card) => (
            <div key={card} className={styles.taskCard}>
              <Skeleton width="85%" height={18} />
              <Skeleton width="60%" height={22} radius={11} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The band, the pills (PM view) or "Your tasks" (member view), then the columns. */
export function BoardSkeleton({ member }) {
  return (
    <Busy label="Loading the board">
      <BandBlock />
      <div className={styles.pills}>
        {member ? (
          <Skeleton width={110} height={22} />
        ) : (
          PILLS.map((width) => <Skeleton key={width} width={width} height={36} radius={18} />)
        )}
      </div>
      <BoardColumns />
    </Busy>
  );
}

/** Health box and Critical tasks on the left, the AI summary on the right. */
export function SummarySkeleton() {
  return (
    <Busy label="Loading the summary">
      <div className={styles.summary}>
        <div className={styles.summaryColumn}>
          <Skeleton width="100%" height={70} radius={12} />
          <Card padding="compact" className={styles.cardStack}>
            <Skeleton width={150} height={20} />
            {ROWS.map((row) => (
              <Skeleton key={row} width="100%" height={40} radius={8} />
            ))}
          </Card>
        </div>
        <Card padding="compact" className={styles.cardStack}>
          <Skeleton width={140} height={20} />
          <Skeleton width="100%" height={120} radius={10} />
          <Skeleton width="100%" height={14} />
          <Skeleton width="90%" height={14} />
          <Skeleton width="60%" height={14} />
        </Card>
      </div>
    </Busy>
  );
}

/** The side list of places beside the list of files. */
export function FilesSkeleton() {
  return (
    <Busy label="Loading the files">
      <div className={filesStyles.files}>
        <Card className={filesStyles.placesCard}>
          {PLACES.map((place) => (
            <Skeleton key={place} width="100%" height={28} radius={8} />
          ))}
        </Card>
        <div className={filesStyles.filesMain}>
          <div className={filesStyles.filesHead}>
            <Skeleton width={130} height={22} />
            <Skeleton width={150} height={44} radius={10} className={styles.cell} />
          </div>
          <Skeleton width="100%" height={40} radius={10} />
          <Card padding="none">
            {FILE_ROWS.map((row) => (
              <div key={row} className={filesStyles.fileRow}>
                <Skeleton width={36} height={36} radius={8} />
                <div className={filesStyles.fileText}>
                  <Skeleton width="45%" height={16} />
                  <Skeleton width="65%" height={14} />
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </Busy>
  );
}

function TimelineSkeleton() {
  return (
    <Busy label="Loading the timeline">
      <Card className={styles.block}>
        <Skeleton width="50%" height={18} />
        <Skeleton width={200} height={14} />
        {PHASES.map((phase) => (
          <div key={phase} className={styles.timelineRow}>
            <Skeleton width={130} height={30} radius={8} />
            <Skeleton width="60%" height={12} radius={6} />
          </div>
        ))}
      </Card>
    </Busy>
  );
}

function TableBlock({ title }) {
  return (
    <Card padding="none">
      <div className={hoursStyles.tableHead}>
        <Skeleton width={title} height={20} />
      </div>
      {ROWS.map((row) => (
        <div key={row} className={hoursStyles.tableRow}>
          <Skeleton width={34} height={34} radius={17} />
          <Skeleton width="18%" height={14} />
          <Skeleton width="12%" height={14} />
          <Skeleton width="8%" height={14} />
          <Skeleton width={110} height={34} radius={8} className={styles.cell} />
        </div>
      ))}
    </Card>
  );
}

/** The range and Excel button, five numbers, the two hours cards and the three tables. */
function HoursSkeleton() {
  return (
    <Busy label="Loading the hours">
      <div className={hoursStyles.actions}>
        <Skeleton width={330} height={40} radius={10} />
        <Skeleton width={150} height={44} radius={10} />
      </div>
      <div className={hoursStyles.kpis}>
        {KPIS.map((kpi) => (
          <Card key={kpi} className={hoursStyles.kpi}>
            <Skeleton width={100} height={14} />
            <Skeleton width={90} height={32} radius={8} />
            <Skeleton width="100%" height={8} radius={4} />
          </Card>
        ))}
      </div>
      <div className={hoursStyles.charts}>
        <Card className={styles.block}>
          <Skeleton width={160} height={20} />
          {BARS.map((bar) => (
            <Skeleton key={bar} width="100%" height={12} radius={6} />
          ))}
        </Card>
        <Card className={styles.block}>
          <Skeleton width={160} height={20} />
          <div className={hoursStyles.columns}>
            {COLUMNS.map((column) => (
              <Skeleton key={column} width={34} height={150} radius={8} />
            ))}
          </div>
        </Card>
      </div>
      <TableBlock title={200} />
      <TableBlock title={90} />
      <TableBlock title={110} />
    </Busy>
  );
}

const SKELETONS = {
  board: BoardSkeleton,
  summary: SummarySkeleton,
  files: FilesSkeleton,
  timeline: TimelineSkeleton,
  hours: HoursSkeleton,
};

/**
 * @param {{ tab: 'board'|'summary'|'files'|'timeline'|'hours', member?: boolean }} props member:
 *   the member's Board ("Your tasks" in place of the pills)
 */
export function TabSkeleton({ tab, member = false }) {
  const Chosen = SKELETONS[tab] ?? BoardSkeleton;
  return <Chosen member={member} />;
}

/**
 * Breadcrumb, title and tags, the tabs and a tab, at the same sizes as the page.
 * @param {{ tab?: 'board'|'summary'|'files'|'timeline'|'hours',
 *   access?: 'manage'|'team'|'member' }} props access: how many tabs to draw (the PM view's when
 *   left out)
 */
export function ProjectSkeleton({ tab = 'board', access }) {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading the project</span>
      <div className={styles.heading}>
        <Skeleton width={150} height={14} />
        <div className={styles.titleRow}>
          <Skeleton width={36} height={36} radius={9} />
          <Skeleton width={220} height={30} radius={8} />
          <Skeleton width={72} height={26} radius={13} />
        </div>
        <Skeleton width={300} height={16} />
      </div>
      <div className={styles.tabs}>
        {tabsFor(access).map(({ key }) => (
          <Skeleton key={key} width={64} height={16} />
        ))}
      </div>
      <TabSkeleton tab={tab} member={access === 'member'} />
    </div>
  );
}
