'use client';
// The Phases tab (CONTRACT 22): one accordion section per phase, the current one open (with no phase
// yet, the first), then "No phase yet" when some tasks have none. It holds what the sections share:
// which are open, the one add or edit row, the done lists shown, Edit dates and Delete with Undo.
// Another PM reads everything here but changes nothing, and never gets files or notes.
import { useEffect, useRef, useState } from 'react';
import Card from '@/components/Card';
import PhaseDatesDialog from './PhaseDatesDialog';
import PhaseSection, { editorsText, sectionIds } from './PhaseSection';
import { addButtonId } from './PhaseTasks';
import { taskButtonId } from './PhaseTaskRow';
import { firstOpenSection, phaseSections } from './phasesView';
import { useUndoDelete } from './useUndoDelete';
import styles from './PhaseSection.module.css';

const taskKey = (id) => `task:${id}`;

/**
 * Which sections are open and the one add or edit row: the current phase's section at first, and
 * after each move only the new one, with no row left open.
 */
function useSections(currentPhase) {
  const fresh = () => ({
    phase: currentPhase,
    open: { [firstOpenSection(currentPhase)]: true },
    form: null,
  });
  const [state, setState] = useState(fresh);
  let shown = state;
  if (state.phase !== currentPhase) {
    shown = fresh();
    setState(shown);
  }
  return {
    open: shown.open,
    form: shown.form, // { section, taskId: number | null } | null
    toggle: (key) => setState((now) => ({ ...now, open: { ...now.open, [key]: !now.open[key] } })),
    setForm: (form) => setState((now) => ({ ...now, form })),
  };
}

/**
 * Puts focus back once the add or edit row has closed: the row closes together with the page
 * refresh, so this waits for the render without it.
 */
function useFocusWhenClosed(form) {
  const target = useRef(null); // [id, fallback id]
  useEffect(() => {
    if (form || !target.current) return;
    const [id, fallback] = target.current;
    target.current = null;
    (document.getElementById(id) ?? document.getElementById(fallback))?.focus();
  }, [form]);
  return (id, fallback) => {
    target.current = [id, fallback];
  };
}

const byId = (...ids) => ids.map((id) => document.getElementById(id)).find(Boolean) ?? null;

/** What Delete with Undo needs for a task; focus comes back to its row, or else to its section. */
function taskDeletion(task, section, event) {
  return {
    key: taskKey(task.id),
    url: `/api/project-tasks/${task.id}`,
    label: 'Task deleted.',
    failTitle: "Couldn't delete the task",
    keyboard: event?.detail === 0,
    returnFocus: () =>
      byId(taskButtonId(task.id, 'delete'), addButtonId(section), sectionIds(section).toggle),
  };
}

/** The board's state and the actions the sections share. */
function useBoard({ project, plan, owners, documents, today, canManage }) {
  const { open, toggle, form, setForm } = useSections(plan.currentPhase);
  const [doneShown, setDoneShown] = useState({});
  const [datesFor, setDatesFor] = useState(null);
  const undo = useUndoDelete();
  const focusWhenClosed = useFocusWhenClosed(form);
  const board = {
    project,
    plan,
    today,
    canManage,
    owners: owners ?? [],
    managerName: project.pmName ?? null,
    form,
    documentsFor: (key) => (documents ?? []).filter((document) => document.phase === key),
    isDoneShown: (key) => Boolean(doneShown[key]),
    toggleDone: (key) => setDoneShown({ ...doneShown, [key]: !doneShown[key] }),
    openForm: (section, taskId) => setForm({ section, taskId }),
    closeForm(taskId, section) {
      // After adding, back to Add task; after an edit, to that row's Edit (or the section's header
      // when the task went to another phase).
      const id = taskId ? taskButtonId(taskId, 'edit') : addButtonId(section);
      focusWhenClosed(id, sectionIds(section).toggle);
      setForm(null);
    },
    editDates: (key) => setDatesFor(key),
    deleteTask: (task, section, event) => undo.remove(taskDeletion(task, section, event)),
  };
  return { board, open, toggle, datesFor, setDatesFor, undo };
}

/**
 * @param {{ project: { id: number, name: string, pmName: string | null, status: string },
 *   plan: object, tasks: object[], owners: Array<{ id: number, name: string }>,
 *   documents?: object[], today: string, canManage: boolean }} props tasks: board rows
 *   (phasesView.toBoardTask); owners: who a task can be for (managers only); documents: the files
 *   and notes without their text, only ever for someone who can manage the project
 */
export default function PhasesBoard(props) {
  const { project, plan, tasks, canManage } = props;
  const { board, open, toggle, datesFor, setDatesFor, undo } = useBoard(props);
  const visible = tasks.filter((task) => !undo.isHidden(taskKey(task.id)));
  return (
    <div className={styles.tab}>
      {canManage ? null : (
        <p className={styles.readOnly}>Only {editorsText(project.pmName)} can edit phases.</p>
      )}
      <Card as="section" padding="none" aria-label="Phases" className={styles.board}>
        {phaseSections({ plan, tasks: visible }).map((section) => (
          <PhaseSection
            key={section.key}
            section={section}
            open={Boolean(open[section.key])}
            onToggle={() => toggle(section.key)}
            board={board}
          />
        ))}
      </Card>
      {canManage ? (
        <PhaseDatesDialog
          projectId={project.id}
          phase={datesFor ? plan.phases.find((phase) => phase.key === datesFor) : null}
          onClose={() => setDatesFor(null)}
        />
      ) : null}
      {canManage ? undo.toast : null}
    </div>
  );
}
