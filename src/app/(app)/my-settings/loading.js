// My settings while it loads, like Settings': title, the section list card and the first cards
// with their rows (a label and a help line, then a switch on the right or a choice below; for
// "Choose a sound", the choice with Play sound beside it, CONTRACT 26).
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import styles from './loading.module.css';

const NAV = [92, 24, 98, 86];

/** A Segmented choice with a label and a help line above it; `tone` adds Play sound beside it. */
function ChoiceSkeleton({ tone = false }) {
  const choice = (
    <Skeleton width={tone ? 270 : 340} height={40} radius={10} className={styles.choice} />
  );
  return (
    <span className={styles.choiceRow}>
      <Skeleton width={120} height={14} />
      <Skeleton width={300} height={12} />
      {tone ? (
        <span className={styles.controls}>
          {choice}
          <Skeleton width={128} height={40} radius={10} />
        </span>
      ) : (
        choice
      )}
    </span>
  );
}

/** A switch row; `wide` alternates the text widths so the rows don't look copied. */
function ToggleSkeleton({ wide }) {
  return (
    <span className={styles.row}>
      <span className={styles.rowText}>
        <Skeleton width={wide ? 260 : 180} height={14} />
        <Skeleton width={wide ? 320 : 240} height={12} />
      </span>
      <Skeleton width={44} height={26} radius={13} className={styles.switch} />
    </span>
  );
}

/** @param {{ rows: Array<'toggle' | 'choice' | 'tone'> }} props the rows in card order */
function SectionSkeleton({ rows }) {
  return (
    <Card className={styles.section}>
      <Skeleton width={130} height={20} radius={6} />
      <div className={styles.rows}>
        {rows.map((kind, i) =>
          kind === 'toggle' ? (
            <ToggleSkeleton key={i} wide={i % 2 === 0} />
          ) : (
            <ChoiceSkeleton key={i} tone={kind === 'tone'} />
          ),
        )}
      </div>
    </Card>
  );
}

export default function MySettingsLoading() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading my settings</span>
      <div className={styles.heading}>
        <Skeleton width={170} height={30} radius={8} />
        <Skeleton width={260} height={16} />
      </div>
      <div className={styles.layout}>
        <Card className={styles.nav}>
          {NAV.map((width, i) => (
            <Skeleton key={i} width={width} height={14} />
          ))}
        </Card>
        <div className={styles.sections}>
          <SectionSkeleton rows={['choice', 'toggle', 'toggle']} />
          <SectionSkeleton rows={['toggle', 'toggle']} />
          {/* Notifications: the bell, Sound, Choose a sound and Show a preview */}
          <SectionSkeleton rows={['toggle', 'choice', 'tone', 'toggle']} />
        </div>
      </div>
    </div>
  );
}
