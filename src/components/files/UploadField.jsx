'use client';
// The Files field of the New task and Edit task windows (CONTRACT 27, Board tab "Files field",
// Upload states): a drop box with a Paperclip, "Drag files here, or" and "Choose files" (the label
// of a visually hidden `<input type="file" multiple>`, no `accept`; the phone's "Attach files" has
// its own, so each input is named by the label that shows), the help line, the chips
// (two a line, one on a phone) and, when editing, the task's files with an X that marks them
// "Removed when you save". Files dragged over the whole window turn the box --primary-soft with
// "Drop to attach"; the window takes the drop. On a phone the box is a full-width "Attach files".
// While files upload the page asks before it is left. One polite region says the milestones.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Info, Paperclip } from 'lucide-react';
import Skeleton from '@/components/Skeleton';
import { formatSize } from '@/modules/projectFiles/kinds';
import * as fileMessages from '@/modules/projectFiles/fileMessages';
import { UploadAnnouncer } from './uploadAnnouncer';
import { UploadChips } from './UploadChip';
import { BIG_FILE_BYTES, RUNNING } from './uploadItems';
import { DEFAULT_LIMITS } from './uploadSet';
import { uploadingLeaveMessage, useLeaveGuard } from './leaveGuard';
import styles from './Files.module.css';

const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/**
 * Files dragged over the window around `rootRef` (the Dialog panel, else the field): true while
 * over it; a drop there goes to `onFiles`. A file dropped beside the window is swallowed, so the
 * browser never opens it in place of Daybook.
 */
function useWindowDrop(rootRef, onFiles, enabled) {
  const [over, setOver] = useState(false);
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return undefined;
    const area = root.closest('[role="dialog"]') ?? root;
    const onOver = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setOver(true);
    };
    const onLeave = (event) => {
      if (!area.contains(event.relatedTarget)) setOver(false);
    };
    const onDrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(false);
      onFilesRef.current(event.dataTransfer.files);
    };
    const swallow = (event) => {
      if (hasFiles(event)) event.preventDefault();
    };
    area.addEventListener('dragenter', onOver);
    area.addEventListener('dragover', onOver);
    area.addEventListener('dragleave', onLeave);
    area.addEventListener('drop', onDrop);
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      area.removeEventListener('dragenter', onOver);
      area.removeEventListener('dragover', onOver);
      area.removeEventListener('dragleave', onLeave);
      area.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, [rootRef, enabled]);
  return over;
}

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

/**
 * @param {{ id: string, uploads: object, limits: { maxFileBytes: number, maxTaskFiles: number,
 *   pickMax: number }, label?: string, help?: string, dropText?: string, phoneLabel?: string,
 *   attached?: object[], removedIds?: number[], onToggleRemove?: (fileId: number) => void,
 *   loadingAttached?: boolean, attachedError?: boolean, storageReady?: boolean,
 *   error?: string | null }} props uploads: what useUploads returns (it reads items, add,
 *   remove, retry, notices and announcement, so a page may pass a narrowed copy); attached: the
 *   task's ProjectFiles; removedIds: the ones marked "Removed when you save"; error: the
 *   field's own message under it (a refused save, a paused chip that blocks Save)
 */
export default function UploadField({
  id,
  uploads,
  limits = DEFAULT_LIMITS,
  label = 'Files',
  help,
  dropText = 'Drop to attach',
  phoneLabel = 'Attach files',
  attached = [],
  removedIds = [],
  onToggleRemove,
  loadingAttached = false,
  attachedError = false,
  storageReady = true,
  error = null,
}) {
  const fallbackId = useId();
  const base = id ?? fallbackId;
  const rootRef = useRef(null);
  const chooseRef = useRef(null);
  const phoneRef = useRef(null);
  const kept = attached.filter((file) => !removedIds.includes(file.id));
  const existing = kept.map((file) => ({ name: file.name, size: file.sizeBytes }));
  const add = (files) => uploads.add(files, { existing });
  const over = useWindowDrop(rootRef, add, storageReady);
  const running = uploads.items.filter((item) => RUNNING.includes(item.state)).length;
  useLeaveGuard(running > 0, uploadingLeaveMessage(running));
  // Choose files, or Attach files on a phone (the one whose label shows)
  const focusChoose = useCallback(() => {
    const shown = [chooseRef.current, phoneRef.current].find(
      (input) => input?.closest('label')?.offsetParent,
    );
    shown?.focus();
  }, []);

  const big = uploads.items.some((item) => item.size > BIG_FILE_BYTES && item.state !== 'error');
  const helpText = `${help ?? taskFilesHelp(limits)}${big ? ' Big files take a few minutes.' : ''}`;
  const lines = [...(uploads.notices ?? []), ...(error ? [error] : [])];
  const chips = [...attachedItems(attached), ...uploads.items];

  function onPick(event) {
    if (event.target.files?.length) add(event.target.files);
    event.target.value = '';
  }

  return (
    <div ref={rootRef} className={`${styles.field} ${over ? styles.dragIn : ''}`}>
      <span className={styles.label} id={`${base}-label`}>
        {label}
      </span>
      {storageReady ? (
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
      ) : (
        <p className={styles.line}>
          <Info size={16} strokeWidth={1.8} aria-hidden="true" />
          {fileMessages.storageOff()}
        </p>
      )}
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
      <UploadChips
        items={chips}
        onRemove={uploads.remove}
        onRetry={uploads.retry}
        removedIds={removedIds}
        onToggleRemove={onToggleRemove}
        focusFallback={focusChoose}
        labelledBy={`${base}-label`}
      />
      <UploadAnnouncer text={uploads.announcement ?? ''} />
    </div>
  );
}
