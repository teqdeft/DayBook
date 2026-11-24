'use client';
// The New task and Edit task window's values, errors and save (CONTRACT 27, Board tab): the files
// picked join the tab's upload queue at once (useUploads, a task target); a save is refused while
// any file is still on its way, and a paused file blocks it with one line and focus on its Retry.
// A new task sends everything with its held upload keys; an edit sends only what changed, the
// files added and the attached ones marked removed (none of either when its files didn't load).
import { useRef, useState } from 'react';
import { focusChipRetry } from '@/components/files/UploadChip';
import { useUploads } from '@/components/files/useUploads';
import { forgetTaskDetails } from '@/components/task/useTaskDetails';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import {
  initialValues,
  pausedLine,
  saveError,
  saveRequest,
  savedResult,
  titleError,
  uploadCounts,
} from './taskFormModel';

const NO_ERROR = { field: null, files: null, message: '' };

/** The fields' values, the error under a field (cleared by the next change), the files removed. */
function useTaskValues({ form, task, plan }) {
  const [values, setValues] = useState(() =>
    initialValues({ task, preset: form.preset, currentPhase: plan.currentPhase }),
  );
  const [error, setError] = useState(NO_ERROR);
  const [removedIds, setRemovedIds] = useState([]);
  const set = (key) => (event) => {
    setValues((now) => ({ ...now, [key]: event.target.value }));
    if (error.field) setError(NO_ERROR);
  };
  const toggleRemove = (fileId) =>
    setRemovedIds((ids) =>
      ids.includes(fileId) ? ids.filter((id) => id !== fileId) : [...ids, fileId],
    );
  return { values, set, error, setError, removedIds, toggleRemove };
}

/**
 * The save: nothing while it runs or a file is on its way; a short title or a paused file stops it
 * with focus on the title or that file's Retry; an API error shows under its field (or the Files
 * field), anything else as a toast.
 */
function useTaskSave(input) {
  const { task, projectId, fields, uploads, counts, attachedError, refs, onClose, onSaved } = input;
  const toast = useToast();
  const [paused, setPaused] = useState(null);
  const [saving, setSaving] = useState(false);

  function stopped() {
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

  async function save(event) {
    event?.preventDefault();
    if (saving || counts.running > 0 || stopped()) return;
    const { values, removedIds } = fields;
    const request = { task, projectId, values, readyKeys: uploads.readyKeys, removedIds };
    const [method, path, body] = saveRequest({ ...request, attachedError });
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
      const next = saveError(failure);
      if (next.field || next.files) fields.setError(next);
      else toast({ title: "Couldn't save the task", body: next.message, tone: 'error' });
    }
  }

  return { save, saving, paused: counts.paused ? paused : null };
}

/**
 * @param {{ form: object, task: object | null, details: object, projectId: number, plan: object,
 *   limits: object, onClose: () => void, onSaved: (result: object) => void }} props
 *   TaskFormDialog's, with `task` (editable()) and `details` (useTaskDetails')
 */
export function useTaskForm({ form, task, details, projectId, plan, limits, onClose, onSaved }) {
  const fields = useTaskValues({ form, task, plan });
  const titleRef = useRef(null);
  const filesRef = useRef(null);
  const uploads = useUploads({ projectId, target: 'task', taskId: task?.id ?? null, limits });
  const counts = uploadCounts(uploads.items);
  const attachedError = Boolean(task && details.error && !details.task);
  const refs = { title: titleRef, files: filesRef };
  const saved = useTaskSave({
    task,
    projectId,
    fields,
    uploads,
    counts,
    attachedError,
    refs,
    onClose,
    onSaved,
  });
  return {
    values: fields.values,
    set: fields.set,
    error: fields.error,
    removedIds: fields.removedIds,
    toggleRemove: fields.toggleRemove,
    paused: saved.paused,
    saving: saved.saving,
    titleRef,
    filesRef,
    uploads,
    counts,
    attachedError,
    save: saved.save,
  };
}
