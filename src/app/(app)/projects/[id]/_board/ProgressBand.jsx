'use client';
// The band on top of the Board (CONTRACT 27 and 28, The band; Phase move sequence): progress, the
// deadline (with "Change" for the project's PM and Admins) and the next phase's button ("Move to
// Testing", with "Go back to Design" under its "⋯"; neither on a Completed project); a member sees
// their hours this month there instead. Under the numbers the six phases as equal parts: done ones
// green, the current one filled to its done share, a skipped one empty, each drawing its fill
// (scaleX) and its green layer, with one ring over the current part. Each part is a button that
// shows its column. The data attributes are what the phase move (phaseMotion.js) and the viewer's
// own ticks, moves and deletes (bandMotion.js) play on. The forecast line goes under it (PM view,
// not on a Completed project).
import { Undo2 } from 'lucide-react';
import Card from '@/components/Card';
import Menu from '@/components/Menu';
import { plural } from '@/lib/text';
import { formatHours } from '@/lib/time';
import { PROJECT_PHASES, nextPhase, phaseIndex, phaseLabel } from '@/modules/projectPlan/phases';
import DeadlineButton from '../DeadlineButton';
import MovePhaseButton from '../MovePhaseButton';
import { moveLabel } from '../planFormat';
import { bandParts, deadlineText, progressOf, ringIndex } from './bandView';
import styles from './ProgressBand.module.css';

const PART_CLASS = { done: styles.done, current: styles.current, skipped: styles.skipped };

/** A done phase's check: a path that can draw (`pathLength="1"`, phaseMotion's stroke-dashoffset). */
function DrawnCheck({ phaseKey }) {
  return (
    <svg
      className={styles.check}
      data-check={phaseKey}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 6 9 17l-5-5" pathLength="1" />
    </svg>
  );
}

/** "Move to Testing" (or "Support is the last phase.") and the "⋯" with "Go back to Design". */
function PhaseActions({ projectId, plan, today, onPhaseMove, onMoved, stayFor }) {
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
          stayText={stayFor?.(next) ?? null}
          onMoved={onMoved}
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
          <span
            className={styles.fill}
            data-fill={part.key}
            style={{ '--share': part.share / 100 }}
          />
          <span
            className={styles.doneLayer}
            data-done-layer={part.key}
            data-on={part.doneLayer ? '' : undefined}
          />
        </span>
        <span className={styles.text} aria-hidden="true">
          <span className={styles.name}>
            {part.status === 'done' ? <DrawnCheck phaseKey={part.key} /> : null}
            {part.label}
          </span>
          <span className={styles.count}>{part.text}</span>
        </span>
      </button>
    </li>
  );
}

/** The six parts and the one ring over the current part (none with no current phase). */
function Parts({ plan, counts, onPart }) {
  const ring = ringIndex(plan.currentPhase);
  return (
    <div className={styles.partsWrap}>
      <ol className={styles.parts} aria-label="Phases">
        {bandParts({ plan, counts }).map((part) => (
          <Part key={part.key} part={part} onPart={onPart} />
        ))}
      </ol>
      {ring === null ? null : (
        <span className={styles.ring} data-ring="" style={{ '--i': ring }} aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * Progress, "19 of 29 tasks done". The percent is drawn twice: the copy that counts up after the
 * viewer's own change (`data-pct`, hidden from screen readers; one string, so the count and React
 * write the same text) and its hidden twin, which always holds the final number.
 */
function Progress({ counts }) {
  const progress = progressOf(counts);
  const pct = `${progress.pct}%`;
  return (
    <div className={styles.stat}>
      <span className={styles.label}>Progress</span>
      <span className={styles.value}>
        <span className={styles.big}>
          <span data-pct="" aria-hidden="true">
            {pct}
          </span>
          <span className="visually-hidden" data-pct-final="">
            {pct}
          </span>
        </span>
        <span>
          {progress.total > 0
            ? `${progress.done} of ${progress.total} ${plural(progress.total, 'task')} done`
            : 'No tasks yet'}
        </span>
      </span>
    </div>
  );
}

/** A member's "Your hours this month" (left out without `report.self`). */
function Hours({ minutes }) {
  if (minutes === null || minutes === undefined) return null;
  return (
    <div className={styles.stat}>
      <span className={styles.label}>Your hours this month</span>
      <span className={styles.value}>
        <span className={styles.mid}>{formatHours(minutes)}</span>
      </span>
    </div>
  );
}

/**
 * @param {{ projectId: number, access: 'manage' | 'team' | 'member', plan: object, today: string,
 *   status: string, counts: Record<string, { total: number, done: number }>,
 *   hoursThisMonth?: number | null, onPart: (key: string) => void,
 *   onPhaseMove: (key: string) => void, onMoved?: (to: string) => void,
 *   stayFor?: (to: string) => string | null, bandRef?: import('react').Ref<HTMLElement>,
 *   children?: import('react').ReactNode }} props status: the project's as shown (Reopen
 *   changes it at once); counts: every task of the project per phase; hoursThisMonth: the
 *   member's minutes this month; onMoved: a phase move was saved (the Board plays it, then toasts
 *   and refreshes); stayFor: the confirm's "5 open tasks stay in Testing." for a move to that
 *   phase; children: the forecast line
 */
export default function ProgressBand({ bandRef, ...props }) {
  const { projectId, access, plan, today, counts, onPart } = props;
  const manage = access === 'manage';
  return (
    <Card as="section" aria-label="Progress and phases" className={styles.band} ref={bandRef}>
      <div className={styles.stats}>
        <Progress counts={counts} />
        <Deadline projectId={projectId} deadline={plan.deadline} today={today} manage={manage} />
        {manage && props.status !== 'completed' ? (
          <PhaseActions
            projectId={projectId}
            plan={plan}
            today={today}
            onPhaseMove={props.onPhaseMove}
            onMoved={props.onMoved}
            stayFor={props.stayFor}
          />
        ) : null}
        {access === 'member' ? <Hours minutes={props.hoursThisMonth} /> : null}
      </div>
      <Parts plan={plan} counts={counts} onPart={onPart} />
      {props.children}
    </Card>
  );
}
