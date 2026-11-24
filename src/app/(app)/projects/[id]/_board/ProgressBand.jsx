'use client';
// The band on top of the Board (CONTRACT 27, The band): progress, the deadline (with "Change" for
// the project's PM and Admins) and the next phase's button ("Move to Testing", with "Go back to
// Design" under its "⋯"); a member sees their hours this month there instead. Under the numbers the
// six phases as equal parts: done ones green, the current one filled to its done share, a skipped
// one empty. Each part is a button that shows its column. The forecast line goes under it (PM view).
import { Check, Undo2 } from 'lucide-react';
import Card from '@/components/Card';
import Menu from '@/components/Menu';
import { plural } from '@/lib/text';
import { formatHours } from '@/lib/time';
import { PROJECT_PHASES, nextPhase, phaseIndex, phaseLabel } from '@/modules/projectPlan/phases';
import DeadlineButton from '../DeadlineButton';
import MovePhaseButton from '../MovePhaseButton';
import { moveLabel } from '../planFormat';
import { bandParts, deadlineText, progressOf } from './bandView';
import styles from './ProgressBand.module.css';

const PART_CLASS = { done: styles.done, current: styles.current, skipped: styles.skipped };

/** "Move to Testing" (or "Support is the last phase.") and the "⋯" with "Go back to Design". */
function PhaseActions({ projectId, plan, today, onPhaseMove }) {
  const next = nextPhase(plan.currentPhase);
  const previous = PROJECT_PHASES[phaseIndex(plan.currentPhase) - 1]?.key ?? null;
  return (
    <div className={styles.actions}>
      {next ? (
        <MovePhaseButton
          projectId={projectId}
          currentPhase={plan.currentPhase}
          targetPhase={next}
          plan={plan}
          today={today}
          variant="secondary"
          className={styles.move}
          label={moveLabel(plan.currentPhase)}
        />
      ) : (
        <span className={styles.last}>Support is the last phase.</span>
      )}
      <Menu
        label="More phase actions"
        triggerClassName={styles.more}
        width={220}
        items={
          previous
            ? [
                {
                  label: `Go back to ${phaseLabel(previous)}`,
                  icon: <Undo2 size={16} strokeWidth={1.8} aria-hidden="true" />,
                  onSelect: () => onPhaseMove(previous),
                },
              ]
            : [{ label: 'No earlier phase', disabled: true }]
        }
      />
    </div>
  );
}

function Deadline({ projectId, deadline, today, manage }) {
  const words = deadlineText(deadline, today);
  return (
    <div className={styles.stat}>
      <span className={styles.label}>Deadline</span>
      <span className={styles.value}>
        {words.date ? (
          <>
            <span className={styles.mid}>{words.date}</span>
            <span className={words.late ? styles.late : undefined}>{words.left}</span>
          </>
        ) : (
          <span className={`${styles.mid} ${styles.none}`}>{words.left}</span>
        )}
        {manage ? (
          <DeadlineButton
            projectId={projectId}
            deadline={deadline}
            className={styles.change}
            label={
              deadline ? (
                <>
                  Change<span className="visually-hidden"> deadline</span>
                </>
              ) : undefined
            }
          />
        ) : null}
      </span>
    </div>
  );
}

function Part({ part, onPart }) {
  return (
    <li>
      <button
        type="button"
        className={`${styles.part} ${PART_CLASS[part.status] ?? ''}`}
        aria-label={part.ariaLabel}
        onClick={() => onPart(part.key)}
      >
        <span className={styles.bar}>
          {part.share > 0 ? (
            <span className={styles.fill} style={{ width: `${part.share}%` }} />
          ) : null}
        </span>
        <span className={styles.text} aria-hidden="true">
          <span className={styles.name}>
            {part.status === 'done' ? <Check size={14} strokeWidth={2.6} /> : null}
            {part.label}
          </span>
          <span className={styles.count}>{part.text}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * @param {{ projectId: number, access: 'manage' | 'team' | 'member', plan: object, today: string,
 *   counts: Record<string, { total: number, done: number }>, hoursThisMonth?: number | null,
 *   onPart: (key: string) => void, onPhaseMove: (key: string) => void,
 *   children?: import('react').ReactNode }} props counts: every task of the project per phase;
 *   hoursThisMonth: the member's minutes this month (left out without `report.self`); children:
 *   the forecast line
 */
export default function ProgressBand(props) {
  const { projectId, access, plan, today, counts, hoursThisMonth, onPart, onPhaseMove } = props;
  const progress = progressOf(counts);
  const manage = access === 'manage';
  const showHours = access === 'member' && hoursThisMonth !== null && hoursThisMonth !== undefined;
  return (
    <Card as="section" aria-label="Progress and phases" className={styles.band}>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.label}>Progress</span>
          <span className={styles.value}>
            <span className={styles.big}>{progress.pct}%</span>
            <span>
              {progress.total > 0
                ? `${progress.done} of ${progress.total} ${plural(progress.total, 'task')} done`
                : 'No tasks yet'}
            </span>
          </span>
        </div>
        <Deadline projectId={projectId} deadline={plan.deadline} today={today} manage={manage} />
        {manage ? (
          <PhaseActions projectId={projectId} plan={plan} today={today} onPhaseMove={onPhaseMove} />
        ) : null}
        {showHours ? (
          <div className={styles.stat}>
            <span className={styles.label}>Your hours this month</span>
            <span className={styles.value}>
              <span className={styles.mid}>{formatHours(hoursThisMonth)}</span>
            </span>
          </div>
        ) : null}
      </div>
      <ol className={styles.parts} aria-label="Phases">
        {bandParts({ plan, counts }).map((part) => (
          <Part key={part.key} part={part} onPart={onPart} />
        ))}
      </ol>
      {props.children}
    </Card>
  );
}
