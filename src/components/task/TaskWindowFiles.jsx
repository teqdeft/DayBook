'use client';
// The task window's "Files (n)" (CONTRACT 27, Task window), only when the viewer may see the
// task's files (`canSeeFiles`): pictures first as thumbnails (a click opens the picture viewer),
// then the other files as rows with Download. In manage mode on a project page the PM and Admins
// also get an X on each file (soft delete with Undo, "File removed.") and "Add files", which hands
// the picked files to the page's attach store: the window shows that task's batch as chips, so
// closing it loses nothing and the card keeps showing the progress. The store's toast ends the
// batch.
import { useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import Button from '@/components/Button';
import FileRows from '@/components/files/FileRows';
import FileThumbs from '@/components/files/FileThumbs';
import PictureViewer from '@/components/files/PictureViewer';
import { useTaskAttach, useTaskBatch } from '@/components/files/TaskAttachProvider';
import { UploadChips } from '@/components/files/UploadChip';
import { NO_FILES, filesPart } from './taskWindowView';
import styles from './TaskWindow.module.css';

/** "Files (n)" and, for the PM and Admins, "Add files" with the file input it opens. */
function FilesHead({ headingId, count, canChange, pickRef, onPick }) {
  const inputRef = useRef(null);
  return (
    <div className={styles.sectionHead}>
      <h3 id={headingId} className={styles.heading}>
        Files <span className={`${styles.muted} num`}>({count})</span>
      </h3>
      {canChange ? (
        <>
          <Button
            ref={pickRef}
            variant="secondary"
            size="small"
            className={styles.addFiles}
            icon={<Paperclip size={16} strokeWidth={1.8} aria-hidden="true" />}
            onClick={() => inputRef.current?.click()}
          >
            Add files
          </Button>
          {/* Opened only through "Add files", so screen readers meet one control, not two. */}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={onPick}
          />
        </>
      ) : null}
    </div>
  );
}

/** The files on their way to this task (its batch in the attach store), as chips. */
function BatchChips({ items, taskId, attach, pickRef }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.chips}>
      <UploadChips
        items={items}
        one
        onRetry={(id) => attach.retry(taskId, id)}
        onRemove={(id) => attach.remove(taskId, id)}
        focusFallback={() => pickRef.current?.focus()}
      />
    </div>
  );
}

/**
 * Add files (the picked files go to the attach store) and X (soft delete with Undo); focus comes
 * back to "Add files" (`pickRef`) after either.
 */
function useFileActions({ task, attach, removal }) {
  const pickRef = useRef(null);
  function pick(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    pickRef.current?.focus();
    if (files.length === 0) return;
    attach.add(task.id, files, {
      title: task.title,
      from: 'window',
      existing: task.files ?? [],
      fileCount: task.fileCount ?? 0,
    });
  }
  function remove(file) {
    removal.remove(
      { ...file, taskId: task.id },
      { label: 'File removed.', returnFocus: () => pickRef.current },
    );
  }
  return { pickRef, pick, remove };
}

/**
 * @param {{ task: object, mode: string, headingId: string,
 *   removal?: { remove: Function, isHidden: (id: number) => boolean } | null }} props removal:
 *   the project page's useFileRemoval (TaskWindowProvider)
 */
export default function TaskWindowFiles({ task, mode, headingId, removal }) {
  const attach = useTaskAttach();
  const part = filesPart({
    mode,
    task,
    canAttach: Boolean(attach && removal),
    isHidden: removal?.isHidden,
  });
  const batch = useTaskBatch(part.canChange ? task.id : null);
  const [viewing, setViewing] = useState(null);
  const { pickRef, pick, remove } = useFileActions({ task, attach, removal });
  if (!part.show) return null;
  const items = part.canChange ? (batch?.items ?? []) : [];
  const onRemove = part.canChange ? remove : undefined;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <FilesHead
        headingId={headingId}
        count={part.count}
        canChange={part.canChange}
        pickRef={pickRef}
        onPick={pick}
      />
      <FileThumbs
        files={part.pictures}
        onOpen={(file, index) => setViewing(index)}
        onRemove={onRemove}
      />
      {part.pictures.length && part.others.length ? <div className={styles.gap} /> : null}
      <FileRows files={part.others} onRemove={onRemove} />
      {part.count === 0 && items.length === 0 ? <p className={styles.muted}>{NO_FILES}</p> : null}
      <BatchChips items={items} taskId={task.id} attach={attach} pickRef={pickRef} />
      {viewing !== null ? (
        <PictureViewer
          files={part.pictures}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </section>
  );
}
