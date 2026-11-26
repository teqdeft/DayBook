'use client';
// The Files field of the Files tab's upload window (CONTRACT 27, Upload states) and of the New task
// and Edit task windows (CONTRACT 28, New task and Edit task, Files). The Files tab's (1.12): a
// drop box with a Paperclip, "Drag files here, or" and "Choose files" (the label of a visually
// hidden `<input type="file" multiple>`, no `accept`; the phone's "Attach files" has its own, so
// each input is named by the label that shows). The task form's (`variant="task"`): two small
// buttons side by side, "Upload files" (the label of the file input) and "From project files"
// (the picker), then on a computer a slim drop box "Or drag files from your computer here".
// Both: the help line, one list of chips (two a line, one on a phone): the task's own files with
// an X that marks them "Removed when you save", the uploads, and the form's linked project files
// (`after`). Files dragged over the whole window turn the box --primary-soft with "Drop to attach";
// the window takes the drop. While files upload the page asks before it is left. One polite region
// says the milestones.
import { useCallback, useId, useRef } from 'react';
import { Folder, Info, Paperclip, Upload } from 'lucide-react';
import Button from '@/components/Button';
import buttonStyles from '@/components/Button.module.css';
import Skeleton from '@/components/Skeleton';
import { formatSize } from '@/modules/projectFiles/kinds';
import * as fileMessages from '@/modules/projectFiles/fileMessages';
import { UploadAnnouncer } from './uploadAnnouncer';
import { UploadChips } from './UploadChip';
import { BIG_FILE_BYTES, RUNNING } from './uploadItems';
import { DEFAULT_LIMITS } from './uploadSet';
import { uploadingLeaveMessage, useLeaveGuard } from './leaveGuard';
import { useWindowDrop } from './useWindowDrop';
import styles from './UploadField.module.css';

export const TASK_DROP_TEXT = 'Or drag files from your computer here';

/** The task's files as chips: `{ id, fileId, name, size, ext, state: 'attached', thumbUrl }`. */
export function attachedItems(files) {
  return files.map((file) => ({
    id: `file-${file.id}`,
    fileId: file.id,
    name: file.name,
    size: file.sizeBytes,
    ext: file.ext,
    state: 'attached',
    thumbUrl: file.isPicture ? file.thumbUrl : null,
  }));
}

/** "Up to 20 files, each up to 500 MB. Any type of file." */
export function taskFilesHelp(limits) {
  return `Up to ${limits.maxTaskFiles} files, each up to ${formatSize(limits.maxFileBytes)}. Any type of file.`;
}

/** The Files tab's drop box: "Drag files here, or Choose files", and the phone's "Attach files". */
function TabPick({ base, chooseRef, phoneRef, dropText, phoneLabel, onPick }) {
  return (
    <>
      <div className={styles.drop}>
        <Paperclip size={20} strokeWidth={1.8} aria-hidden="true" />
        <span>Drag files here, or</span>
        <label className={styles.choose}>
          Choose files
          <input
            ref={chooseRef}
            id={`${base}-input`}
            className="visually-hidden"
            type="file"
            multiple
            aria-describedby={`${base}-help`}
            onChange={onPick}
          />
        </label>
        <span className={styles.dropOn}>{dropText}</span>
      </div>
      <label className={styles.attachPhone}>
        <Paperclip size={16} strokeWidth={1.8} aria-hidden="true" />
        {phoneLabel}
        <input
          ref={phoneRef}
          id={`${base}-phone-input`}
          className="visually-hidden"
          type="file"
          multiple
          aria-describedby={`${base}-help`}
          onChange={onPick}
        />
      </label>
    </>
  );
}

const SMALL_SECONDARY = `${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.sizeSmall}`;

/** The task form's two buttons ("Upload files", "From project files") and its slim drop box. */
function TaskPick({
  base,
  chooseRef,
  storageReady,
  dropText,
  onFromProject,
  fromProjectRef,
  onPick,
}) {
  return (
    <>
      <div className={styles.fileButtons} role="group" aria-labelledby={`${base}-label`}>
        {storageReady ? (
          <label className={`${SMALL_SECONDARY} ${styles.uploadButton}`}>
            <Upload size={16} strokeWidth={1.8} aria-hidden="true" />
            <span className={buttonStyles.label}>Upload files</span>
            <input
              ref={chooseRef}
              id={`${base}-input`}
              className="visually-hidden"
              type="file"
              multiple
              aria-describedby={`${base}-help`}
              onChange={onPick}
            />
          </label>
        ) : null}
        {onFromProject ? (
          <Button
            ref={fromProjectRef}
            variant="secondary"
            size="small"
            className={styles.fromProject}
            icon={<Folder size={16} strokeWidth={1.8} aria-hidden="true" />}
            onClick={onFromProject}
          >
            From project files
          </Button>
        ) : null}
      </div>
      {storageReady ? (
        <div className={`${styles.drop} ${styles.dropSlim}`}>
          <Paperclip size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{TASK_DROP_TEXT}</span>
          <span className={styles.dropOn}>{dropText}</span>
        </div>
      ) : null}
    </>
  );
}

