// The skeleton of each tab of the project page, at the same sizes as the tab. Server-safe.
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import { PROJECT_TABS } from './ProjectTabs';
import styles from './loading.module.css';

const KPIS = [0, 1, 2, 3, 4];
const BARS = [0, 1, 2, 3, 4];
const COLUMNS = [0, 1, 2, 3, 4, 5, 6];
const ROWS = [0, 1, 2, 3];
const PHASES = [0, 1, 2, 3, 4, 5];
const STEPS = [0, 1, 2, 3, 4, 5];

function Busy({ label, children }) {
  return (
    <div className={styles.tab} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <Busy label="Loading the overview">
      <Skeleton width="100%" height={70} radius={12} />
      <div className={styles.row}>
        <Card padding="compact" className={styles.smallCard}>
          <Skeleton width={90} height={20} />
          <Skeleton width={140} height={140} radius={70} className={styles.centered} />
          <Skeleton width={120} height={14} className={styles.centered} />
        </Card>
        <Card padding="compact" className={styles.smallCard}>
          <Skeleton width={90} height={20} />
          <Skeleton width={170} height={34} radius={8} />
          <Skeleton width={90} height={14} />
          <Skeleton width={120} height={14} />
        </Card>
        <Card padding="compact" className={styles.phaseCard}>
          <Skeleton width={70} height={20} />
          <div className={styles.steps}>
            {STEPS.map((step) => (
              <Skeleton key={step} width={26} height={26} radius={13} />
            ))}
          </div>
          <Skeleton width={190} height={44} radius={10} />
        </Card>
      </div>
      <div className={styles.row}>
        {[0, 1].map((card) => (
          <Card key={card} padding="compact" className={styles.wideCard}>
            <Skeleton width={130} height={20} />
            {ROWS.map((row) => (
              <Skeleton key={row} width="100%" height={36} radius={8} />
            ))}
          </Card>
        ))}
      </div>
    </Busy>
  );
}

function PhasesSkeleton() {
  return (
    <Busy label="Loading the phases">
      <Card padding="none">
        {PHASES.map((phase) => (
          <div key={phase} className={styles.tableRow}>
            <Skeleton width="30%" height={16} />
            <Skeleton width={90} height={14} className={styles.cell} />
          </div>
        ))}
      </Card>
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
      <div className={styles.tableHead}>
        <Skeleton width={title} height={20} />
      </div>
      {ROWS.map((row) => (
        <div key={row} className={styles.tableRow}>
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
      <div className={styles.actions}>
        <Skeleton width={330} height={40} radius={10} />
        <Skeleton width={150} height={44} radius={10} />
      </div>
      <div className={styles.kpis}>
        {KPIS.map((kpi) => (
          <Card key={kpi} className={styles.kpi}>
            <Skeleton width={100} height={14} />
            <Skeleton width={90} height={32} radius={8} />
            <Skeleton width="100%" height={8} radius={4} />
          </Card>
        ))}
      </div>
      <div className={styles.charts}>
        <Card className={styles.block}>
          <Skeleton width={160} height={20} />
          {BARS.map((bar) => (
            <Skeleton key={bar} width="100%" height={12} radius={6} />
          ))}
        </Card>
        <Card className={styles.block}>
          <Skeleton width={160} height={20} />
          <div className={styles.columns}>
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
  overview: OverviewSkeleton,
  phases: PhasesSkeleton,
  timeline: TimelineSkeleton,
  hours: HoursSkeleton,
};

/** @param {{ tab: 'overview'|'phases'|'timeline'|'hours' }} props */
export function TabSkeleton({ tab }) {
  const Chosen = SKELETONS[tab] ?? OverviewSkeleton;
  return <Chosen />;
}

/**
 * Breadcrumb, title and health, the tabs and a tab, at the same sizes as the page.
 * @param {{ tab?: 'overview'|'phases'|'timeline'|'hours' }} props
 */
export function ProjectSkeleton({ tab = 'overview' }) {
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
        {PROJECT_TABS.map(({ key }) => (
          <Skeleton key={key} width={64} height={16} />
        ))}
      </div>
      <TabSkeleton tab={tab} />
    </div>
  );
}
