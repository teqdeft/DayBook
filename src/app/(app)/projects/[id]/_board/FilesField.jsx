'use client';
// The Files field of the New task and Edit task window (CONTRACT 28, New task and Edit task, field
// 6): "Upload files" and "From project files" side by side, the drop box "Or drag files from your
// computer here" on a computer, the help "Up to 20 files, each up to 500 MB. Any type of file.
// Files from the project stay in Files." (numbers from `limits`), then one list of chips: Edit's
// own files (X marks them "Removed when you save"), the uploads, and the linked project files
// (LinkChip: on New the X takes it away at once; on Edit it marks it, with "Keep …"). "From
// project files" opens the picker for this task and its checked person; its share confirm counts
// for the files it named while the same chip stays checked. The lines under it block a save: a
// paused upload, a refused save's message ("That file isn't in this project's files any more.").
import { useRef, useState } from 'react';
import FilesPicker from '@/components/files/FilesPicker';
import LinkChip from '@/components/files/LinkChip';
import UploadField from '@/components/files/UploadField';
import { formatSize } from '@/modules/projectFiles/kinds';
import { TOO_MANY_FILES, chosenName, chosenPerson } from './taskFormModel';
import styles from './TaskFormDialog.module.css';

/** "Up to 20 files, each up to 500 MB. Any type of file. Files from the project stay in Files." */
export const taskFilesHelp = (limits) =>
  `Up to ${limits.maxTaskFiles} files, each up to ${formatSize(limits.maxFileBytes)}. Any type of file. Files from the project stay in Files.`;

/** The linked chips, last in the list. */
function linkChips(form, task) {
  const { links } = form;
  return links.all.map((file) => (
    <LinkChip
      key={`link-${file.id}`}
      file={file}
      removed={Boolean(task) && links.removedIds.includes(file.id)}
      gone={links.goneIds.includes(file.id)}
      onRemove={links.drop}
      onKeep={links.keep}
    />
  ));
}

/** How many files the task would have with these: own kept, uploads, links. */
function fileCount(form, attached) {
  const own = attached.filter((file) => !form.removedIds.includes(file.id)).length;
  const uploads = form.uploads.items.filter((item) => item.state !== 'error').length;
  return own + uploads + form.links.kept.length;
}

/** The lines under the field that block a save: a paused upload, a refused save's message. */
function FileLines({ form }) {
  return (
    <>
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
    </>
  );
}

/**
 * "From project files" for the form: the picker for this task and its checked person; picked
 * files become linked chips (over 20 files on the task: the limit's line instead).
 */
function FormPicker({ form, task, own, limits, projectId, picking, setPicking, onOpenFiles }) {
  const owner = form.values.owner;
  const person = chosenPerson(form.choices, owner);
  const assignee = person ? { ...person, name: chosenName(form.choices, owner) } : null;
  function attach(files, { shareConfirmed }) {
    if (fileCount(form, own) + files.length > limits.maxTaskFiles) {
      form.setError({ field: null, files: TOO_MANY_FILES, message: TOO_MANY_FILES });
    } else {
      form.links.pick(files, shareConfirmed ? owner : null);
    }
    setPicking(false);
  }
  const openFiles = onOpenFiles
    ? () => {
        setPicking(false);
        onOpenFiles();
      }
    : undefined;
  return (
    <FilesPicker
      projectId={projectId}
      taskId={task?.id ?? null}
      assignee={assignee}
      project={form.project}
      existing={form.links.all.map((file) => file.id)}
      phase={form.values.phase || null}
      open={picking}
      onAttach={attach}
      onClose={() => setPicking(false)}
      onOpenFiles={openFiles}
    />
  );
}

/**
 * @param {{ form: object, task: object | null, details: object, limits: object,
 *   storageReady?: boolean, projectId: number, filesRef: object,
 *   onOpenFiles?: () => void }} props form: useTaskForm's; onOpenFiles: the picker's "Open Files"
 *   (the window closes first, asking about unsaved files)
 */
export default function FilesField(props) {
  const { form, task, details, limits, storageReady = true, filesRef } = props;
  const [picking, setPicking] = useState(false);
  const fromProjectRef = useRef(null);
  const own = (details.task?.files ?? []).filter((file) => !file.linked);
  return (
    <div ref={filesRef}>
      <UploadField
        id="task-form-files"
        variant="task"
        uploads={form.uploads}
        limits={limits}
        help={taskFilesHelp(limits)}
        storageReady={storageReady !== false}
        attached={own}
        removedIds={form.removedIds}
        onToggleRemove={form.toggleRemove}
        loadingAttached={Boolean(task) && details.loading && !details.task}
        attachedError={form.attachedError}
        onFromProject={() => setPicking(true)}
        fromProjectRef={fromProjectRef}
        linked={form.links.kept}
        after={linkChips(form, task)}
      />
      <FileLines form={form} />
      <FormPicker
        {...{ form, task, own, limits, picking, setPicking }}
        projectId={props.projectId}
        onOpenFiles={props.onOpenFiles}
      />
    </div>
  );
}
