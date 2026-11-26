'use client';
// The "From project files" picker (CONTRACT 28, "From project files" picker and the share confirm):
// a 720 px Dialog (a full-screen sheet on a phone) stacked over the New / Edit task window or the
// task window, listing the project's Files tab files to attach to the task as links: places at the
// left, search, ticks, "2 picked", Cancel and "Attach 2 files". When a picked file is "Only PM and
// Admins" and the task's person (the form's choice, or the task's) isn't a manager, the footer
// becomes the share confirm with "Attach and share". `onAttach` gets the picked PickerFiles; it may
// answer `{ ask: true, assignee }` (the server refused: the task is someone else's now), and the
// confirm shows again naming that person. The parent closes the picker after a good attach (focus
// goes back to what opened it). Before migration 020 it says so and attaches nothing.
import { useState } from 'react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { ATTACH_AND_SHARE, shareWithOf } from './shareConfirmView';
import {
  PICKER_DESC,
  PICKER_TITLE,
  UPDATE_NEEDED,
  attachLabel,
  pickedText,
  pickedToShare,
  pickerShareText,
} from './filesPickerView';
import { PickerBody } from './FilesPickerParts';
import ShareConfirm from './ShareConfirm';
import { usePickerFiles } from './usePickerFiles';
import styles from './FilesPicker.module.css';

const fresh = () => ({ place: null, query: '', picked: [], ask: null, busy: false });

/** The picker's own state, fresh each time it opens. */
function usePickerState(open) {
  const [state, setState] = useState(() => ({ open, ...fresh() }));
  let shown = state;
  if (open && !state.open) {
    shown = { open: true, ...fresh() };
    setState(shown);
  } else if (!open && state.open) {
    shown = { ...state, open: false };
    setState(shown);
  }
  const update = (change) => setState((now) => ({ ...now, ...change }));
  return [shown, update];
}

/** Attach: asks first when a picked file would be shared, then hands the files over. */
function useAttach({ state, update, files, assignee, project, onAttach }) {
  return async function attach(confirmed = false) {
    const picked = files.filter((file) => state.picked.includes(file.id));
    if (picked.length === 0 || state.busy) return;
    const holder = state.ask ? state.ask.assignee : assignee;
    const shared = pickedToShare(files, state.picked, holder, project);
    if (shared.length > 0 && !confirmed) {
      update({ ask: { assignee: holder ?? null } });
      return;
    }
    update({ busy: true });
    const options = { shareConfirmed: shared.length > 0, shareWith: shareWithOf(holder) };
    const answer = await Promise.resolve(onAttach(picked, options)).catch(() => null);
    if (answer?.ask) update({ busy: false, ask: { assignee: answer.assignee ?? null } });
    else update({ busy: false });
  };
}

/** The footer: "2 picked", Cancel and Attach; the share confirm; or Cancel alone. */
function Footer({ data, state, update, files, attach, onClose }) {
  if (data.state === 'update') {
    return (
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
    );
  }
  if (state.ask) {
    const picked = files.filter((file) => state.picked.includes(file.id));
    const shared = picked.filter((file) => file.visibility === 'managers');
    return (
      <ShareConfirm
        text={pickerShareText(shared, state.ask.assignee?.name ?? null)}
        confirmLabel={ATTACH_AND_SHARE}
        busy={state.busy}
        onBack={() => update({ ask: null })}
        onConfirm={() => attach(true)}
      />
    );
  }
  const count = state.picked.length;
  return (
    <>
      <span className={`${styles.count} num`}>{pickedText(count)}</span>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button aria-disabled={count === 0 || state.busy || undefined} onClick={() => attach()}>
        {attachLabel(count)}
      </Button>
    </>
  );
}

/**
 * @param {{ projectId: number, taskId?: number | null,
 *   assignee: { id: number, name?: string, role: string, status: string } | null,
 *   project: { id: number, pmId: number | null }, existing?: number[], open: boolean,
 *   phase?: string | null,
 *   onAttach: (files: object[], options: { shareConfirmed: boolean, shareWith: number | '' }) =>
 *     void | Promise<void | { ask: true, assignee: object | null }>,
 *   onClose: () => void, onOpenFiles?: () => void }} props taskId: none for a task not saved yet;
 *   assignee: the task's person after the save (null = anyone on the project); existing: the
 *   file ids already on the task or picked in the form; phase: the form's phase (the place the
 *   picker opens on for a new task); onOpenFiles: "Open Files" in the empty state
 */
export default function FilesPicker(props) {
  const { projectId, taskId = null, assignee, project, existing = [], open } = props;
  const { onAttach, onClose, onOpenFiles } = props;
  const data = usePickerFiles({ projectId, taskId, open });
  const [state, update] = usePickerState(open);
  const attach = useAttach({ state, update, files: data.files, assignee, project, onAttach });
  return (
    <Dialog
      open={open}
      width={720}
      className={styles.panel}
      title={PICKER_TITLE}
      description={PICKER_DESC}
      onClose={onClose}
      footer={
        <Footer
          data={data}
          state={state}
          update={update}
          files={data.files}
          attach={attach}
          onClose={onClose}
        />
      }
    >
      {data.state === 'update' ? (
        <p className={styles.update}>{UPDATE_NEEDED}</p>
      ) : (
        <PickerBody
          data={data}
          state={state}
          phase={props.phase ?? null}
          existing={existing}
          onChange={update}
          onOpenFiles={onOpenFiles}
        />
      )}
    </Dialog>
  );
}
