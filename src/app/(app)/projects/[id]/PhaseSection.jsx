'use client';
// One phase on the Phases tab (CONTRACT 22), an accordion section as in the prototype. The header: the
// phase, Current or Done, its planned and actual dates, the late note (planFormat's, as on the Timeline
// and in the move dialog), the task count and Edit dates. Open, it lists the tasks, then the files and
// notes, then the move button. "No phase yet" has no dates, files, Move or Edit dates.
import { ChevronRight } from 'lucide-react';
import Button from '@/components/Button';
import Tag from '@/components/Tag';
import { PROJECT_PHASES, nextPhase } from '@/modules/projectPlan/phases';
import MovePhaseButton from './MovePhaseButton';
import PhaseDocuments from './PhaseDocuments';
import PhaseTasks from './PhaseTasks';
import { moveLabel } from './planFormat';
import { NO_PHASE, sectionDates, taskCount } from './phasesView';
import styles from './PhaseSection.module.css';

const NOTE_TONES = { red: styles.lateRed, marigold: styles.lateMarigold, muted: styles.lateMuted };

/** The ids of a section's header button and body. */
export const sectionIds = (key) => ({ toggle: `phases-${key}-toggle`, body: `phases-${key}` });

/** "Riya Kapoor and Admins", or just "Admins" on a project without a PM. */
export const editorsText = (managerName) => (managerName ? `${managerName} and Admins` : 'Admins');

function Heading({ section, open, onToggle, today }) {
  const { key, label, status } = section;
  const { planned, actual, note } = sectionDates(section, today);
  const ids = sectionIds(key);
  return (
    <h2 className={styles.heading}>
      <button
        type="button"
        id={ids.toggle}
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={open ? ids.body : undefined}
        onClick={onToggle}
      >
        <ChevronRight
          size={18}
          strokeWidth={1.8}
          aria-hidden="true"
          className={open ? styles.chevronOpen : styles.chevron}
        />
        <span className={styles.label}>{label}</span>
        {status === 'current' ? <Tag tone="primary">Current</Tag> : null}
        {status === 'done' ? <Tag tone="green">Done</Tag> : null}
        {planned ? <span className={styles.dates}>{planned}</span> : null}
        {actual ? <span className={styles.dates}>{actual}</span> : null}
        {note ? (
          <span className={`${styles.late} ${NOTE_TONES[note.tone]}`}>{note.text}</span>
        ) : null}
      </button>
    </h2>
  );
}

/** "Move to Design" in the current phase; "Make this the current phase" in the others. */
function MoveRow({ section, board }) {
  const { currentPhase } = board.plan;
  const common = {
    projectId: board.project.id,
    currentPhase,
    plan: board.plan,
    today: board.today,
  };
  if (section.status === 'current') {
    const next = nextPhase(currentPhase);
    if (!next) return null;
    return (
      <div className={styles.move}>
        <MovePhaseButton {...common} targetPhase={next} label={moveLabel(currentPhase)} />
      </div>
    );
  }
  // With no phase yet, the first phase is where the project starts.
  const starts = !currentPhase && section.key === PROJECT_PHASES[0].key;
  return (
    <div className={styles.move}>
      {starts ? (
        <MovePhaseButton {...common} targetPhase={section.key} label={moveLabel(null)} />
      ) : (
        <MovePhaseButton
          {...common}
          targetPhase={section.key}
          variant="text"
          size="compact"
          label="Make this the current phase"
        />
      )}
    </div>
  );
}

/** What another PM sees in place of the files and notes. */
function FilesLocked({ managerName }) {
  return (
    <div className={styles.files}>
      <div className={styles.subhead}>
        <h3 className={styles.subtitle}>Files and notes</h3>
      </div>
      <p className={styles.note}>Files and notes are only for {editorsText(managerName)}.</p>
    </div>
  );
}

/**
 * @param {{ section: object, open: boolean, onToggle: () => void, board: object }} props section:
 *   phasesView.phaseSections'; board: PhasesBoard's shared values and actions
 */
export default function PhaseSection({ section, open, onToggle, board }) {
  const { key } = section;
  const isPhase = key !== NO_PHASE;
  const { canManage, today } = board;
  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <Heading section={section} open={open} onToggle={onToggle} today={today} />
        <div className={styles.side}>
          <span className={styles.count}>{taskCount(section.done.length, section.total)}</span>
          {open && canManage && isPhase ? (
            <Button
              variant="secondary"
              className={styles.smallButton}
              onClick={() => board.editDates(key)}
            >
              Edit dates
            </Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div id={sectionIds(key).body} className={styles.body}>
          <PhaseTasks section={section} board={board} />
          {isPhase && canManage ? (
            <PhaseDocuments
              projectId={board.project.id}
              phase={key}
              documents={board.documentsFor(key)}
              canManage={canManage}
              managerName={board.managerName}
              today={today}
            />
          ) : null}
          {isPhase && !canManage ? <FilesLocked managerName={board.managerName} /> : null}
          {isPhase && canManage ? <MoveRow section={section} board={board} /> : null}
        </div>
      ) : null}
    </div>
  );
}
