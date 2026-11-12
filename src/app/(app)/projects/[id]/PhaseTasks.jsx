'use client';
// "Tasks" in an open phase section (CONTRACT 22), as the prototype: Add task, the column heads, the
// open tasks (P1 first, then the nearest due date), then "Show 3 done tasks" with the done ones under
// it. The add and edit row opens in place. The table keeps its width and scrolls sideways on a phone.
import { ChevronRight, Plus } from 'lucide-react';
import Button from '@/components/Button';
import PhaseTaskForm from './PhaseTaskForm';
import PhaseTaskRow from './PhaseTaskRow';
import { NO_PHASE, doneToggleLabel, emptyTasksText } from './phasesView';
import sectionStyles from './PhaseSection.module.css';
import styles from './PhaseTasks.module.css';

/** The id of a section's Add task button, where focus goes after adding. */
export const addButtonId = (sectionKey) => `phases-${sectionKey}-add`;

function Head({ canManage }) {
  return (
    <div aria-hidden="true" className={styles.head}>
      <span>Task</span>
      <span>Owner</span>
      <span>Due</span>
      <span>Priority</span>
      {canManage ? <span /> : null}
    </div>
  );
}

function DoneToggle({ shown, count, onToggle }) {
  return (
    <li>
      <button type="button" className={styles.doneToggle} aria-expanded={shown} onClick={onToggle}>
        <ChevronRight
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
          className={shown ? styles.chevronOpen : styles.chevron}
        />
        {doneToggleLabel(shown, count)}
      </button>
    </li>
  );
}

/** The row for a task, or the edit row in its place; with no task, the add row. */
function rowMaker({ section, board }) {
  const { key } = section;
  const editing = board.form?.section === key ? board.form.taskId : undefined;
  const formFor = (task) => (
    <li key={task ? task.id : 'new'}>
      <PhaseTaskForm
        projectId={board.project.id}
        phase={key === NO_PHASE ? null : key}
        task={task}
        owners={board.owners}
        choosePhase={key === NO_PHASE}
        onClose={() => board.closeForm(task ? task.id : null, key)}
      />
    </li>
  );
  return function rowFor(task) {
    if (!task || editing === task.id) return formFor(task);
    return (
      <PhaseTaskRow
        key={task.id}
        task={task}
        today={board.today}
        canManage={board.canManage}
        onEdit={() => board.openForm(key, task.id)}
        onDelete={(event) => board.deleteTask(task, key, event)}
      />
    );
  };
}

/** The 680 px table: heads, the add row, open tasks, then the done ones behind their toggle. */
function TaskTable({ section, board, adding }) {
  const { key, label, open, done } = section;
  const shown = board.isDoneShown(key);
  const rowFor = rowMaker({ section, board });
  return (
    <div className={styles.scroll}>
      <div className={`${styles.grid} ${board.canManage ? '' : styles.readOnly}`}>
        {open.length > 0 || (shown && done.length > 0) ? (
          <Head canManage={board.canManage} />
        ) : null}
        <ul aria-label={`Tasks in ${label}`} className={styles.list}>
          {adding ? rowFor(null) : null}
          {open.map(rowFor)}
          {done.length > 0 ? (
            <DoneToggle shown={shown} count={done.length} onToggle={() => board.toggleDone(key)} />
          ) : null}
          {shown ? done.map(rowFor) : null}
        </ul>
      </div>
    </div>
  );
}

/**
 * @param {{ section: object, board: object }} props section: phasesView.phaseSections'; board:
 *   PhasesBoard's shared values and actions
 */
export default function PhaseTasks({ section, board }) {
  const { key, open, done, total } = section;
  const adding = board.form?.section === key && !board.form.taskId;
  const canAdd = board.canManage && board.project.status !== 'completed';
  return (
    <div>
      <div className={sectionStyles.subhead}>
        <h3 className={sectionStyles.subtitle}>Tasks</h3>
        {canAdd ? (
          <Button
            id={addButtonId(key)}
            variant="secondary"
            className={sectionStyles.smallButton}
            icon={<Plus size={16} strokeWidth={1.8} />}
            onClick={() => board.openForm(key, null)}
          >
            Add task
          </Button>
        ) : null}
      </div>
      {open.length === 0 && !adding ? (
        <p className={sectionStyles.note}>{emptyTasksText(total)}</p>
      ) : null}
      {open.length > 0 || done.length > 0 || adding ? (
        <TaskTable section={section} board={board} adding={adding} />
      ) : null}
    </div>
  );
}
