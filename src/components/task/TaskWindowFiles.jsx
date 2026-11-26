'use client';
// The task window's "Files (n)" (CONTRACT 27 and 28, Task window), only when the viewer may see the
// task's files (`canSeeFiles`): pictures first as thumbnails (a click opens the picture viewer),
// then the other files as rows with Download; a linked project file adds " · From Files: Design".
// In manage mode on a project page the PM and Admins also get an X on each file (an own file:
// soft delete with Undo, "File removed."; a linked one leaves only this task, "Removed from this
// task. It stays in Files.", the unlink sent after the toast) and "Add files", a menu of "Upload
// files" (the page's attach store: the window shows that task's batch as chips, so closing it loses
// nothing and the card keeps showing the progress) and "From project files" (the picker, which
// links at once).
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Folder, Paperclip, Upload } from 'lucide-react';
import buttonStyles from '@/components/Button.module.css';
import Menu from '@/components/Menu';
import FileRows from '@/components/files/FileRows';
import FilesPicker from '@/components/files/FilesPicker';
import FileThumbs from '@/components/files/FileThumbs';
import PictureViewer from '@/components/files/PictureViewer';
import { useTaskAttach, useTaskBatch } from '@/components/files/TaskAttachProvider';
import { UploadChips } from '@/components/files/UploadChip';
import { NO_FILES, filesPart } from './taskWindowView';
import { useLinkAttach } from './useLinkAttach';
import styles from './TaskWindow.module.css';

const ADD_CLASS = [
  buttonStyles.button,
  buttonStyles.secondary,
  buttonStyles.sizeSmall,
  styles.addFiles,
].join(' ');

/** "Add files": a menu of Upload files (the hidden file input) and From project files. */
function AddFiles({ inputRef, onPick, onProject }) {
  const items = [
    {
      label: 'Upload files',
      icon: <Upload size={16} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: () => inputRef.current?.click(),
    },
    {
      label: 'From project files',
      icon: <Folder size={16} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: onProject,
    },
  ];
  return (
    <>
      <Menu label="Add files" items={items} width={200} triggerClassName={ADD_CLASS}>
        <Paperclip size={16} strokeWidth={1.8} aria-hidden="true" />
        <span aria-hidden="true">Add files</span>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </Menu>
      {/* Opened only through the menu, so screen readers meet one control, not two. */}
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
  );
}

/** The files on their way to this task (its batch in the attach store), as chips. */
function BatchChips({ items, taskId, attach, focusAdd }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.chips}>
      <UploadChips
        items={items}
        one
        onRetry={(id) => attach.retry(taskId, id)}
        onRemove={(id) => attach.remove(taskId, id)}
        focusFallback={focusAdd}
      />
    </div>
  );
}

/**
 * Upload files (the picked files go to the attach store) and X (an own file: soft delete with
 * Undo; a linked one: unlink with Undo); focus comes back to "Add files" after either.
 */
function useFileActions({ task, attach, removal, sectionRef }) {
  const inputRef = useRef(null);
  const focusAdd = () =>
    sectionRef.current?.querySelector('button[aria-haspopup="menu"]')?.focus({
      preventScroll: true,
    });
  function pick(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    focusAdd();
    if (files.length === 0) return;
    attach.add(task.id, files, {
      title: task.title,
      from: 'window',
      existing: task.files ?? [],
      fileCount: task.fileCount ?? 0,
    });
  }
  function remove(file, event) {
    const keyboard = event?.detail === 0;
    if (file.linked) {
      removal.unlink(file, task, { keyboard, returnFocus: focusAdd });
      return;
    }
    removal.remove(
      { ...file, taskId: task.id },
      { label: 'File removed.', keyboard, returnFocus: focusAdd },
    );
  }
  return { inputRef, pick, remove, focusAdd };
}

/**
 * The picker for this task: the person the confirm names is the task's. Its "Open Files" (a
 * project with no files yet) closes the windows and opens the Files tab.
 */
function Picker({ task, links, onCloseWindow }) {
  const router = useRouter();
  const openFiles = () => {
    links.hide();
    onCloseWindow?.({ restore: false });
    router.push(`/projects/${task.projectId}?tab=files`);
  };
  const existing = (task.files ?? []).filter((file) => file.linked).map((file) => file.id);
  return (
    <FilesPicker
      projectId={task.projectId}
      taskId={task.id}
      assignee={task.assignee ?? null}
      project={{ id: task.projectId, pmId: task.project?.pmId ?? null }}
      existing={existing}
      phase={task.phase ?? null}
      open={links.open}
      onAttach={links.attach}
      onClose={links.hide}
      onOpenFiles={openFiles}
    />
  );
}

/**
 * @param {{ task: object, mode: string, headingId: string,
 *   removal?: { remove: Function, unlink: Function, isHidden: (id: number) => boolean,
 *   isLinkHidden: (taskId: number, fileId: number) => boolean } | null,
 *   onCloseWindow?: (opts?: { restore?: boolean }) => void }} props removal: the project page's
 *   useFileRemoval (TaskWindowProvider); onCloseWindow: closes the task window (the picker's
 *   "Open Files")
 */
export default function TaskWindowFiles({ task, mode, headingId, removal, onCloseWindow }) {
  const attach = useTaskAttach();
  const part = filesPart({
    mode,
    task,
    canAttach: Boolean(attach && removal),
    isHidden: removal?.isHidden,
    isLinkHidden: removal?.isLinkHidden,
  });
  const batch = useTaskBatch(part.canChange ? task.id : null);
  const sectionRef = useRef(null);
  const links = useLinkAttach({ task });
  const [viewing, setViewing] = useState(null);
  const actions = useFileActions({ task, attach, removal, sectionRef });
  if (!part.show) return null;
  const items = part.canChange ? (batch?.items ?? []) : [];
  const onRemove = part.canChange ? actions.remove : undefined;
  return (
    <section ref={sectionRef} className={styles.section} aria-labelledby={headingId}>
      <div className={styles.sectionHead}>
        <h3 id={headingId} className={styles.heading}>
          Files <span className={`${styles.muted} num`}>({part.count})</span>
        </h3>
        {part.canChange ? (
          <AddFiles inputRef={actions.inputRef} onPick={actions.pick} onProject={links.show} />
        ) : null}
      </div>
      <FileThumbs
        files={part.pictures}
        onOpen={(file, index) => setViewing(index)}
        onRemove={onRemove}
      />
      {part.pictures.length && part.others.length ? <div className={styles.gap} /> : null}
      <FileRows files={part.others} onRemove={onRemove} />
      {part.count === 0 && items.length === 0 ? <p className={styles.muted}>{NO_FILES}</p> : null}
      <BatchChips items={items} taskId={task.id} attach={attach} focusAdd={actions.focusAdd} />
      {viewing !== null ? (
        <PictureViewer
          files={part.pictures}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {part.canChange ? <Picker task={task} links={links} onCloseWindow={onCloseWindow} /> : null}
    </section>
  );
}