/** The lines under the box: help (with "Big files take a few minutes."), notices, loading. */
function Lines({ base, helpText, lines, loadingAttached, attachedError }) {
  return (
    <>
      <p className={styles.help} id={`${base}-help`}>
        {helpText}
      </p>
      {lines.map((line) => (
        <p key={line} className={styles.notice} role="alert">
          {line}
        </p>
      ))}
      {loadingAttached ? (
        <Skeleton height={52} radius={10} className={styles.attachedSkeleton} />
      ) : null}
      {attachedError ? (
        <p className={styles.line}>Couldn&apos;t load this task&apos;s files.</p>
      ) : null}
    </>
  );
}

/**
 * @param {{ id: string, uploads: object, limits: { maxFileBytes: number, maxTaskFiles: number,
 *   pickMax: number }, label?: string, help?: string, dropText?: string, phoneLabel?: string,
 *   attached?: object[], removedIds?: number[], onToggleRemove?: (fileId: number) => void,
 *   loadingAttached?: boolean, attachedError?: boolean, storageReady?: boolean,
 *   error?: string | null, variant?: 'files' | 'task', onFromProject?: () => void,
 *   fromProjectRef?: object, linked?: object[], after?: import('react').ReactNode }} props
 *   uploads: what useUploads returns (it reads items, add, remove, retry, notices and
 *   announcement, so a page may pass a narrowed copy); attached: the task's own ProjectFiles;
 *   removedIds: the ones marked "Removed when you save"; error: the field's own message under
 *   it (a refused save, a paused chip that blocks Save); variant 'task': the New and Edit task
 *   field; onFromProject: "From project files"; linked: the linked files the save keeps (they
 *   count toward the 20); after: their chips, drawn last in the list
 */
export default function UploadField(props) {
  const { id, uploads, limits = DEFAULT_LIMITS, label = 'Files', help } = props;
  const { dropText = 'Drop to attach', phoneLabel = 'Attach files', attached = [] } = props;
  const { removedIds = [], onToggleRemove, loadingAttached = false } = props;
  const { attachedError = false, storageReady = true, error = null, variant = 'files' } = props;
  const { onFromProject, fromProjectRef, linked = [], after = null } = props;
  const fallbackId = useId();
  const base = id ?? fallbackId;
  const rootRef = useRef(null);
  const chooseRef = useRef(null);
  const phoneRef = useRef(null);
  const kept = attached.filter((file) => !removedIds.includes(file.id));
  const existing = [...kept, ...linked].map((file) => ({ name: file.name, size: file.sizeBytes }));
  const add = (files) => uploads.add(files, { existing });
  const over = useWindowDrop(rootRef, add, storageReady);
  const running = uploads.items.filter((item) => RUNNING.includes(item.state)).length;
  useLeaveGuard(running > 0, uploadingLeaveMessage(running));
  // Choose files (Upload files), or Attach files on a phone (the one whose label shows)
  const focusChoose = useCallback(() => {
    const shown = [chooseRef.current, phoneRef.current].find(
      (input) => input?.closest('label')?.offsetParent,
    );
    (shown ?? fromProjectRef?.current)?.focus();
  }, [fromProjectRef]);

  const big = uploads.items.some((item) => item.size > BIG_FILE_BYTES && item.state !== 'error');
  const helpText = `${help ?? taskFilesHelp(limits)}${big ? ' Big files take a few minutes.' : ''}`;
  const lines = [...(uploads.notices ?? []), ...(error ? [error] : [])];
  const chips = [...attachedItems(attached), ...uploads.items];

  function onPick(event) {
    if (event.target.files?.length) add(event.target.files);
    event.target.value = '';
  }

  const pick = { base, chooseRef, dropText, onPick };
  let top = <TabPick {...pick} phoneRef={phoneRef} phoneLabel={phoneLabel} />;
  if (variant === 'task') {
    top = (
      <TaskPick
        {...pick}
        storageReady={storageReady}
        onFromProject={onFromProject}
        fromProjectRef={fromProjectRef}
      />
    );
  }
  const off = (
    <p className={styles.line}>
      <Info size={16} strokeWidth={1.8} aria-hidden="true" />
      {fileMessages.storageOff()}
    </p>
  );
  return (
    <div
      ref={rootRef}
      className={[
        styles.field,
        variant === 'task' ? styles.taskField : null,
        over ? styles.dragIn : null,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.label} id={`${base}-label`}>
        {label}
      </span>
      {storageReady || variant === 'task' ? top : null}
      {storageReady ? null : off}
      <Lines
        base={base}
        helpText={helpText}
        lines={lines}
        {...{ loadingAttached, attachedError }}
      />
      <UploadChips
        items={chips}
        onRemove={uploads.remove}
        onRetry={uploads.retry}
        removedIds={removedIds}
        onToggleRemove={onToggleRemove}
        focusFallback={focusChoose}
        labelledBy={`${base}-label`}
        after={after}
      />
      <UploadAnnouncer text={uploads.announcement ?? ''} />
    </div>
  );
}
