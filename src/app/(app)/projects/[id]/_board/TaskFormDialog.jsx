'use client';
// The New task and Edit task window (CONTRACT 27, Board tab): a centred 560 px Dialog (a full-screen
// sheet on a phone) with the task's fields and its files. Picked files go up at once through the
// tab's upload queue and are held until Add task or Save changes names them; while any is still on
// its way the main button says so and does nothing, and a paused one blocks the save until Retry or
// Remove. Closing with files not saved asks first, in the footer. Edit loads the task's attached
// files (useTaskDetails) and sends only what changed.
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Skeleton from '@/components/Skeleton';
import UploadField from '@/components/files/UploadField';
import { useTaskDetails } from '@/components/task/useTaskDetails';
import { formatSize } from '@/modules/projectFiles/kinds';
import windowStyles from '../projectWindows.module.css';
import TaskFormFields from './TaskFormFields';
import { closeQuestion, editable, uploadingLabel } from './taskFormModel';
import { useTaskForm } from './useTaskForm';
import styles from './TaskFormDialog.module.css';

/** The Files field's help: "Up to 20 files, each up to 500 MB. Any type of file." */
const filesHelp = (limits) =>
  `Up to ${limits.maxTaskFiles} files, each up to ${formatSize(limits.maxFileBytes)}. Any type of file.`;

/** The footer: Delete (Edit only), Cancel and the main button; or the question before closing. */
function Footer({ task, form, asking, onAsk, onKeep, onDiscard, onDelete, keepRef }) {
  const { counts, saving } = form;
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
 * asked) or Discard and close (the files stop and are deleted on the server).
 * @returns {{ asking: HTMLElement | true | null, keepRef: object, requestClose: () => void,
 *   keep: () => void, discard: () => void }} asking: the element that asked, or null
 */
function useCloseQuestion({ form, onClose }) {
  const [asking, setAsking] = useState(null);
  const keepRef = useRef(null);

  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

  function requestClose() {
    if (asking) return keep();
    if (form.counts.unsaved === 0) return onClose();
    setAsking(document.activeElement ?? true);
  }
  function keep() {
    const origin = asking;
    setAsking(null);
    requestAnimationFrame(() => {
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus();
    });
  }
  function discard() {
    form.uploads.cancelAll();
    onClose();
  }
  return { asking, keepRef, requestClose, keep, discard };
}

/** The Files field with the task's attached files, and the lines under it that block a save. */
function TaskFiles({ form, filesRef, task, details, limits, storageReady }) {
  return (
    <div ref={filesRef}>
      <UploadField
        id="task-form-files"
        uploads={form.uploads}
        limits={limits}
        help={filesHelp(limits)}
        storageReady={storageReady !== false}
        attached={details.task?.files ?? []}
        removedIds={form.removedIds}
        onToggleRemove={form.toggleRemove}
        loadingAttached={Boolean(task) && details.loading && !details.task}
        attachedError={form.attachedError}
      />
      {form.paused ? (
        <p className={styles.fileError} role="alert">
          {form.paused}
        </p>
      ) : null}
      {form.error.files ? (
        <p className={styles.fileError} role="alert">
          {form.error.files}
        </p>
      ) : null}
    </div>
  );
}

/** The window with its fields, once the task to edit (if any) is known. */
function TaskForm(props) {
  const { task, details, options, limits, viewerId, onClose, onDelete } = props;
  const form = useTaskForm(props);
  const question = useCloseQuestion({ form, onClose });
  return (
    <Dialog
      open
      width={560}
      className={`${styles.panel} ${windowStyles.window}`}
      title={task ? 'Edit task' : 'New task'}
      onClose={question.requestClose}
      onSubmit={form.save}
      footer={
        <Footer
          task={task}
          form={form}
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
        options={options}
        viewerId={viewerId}
      >
        <TaskFiles
          form={form}
          filesRef={form.filesRef}
          task={task}
          details={details}
          limits={limits}
          storageReady={props.storageReady}
        />
      </TaskFormFields>
    </Dialog>
  );
}

/** Edit from a task id alone: the window waits for the task's details. */
function Waiting({ error, onClose }) {
  return (
    <Dialog
      open
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
 *   taskId?: number, task?: object | null }, projectId: number, plan: object,
 *   options: object[], limits?: object, viewerId?: number | null, storageReady?: boolean,
 *   onClose: () => void,
 *   onSaved: (result: object) => void, onDelete: (task: object, opts: object) => void }} props
 *   form: what TaskEditorProvider opened; task: a board card or the task window's details
 */
export default function TaskFormDialog(props) {
  const { form, onClose } = props;
  const editing = form.mode === 'edit';
  const details = useTaskDetails(editing ? form.taskId : null);
  const source = form.task ?? details.task;
  const limits = props.limits ?? DEFAULT_LIMITS;
  if (editing && !source) return <Waiting error={details.error} onClose={onClose} />;
  return (
    <TaskForm
      {...props}
      limits={limits}
      details={editing ? details : { task: null, loading: false, error: null }}
      task={editing ? editable(source) : null}
    />
  );
}
