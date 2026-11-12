'use client';
// The inline note row of "Files and notes" (CONTRACT 22), as the prototype: a title, the text, then
// Add note (or Save) and Cancel. Editing a note fetches its text first and sends only what changed.
// The limits are the API's own (the same schema), so a note that is too long never leaves the page.
// A saved row closes together with the page refresh, so the note never blinks in late.
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import { api } from '@/lib/apiClient';
import {
  documentCreateSchema,
  documentUpdateSchema,
  MAX_TITLE_LENGTH,
} from '@/modules/projectSummaries/schemas';
import { useDocumentBody } from './useDocumentBody';
import styles from './PhaseDocuments.module.css';

/** The first thing wrong with the note, as the API would say it, and which field it is in. */
function problemOf({ phase, note, title, text }) {
  const parsed = note
    ? documentUpdateSchema.safeParse({ title, text })
    : documentCreateSchema.safeParse({ phase, kind: 'note', title, text });
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  return { field: issue.path[0] === 'text' ? 'text' : 'title', message: issue.message };
}

/** The API's error as the row shows it: the field it names, or its message. */
function failureOf(failure) {
  const field = ['title', 'text'].find((key) => failure.fields?.[key]);
  return { field: field ?? null, message: field ? failure.fields[field] : failure.message };
}

/** The request a saved row sends: the whole note when adding, only what changed for an edit. */
function requestFor({ projectId, phase, note, original, title, text }) {
  if (!note) {
    const body = { phase, kind: 'note', title, text };
    return { method: 'post', path: `/api/projects/${projectId}/documents`, body };
  }
  const body = {};
  if (title !== note.title) body.title = title;
  if (text !== original) body.text = text;
  return { method: 'patch', path: `/api/project-documents/${note.id}`, body };
}

/** The row's values, its error and saving. */
function useNoteRow({ projectId, phase, note, original, onClose }) {
  const router = useRouter();
  const titleRef = useRef(null);
  const textRef = useRef(null);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState(null);
  const [title, setTitle] = useState(note?.title ?? '');
  const [text, setText] = useState(original ?? '');

  const change = (set) => (event) => {
    set(event.target.value);
    setError(null);
  };

  function save(event) {
    event.preventDefault();
    if (saving) return;
    const problem = problemOf({ phase, note, title, text });
    if (problem) {
      setError(problem);
      (problem.field === 'text' ? textRef : titleRef).current?.focus();
      return;
    }
    const { method, path, body } = requestFor({ projectId, phase, note, original, title, text });
    if (Object.keys(body).length === 0) return onClose();
    startSaving(async () => {
      try {
        await api[method](path, body);
        startSaving(() => {
          onClose();
          router.refresh();
        });
      } catch (failure) {
        setError(failureOf(failure));
      }
    });
  }

  return { title, text, setTitle, setText, change, error, saving, save, titleRef, textRef };
}

/** Add note (or Save) and Cancel. */
function NoteButtons({ label, saving, waiting, onClose }) {
  return (
    <span className={styles.formButtons}>
      <Button
        type="submit"
        size="compact"
        className={styles.formButton}
        loading={saving}
        disabled={waiting}
      >
        {label}
      </Button>
      <Button variant="secondary" size="compact" className={styles.formButton} onClick={onClose}>
        Cancel
      </Button>
    </span>
  );
}

/**
 * The row itself.
 * @param {{ projectId: number, phase: string, note?: object | null, original?: string,
 *   waiting?: boolean, loadError?: string | null, onClose: () => void }} props original: the
 *   note's text when editing; waiting: that text isn't here yet; loadError: why it couldn't be
 *   fetched
 */
function NoteRow({ projectId, phase, note, original, waiting = false, loadError = null, onClose }) {
  const row = useNoteRow({ projectId, phase, note, original, onClose });
  const { title, text, setTitle, setText, change, saving, save, titleRef, textRef } = row;
  const error = row.error ?? (loadError ? { field: null, message: loadError } : null);
  return (
    <form
      className={styles.form}
      onSubmit={save}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <Input
        ref={titleRef}
        compact
        className={styles.formField}
        aria-label="Note title"
        placeholder="Title"
        maxLength={MAX_TITLE_LENGTH}
        autoComplete="off"
        autoFocus
        disabled={waiting}
        value={title}
        error={error?.field === 'title'}
        onChange={change(setTitle)}
      />
      <Textarea
        ref={textRef}
        rows={4}
        className={`${styles.formField} ${styles.noteText}`}
        aria-label="Note text"
        placeholder={waiting && !loadError ? 'Loading the note…' : 'Text'}
        disabled={waiting}
        value={text}
        error={error?.field === 'text'}
        onChange={change(setText)}
      />
      {error ? (
        <p className={styles.formError} role="alert">
          {error.message}
        </p>
      ) : null}
      <NoteButtons label={note ? 'Save' : 'Add note'} {...{ saving, waiting, onClose }} />
    </form>
  );
}

/** Editing: the row waits for the note's text (its fields off), then starts again from it. */
function EditNote({ note, ...rest }) {
  const text = useDocumentBody(note);
  if (text.status === 'ready') {
    return <NoteRow key="ready" note={note} original={text.body} {...rest} />;
  }
  const loadError = text.status === 'error' ? text.message : null;
  return <NoteRow key="waiting" note={note} waiting loadError={loadError} {...rest} />;
}

/**
 * @param {{ projectId: number, phase: string, note?: object | null, onClose: () => void }} props
 *   note: the one being edited (a listDocuments row), none to add
 */
export default function NoteForm({ note = null, ...rest }) {
  return note ? <EditNote note={note} {...rest} /> : <NoteRow {...rest} />;
}
