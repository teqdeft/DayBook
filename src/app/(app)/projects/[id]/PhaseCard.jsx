// Phase on the Overview: the stepper, the AI line and the button named after the next phase. The AI
// line and the button are only for the project's PM or Admin. Server-safe.
import { Check, Sparkles } from 'lucide-react';
import Card from '@/components/Card';
import { PHASE_NOT_SET, nextPhase, phaseIndex } from '@/modules/projectPlan/phases';
import MovePhaseButton from './MovePhaseButton';
import { moveLabel, phaseStatus } from './planFormat';
import styles from './Overview.module.css';

function classes(...names) {
  return names.filter(Boolean).join(' ');
}

function Step({ phase, index, last, currentIndex, status }) {
  const isDone = status === 'done';
  const isCurrent = status === 'current';
  return (
    <li className={styles.step} aria-current={isCurrent ? 'step' : undefined}>
      {index > 0 ? (
        <span
          aria-hidden="true"
          className={classes(styles.lineLeft, index <= currentIndex && styles.lineDone)}
        />
      ) : null}
      {index < last ? (
        <span
          aria-hidden="true"
          className={classes(styles.lineRight, index < currentIndex && styles.lineDone)}
        />
      ) : null}
      <span
        aria-hidden="true"
        className={classes(styles.dot, isDone && styles.dotDone, isCurrent && styles.dotCurrent)}
      >
        {isDone ? <Check size={14} strokeWidth={1.8} absoluteStrokeWidth /> : null}
        {isCurrent ? <span className={styles.dotInner} /> : null}
      </span>
      <span className={classes(styles.stepLabel, isCurrent && styles.stepLabelCurrent)}>
        {phase.label}
        {isDone ? <span className="visually-hidden">, done</span> : null}
        {status === 'skipped' ? <span className="visually-hidden">, skipped</span> : null}
      </span>
    </li>
  );
}

function AiLine({ suggestion }) {
  return (
    <div className={styles.aiLine}>
      <Sparkles className={styles.aiLineIcon} size={16} strokeWidth={1.8} aria-hidden="true" />
      <span className={styles.aiLineText}>
        AI suggests moving on: &#8220;{suggestion.quote}&#8221;
        {suggestion.source ? (
          <>
            {' · '}
            <span className={styles.aiLineSource}>{suggestion.source}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}

/**
 * @param {{ projectId: number, plan: object, today: string, canManage: boolean,
 *   suggestion: { quote: string, source: string } | null }} props suggestion: the AI line, from
 *   aiSuggestion; never moves anything
 */
export default function PhaseCard({ projectId, plan, today, canManage, suggestion }) {
  const { currentPhase, phases } = plan;
  const currentIndex = phaseIndex(currentPhase);
  const next = nextPhase(currentPhase);
  return (
    <Card
      as="section"
      padding="compact"
      aria-labelledby="overview-phase"
      className={`${styles.phaseCard} ${styles.columnCard}`}
    >
      <div className={styles.titleRow}>
        <h2 id="overview-phase" className={styles.cardTitle}>
          Phase
        </h2>
        {currentPhase ? null : <span className={styles.titleNote}>{PHASE_NOT_SET}</span>}
      </div>
      <div className={styles.stepsScroll}>
        <ol aria-label="Phases" className={styles.steps}>
          {phases.map((phase, index) => (
            <Step
              key={phase.key}
              phase={phase}
              index={index}
              last={phases.length - 1}
              currentIndex={currentIndex}
              status={phaseStatus(currentPhase, phase)}
            />
          ))}
        </ol>
      </div>
      {canManage && suggestion ? <AiLine suggestion={suggestion} /> : null}
      {canManage && next ? (
        <div className={styles.moveRow}>
          <MovePhaseButton
            projectId={projectId}
            currentPhase={currentPhase}
            targetPhase={next}
            plan={plan}
            today={today}
            label={moveLabel(currentPhase)}
          />
        </div>
      ) : null}
      {canManage && !next ? <p className={styles.lastPhase}>Support is the last phase.</p> : null}
    </Card>
  );
}
