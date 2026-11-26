'use client';
// The New task and Edit task window's values, errors and save (CONTRACT 27, Board tab; CONTRACT 28,
// New task and Edit task): the files picked join the tab's upload queue at once (useUploads, a task
// target) and the project files picked in "From project files" become linked chips (useFormLinks);
// a save is refused while any file is still on its way, and a paused file blocks it with one line
// and focus on its Retry. A save that would let someone who isn't a manager open an "Only PM and
// Admins" file asks the share confirm first (in place of the footer), then sends `shareConfirmed`
// and `shareWith`. A new task sends everything with its held upload keys and links; an edit sends
// only what changed (`assigneeId` only when the checked chip differs from the task's person). A
// refused confirm reads the task again and asks again with its current person; a picked file
// deleted in Files meanwhile is struck as "No longer in Files" and left out of the next save.
import { useRef, useState } from 'react';
import { focusChipRetry } from '@/components/files/UploadChip';
import { useUploads } from '@/components/files/useUploads';
import { shareWithOf } from '@/components/files/shareConfirmView';
import { forgetTaskDetails } from '@/components/task/useTaskDetails';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import {
  assignChoices,
  chosenPerson,
  filesShared,
  initialValues,
  pausedLine,
  saveError,
  saveRequest,
  savedResult,
  shareAsked,
  titleError,
  uploadCounts,
} from './taskFormModel';
import { useFormLinks } from './useFormLinks';

const NO_ERROR = { field: null, files: null, message: '' };

/**
 * The fields' values, the error under a field (cleared by the next change), the files removed. A
 * task whose person changed elsewhere (read again after a refused confirm) moves the "Assign to"
 * chip with it, unless the person here picked another one.
 */
function useTaskValues({ form, task, plan }) {
  const [values, setValues] = useState(() =>
    initialValues({ task, preset: form.preset, currentPhase: plan.currentPhase }),
  );
  const [error, setError] = useState(NO_ERROR);
  const [removedIds, setRemovedIds] = useState([]);
  const owner = task?.assignee ? String(task.assignee.id) : '';
  const [baseline, setBaseline] = useState(owner);
  let shown = values;
  if (task && owner !== baseline) {
    setBaseline(owner);
    if (values.owner === baseline) {
      shown = { ...values, owner };
      setValues(shown);
    }
  }
  const set = (key) => (event) => {
    setValues((now) => ({ ...now, [key]: event.target.value }));
    if (error.field) setError(NO_ERROR);
  };
  const toggleRemove = (fileId) =>
    setRemovedIds((ids) =>
      ids.includes(fileId) ? ids.filter((id) => id !== fileId) : [...ids, fileId],
    );
  return { values: shown, set, error, setError, removedIds, toggleRemove };
}

/** A title too short or a paused file stops the save, with focus where it is needed. */
function stoppedBy({ fields, counts, refs, setPaused }) {
  const problem = titleError(fields.values.title);
  if (problem) {
    fields.setError({ field: 'title', files: null, message: problem });
    refs.title.current?.focus();
    return true;
  }
  if (!counts.paused) return false;
  setPaused(pausedLine(counts.paused.name));
  focusChipRetry(counts.paused.id, refs.files.current);
  return true;
}

/** What the save would share, and with whom. */
function sharePlan({ task, fields, links, choices, project }) {
  const owner = fields.values.owner;
  const person = chosenPerson(choices, owner);
  const personChanged = Boolean(task) && String(task.assignee?.id ?? '') !== owner;
  const files = filesShared({
    links: links.kept,
    existingIds: links.existingIds,
    personChanged,
    person,
    project,
  });
  return { owner, person, files };
}

/** After a refused save: the confirm again, the gone files struck, or the error shown. */
function useRefusal({ task, projectId, fields, links, setAsk }) {
  const toast = useToast();
  return async function refused(failure) {
    const next = saveError(failure);
    if (next.share) {
      links.clearConfirm();
      if (task) forgetTaskDetails(task.id); // the task is read again: its person, its links
      setAsk({ again: true });
      return;
    }
    if (next.gone) {
      const answer = await api.get(`/api/projects/${projectId}/files`).catch(() => null);
      const there = (answer?.data?.files ?? []).map((file) => Number(file.id));
      if (answer) links.markGone(links.add.filter((id) => !there.includes(Number(id))));
    }
    if (next.field || next.files) fields.setError(next);
    else toast({ title: "Couldn't save the task", body: next.message, tone: 'error' });
  };
}

