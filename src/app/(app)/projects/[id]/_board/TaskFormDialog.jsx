'use client';
// The New task and Edit task window (CONTRACT 27, Board tab; CONTRACT 28, New task and Edit task): a
// centred 560 px Dialog (a full-screen sheet on a phone) with the task's fields and its files.
// Picked files go up at once through the tab's upload queue and are held until Add task or Save
// changes names them; project files picked in "From project files" are linked by the save. While
// any upload is still on its way the main button says so and does nothing, and a paused one
// blocks the save until Retry or Remove. A save that would let someone who isn't a manager open an
// "Only PM and Admins" file shows the share confirm in place of the footer ("Add task and share",
// "Save and share"). Closing with files not saved asks first, in the footer. Edit loads the
// task's files (useTaskDetails) and sends only what changed. After a save the new card plays its
// entrance and an edited card flashes, through the Board when it is there (useTaskActions).
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import ShareConfirm from '@/components/files/ShareConfirm';
import {
  ADD_AND_SHARE,
  SAVE_AND_SHARE,
  shareText,
  taskShareText,
} from '@/components/files/shareConfirmView';
import Skeleton from '@/components/Skeleton';
import { useTaskDetails } from '@/components/task/useTaskDetails';
import windowStyles from '../projectWindows.module.css';
import FilesField from './FilesField';
import { useTaskActions } from './TaskActionsProvider';
import TaskFormFields from './TaskFormFields';
import { chosenName, closeQuestion, editable, uploadingLabel } from './taskFormModel';
import { useTaskForm } from './useTaskForm';
import styles from './TaskFormDialog.module.css';

/** The share confirm's sentence: the files and the person, or the count the server knows. */
function confirmText(form, task) {
  const name = chosenName(form.choices, form.values.owner);
  const anyone = !form.values.owner;
  if (form.share.files.length > 0) {
    return shareText({ files: form.share.files, personName: name, anyone });
  }
  return taskShareText({
    count: Math.max(1, task?.privateLinkCount ?? 1),
    personName: name,
    anyone,
  });
}

/** The share confirm in place of the footer: "Add task and share" or "Save and share". */
function ShareFooter({ task, form, mainRef }) {
  return (
    <ShareConfirm
      className={styles.share}
      text={confirmText(form, task)}
      confirmLabel={task ? SAVE_AND_SHARE : ADD_AND_SHARE}
      busy={form.saving}
      onBack={() => {
        form.backFromShare();
        requestAnimationFrame(() => mainRef.current?.focus());
      }}
      onConfirm={() => form.save(null, { shareOk: true })}
    />
  );
}

/** The footer: Delete (Edit only), Cancel and the main button; the question; the confirm. */
function Footer({ task, form, asking, keepRef, onAsk, onKeep, onDiscard, onDelete, mainRef }) {
  const { counts, saving } = form;
  if (form.share) return <ShareFooter task={task} form={form} mainRef={mainRef} />;
  if (asking) {
    return (
      <>
        <p className={styles.ask} role="status">
          {closeQuestion(counts)}
        </p>
        <Button ref={keepRef} variant="secondary" onClick={onKeep}>
          Keep editing
        </Button>
        <Button variant="danger" onClick={onDiscard}>
          Discard and close
        </Button>
      </>
    );
  }
  const running = counts.running > 0;
  return (
    <>
      {task ? (
        <Button
          variant="danger"
          className={styles.delete}
          icon={<Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />}
          onClick={(event) => onDelete(event)}
        >
          Delete
        </Button>
      ) : null}
      <Button variant="secondary" className={styles.cancel} onClick={onAsk}>
        Cancel
      </Button>
      <Button
        ref={mainRef}
        type="submit"
        className={styles.main}
        loading={saving}
        aria-disabled={running || undefined}
      >
        {running ? uploadingLabel(counts.running) : task ? 'Save changes' : 'Add task'}
      </Button>
    </>
  );
}

/**
 * Closing with files not saved asks first, in the footer: Keep editing (focus goes back to what
 * asked) or Discard and close (the files stop and are deleted on the server). `then` runs after a
 * close (the picker's "Open Files").
 */