/**
 * The save: nothing while it runs or a file is on its way; the share confirm first when needed;
 * an API error shows under its field (or the Files field), anything else as a toast.
 */
function useTaskSave(input) {
  const { task, projectId, fields, links, uploads, counts, attachedError, refs } = input;
  const { choices, project, onClose, onSaved } = input;
  const [paused, setPaused] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ask, setAsk] = useState(null);
  const refused = useRefusal({ task, projectId, fields, links, setAsk });

  async function save(event, { shareOk = false } = {}) {
    event?.preventDefault?.();
    if (saving || counts.running > 0 || stoppedBy({ fields, counts, refs, setPaused })) return;
    const plan = sharePlan({ task, fields, links, choices, project });
    if (!shareOk && shareAsked(plan.files, links.confirmed, plan.owner)) {
      setAsk({ again: false });
      return;
    }
    // After a refused confirm the server asked for it even when this window can't name the files.
    const shared = plan.files.length > 0 || shareOk;
    const share = shared ? { shareWith: shareWithOf(plan.person) } : null;
    const [method, path, body] = saveRequest({
      task,
      projectId,
      values: fields.values,
      readyKeys: uploads.readyKeys,
      removedIds: fields.removedIds,
      attachedError,
      links: { add: links.add, remove: links.remove },
      share,
    });
    if (task && Object.keys(body).length === 0) return onClose();
    setSaving(true);
    try {
      const { data } = await api[method](path, body);
      const result = savedResult({ data, task, body });
      forgetTaskDetails(result.id);
      uploads.forget?.(); // the held files are the task's now: no Cancel goes for them
      onClose();
      onSaved(result);
    } catch (failure) {
      setSaving(false);
      setAsk(null);
      await refused(failure);
    }
  }

  return { save, saving, paused: counts.paused ? paused : null, ask, setAsk };
}

/**
 * The confirm the footer shows: while asked, and while the save still shares a file (the chip
 * moved to a manager: no confirm), or always after the server asked for it.
 */
const shownShare = (ask, plan) => (ask && (plan.files.length > 0 || ask.again) ? plan : null);

/**
 * @param {{ form: object, task: object | null, details: object, projectId: number, plan: object,
 *   limits: object, options?: object[], viewerId?: number | null,
 *   project?: { id: number, pmId: number | null }, onClose: () => void,
 *   onSaved: (result: object) => void }} props TaskFormDialog's, with `task` (editable()) and
 *   `details` (useTaskDetails')
 */
export function useTaskForm(props) {
  const { form, task, details, projectId, plan, limits, onClose, onSaved } = props;
  const fields = useTaskValues({ form, task, plan });
  const links = useFormLinks({ details });
  const titleRef = useRef(null);
  const filesRef = useRef(null);
  const uploads = useUploads({ projectId, target: 'task', taskId: task?.id ?? null, limits });
  const counts = uploadCounts(uploads.items);
  const attachedError = Boolean(task && details.error && !details.task);
  const choices = assignChoices(props.options ?? [], task, props.viewerId ?? null);
  const project = props.project ?? { id: projectId, pmId: null };
  const refs = { title: titleRef, files: filesRef };
  const saved = useTaskSave({
    ...{ task, projectId, fields, links, uploads, counts, attachedError, refs },
    ...{ choices, project, onClose, onSaved },
  });
  return {
    values: fields.values,
    set: fields.set,
    error: fields.error,
    setError: fields.setError,
    removedIds: fields.removedIds,
    toggleRemove: fields.toggleRemove,
    links,
    choices,
    project,
    share: shownShare(saved.ask, sharePlan({ task, fields, links, choices, project })),
    shareAgain: Boolean(saved.ask?.again),
    backFromShare: () => saved.setAsk(null),
    paused: saved.paused,
    saving: saved.saving,
    titleRef,
    filesRef,
    uploads,
    counts: { ...counts, unsaved: counts.unsaved + links.fresh },
    attachedError,
    save: saved.save,
  };
}