function useCloseQuestion({ form, onClose }) {
  const [asking, setAsking] = useState(null);
  const keepRef = useRef(null);
  const thenRef = useRef(null);

  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

  function closeNow() {
    onClose();
    thenRef.current?.();
    thenRef.current = null;
  }
  function requestClose(then = null) {
    thenRef.current = typeof then === 'function' ? then : null;
    if (asking) return keep();
    if (form.counts.unsaved === 0) return closeNow();
    setAsking(document.activeElement ?? true);
  }
  function keep() {
    const origin = asking;
    thenRef.current = null;
    setAsking(null);
    requestAnimationFrame(() => {
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus();
    });
  }
  function discard() {
    form.uploads.cancelAll();
    closeNow();
  }
  return {
    asking,
    keepRef,
    requestClose: () => requestClose(),
    closeThen: requestClose,
    keep,
    discard,
  };
}

/** After a save: the editor's toast and refresh, and the Board's motion when it is there. */
function useAfterSave(onSaved) {
  const actions = useTaskActions();
  return (result) => {
    onSaved(result);
    if (result.edited) actions?.board?.flash(result.id);
    else actions?.board?.expectNew(result.id, result.phase);
  };
}

/** The window with its fields, once the task to edit (if any) is known. */
function TaskForm(props) {
  const { task, details, limits, onClose, onDelete, projectId } = props;
  const router = useRouter();
  const form = useTaskForm({ ...props, onSaved: useAfterSave(props.onSaved) });
  const question = useCloseQuestion({ form, onClose });
  const mainRef = useRef(null);
  const openFiles = () => question.closeThen(() => router.push(`/projects/${projectId}?tab=files`));
  return (
    <Dialog
      open={props.form.open !== false}
      width={560}
      className={`${styles.panel} ${windowStyles.window}`}
      title={task ? 'Edit task' : 'New task'}
      onClose={question.requestClose}
      onSubmit={form.save}
      footer={
        <Footer
          {...{ task, form, mainRef }}
          asking={question.asking}
          keepRef={question.keepRef}
          onAsk={question.requestClose}
          onKeep={question.keep}
          onDiscard={question.discard}
          onDelete={(event) => onDelete(task, { keyboard: event?.detail === 0 })}
        />
      }
    >
      <TaskFormFields
        values={form.values}
        set={form.set}
        error={form.error}
        titleRef={form.titleRef}
        task={task}
        choices={form.choices}
      >
        <FilesField
          form={form}
          task={task}
          details={details}
          limits={limits}
          storageReady={props.storageReady}
          projectId={projectId}
          filesRef={form.filesRef}
          onOpenFiles={openFiles}
        />
      </TaskFormFields>
    </Dialog>
  );
}

/** Edit from a task id alone: the window waits for the task's details. */
function Waiting({ error, open, onClose }) {
  return (
    <Dialog
      open={open}
      width={560}
      className={`${styles.panel} ${windowStyles.window}`}
      title="Edit task"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {error ? (
        <p className={styles.unavailable}>
          This task isn&apos;t available. It may have been deleted or given to someone else.
        </p>
      ) : (
        <Skeleton width="100%" height={52} radius={10} />
      )}
    </Dialog>
  );
}

const DEFAULT_LIMITS = { maxFileBytes: 500 * 1024 * 1024, maxTaskFiles: 20, pickMax: 50 };

/**
 * @param {{ form: { mode: 'new' | 'edit', preset?: { phase?: string, title?: string },
 *   taskId?: number, task?: object | null, open?: boolean }, projectId: number, plan: object,
 *   options: object[], limits?: object, viewerId?: number | null, storageReady?: boolean,
 *   project?: { id: number, pmId: number | null }, onClose: () => void,
 *   onSaved: (result: object) => void, onDelete: (task: object, opts: object) => void }} props
 *   form: what TaskEditorProvider opened (`open` false while its exit plays); task: a board
 *   card or the task window's details;
 *   project: the project's id and PM, for the share confirm
 */
export default function TaskFormDialog(props) {
  const { form, onClose } = props;
  const editing = form.mode === 'edit';
  const details = useTaskDetails(editing ? form.taskId : null);
  // The details are the fresher of the two (read again after a refused confirm).
  const source = details.task ?? form.task;
  const limits = props.limits ?? DEFAULT_LIMITS;
  if (editing && !source) {
    return <Waiting error={details.error} open={form.open !== false} onClose={onClose} />;
  }
  const pmId = details.task?.project?.pmId;
  const project =
    pmId !== undefined && pmId !== null ? { id: props.projectId, pmId } : props.project;
  return (
    <TaskForm
      {...props}
      project={project}
      limits={limits}
      details={editing ? details : { task: null, loading: false, error: null }}
      task={editing ? editable(source) : null}
    />
  );
}
