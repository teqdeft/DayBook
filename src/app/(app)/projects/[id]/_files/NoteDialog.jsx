'use client';
// New note and Edit note (CONTRACT 27, Files tab; from 1.11's NoteForm): Title, Text, Add to and
// Who can see it (Everyone preset; the radio's value is always sent), then (Edit: Delete on the
// left) Cancel and "Add note" or "Save changes". The limits are the API's own schemas, so a note
// that is too long never leaves the page. Editing fetches the note's text first and sends only
// what changed (with who can see it).
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import {
  documentCreateSchema,
  documentUpdateSchema,
  MAX_TITLE_LENGTH,
} from '@/modules/projectSummaries/schemas';
import { useDocumentBody } from '../useDocumentBody';
import windowStyles from '../projectWindows.module.css';
import { PlaceField, VisibilityField } from './FileChoices';
import { optionPhase, phaseOption } from './filesTabView';
import styles from './FileDialogs.module.css';

const FIELDS = ['title', 'text', 'phase', 'visibility'];

/** The first thing wrong with the note, as the API would say it, and which field it is in. */
function problemOf({ note, values }) {
  const parsed = note
    ? documentUpdateSchema.safeParse({ title: values.title, text: values.text })
    : documentCreateSchema.safeParse({ ...values, kind: 'note' });
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  const field = FIELDS.includes(issue.path[0]) ? issue.path[0] : 'title';
  return { field, message: issue.message };
}

/** The request a save sends: the whole note when adding, what changed (and who sees it) on edit. */
function requestFor({ projectId, note, original, values }) {
  if (!note) {
    return {
      method: 'post',
      path: `/api/projects/${projectId}/documents`,
      body: { kind: 'note', ...values },
    };
  }
  const body = {};
  if (values.title !== note.name) body.title = values.title;
  if (values.text !== original) body.text = values.text;
  if (values.phase !== note.phase) body.phase = values.phase;
  if (values.visibility !== note.visibility) body.visibility = values.visibility;
  if (Object.keys(body).length > 0) body.visibility = values.visibility;
  return { method: 'patch', path: `/api/project-documents/${note.id}`, body };
}

/** The API's error as the window shows it: the field it names, or its message. */
function failureOf(failure) {
  const field = FIELDS.find((key) => failure.fields?.[key]);
  return { field: field ?? null, message: field ? failure.fields[field] : failure.message };
}

function useNoteForm({ projectId, note, original, place, refs, onSaved }) {
  const router = useRouter();
  const toast = useToast();
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState(null);
  const [values, setValues] = useState(() => ({
    title: note?.name ?? '',
    text: original ?? '',
    phase: note ? note.phase : optionPhase(place),
    visibility: note?.visibility ?? 'everyone',
  }));
  const set = (key) => (value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  function save(event) {
    event.preventDefault();
    if (saving) return;
    const problem = problemOf({ note, values });
    if (problem) {
      setError(problem);
      refs[problem.field]?.current?.focus();
      return;
    }
    const { method, path, body } = requestFor({ projectId, note, original, values });
    if (Object.keys(body).length === 0) return onSaved(undefined);
    startSaving(async () => {
      try {
        await api[method](path, body);
        toast({ title: note ? 'Changes saved.' : 'Note added.' });
        startSaving(() => onSaved(values.phase));
        // After the place change: its History API update reaches Next's router as a restore,
        // which drops a refresh still on its way, so the new note would show only on a reload.
        setTimeout(() => router.refresh(), 0);
      } catch (failure) {
        setError(failureOf(failure));
      }
    });
  }

  return { values, set, error, saving, save };
}

function NoteFields({ form, titleRef, textRef, waiting, currentPhase, pmName }) {
  const { values, set, error } = form;
  const fieldError = (key) => (error?.field === key ? error.message : null);
  return (
    <div className={styles.form}>
      <div>
        <label className={styles.label} htmlFor="note-title">
          Title
        </label>
        <Input
          ref={titleRef}
          id="note-title"
          maxLength={MAX_TITLE_LENGTH}
          autoComplete="off"
          data-autofocus
          disabled={waiting}
          value={values.title}
          error={Boolean(fieldError('title'))}
          aria-describedby={fieldError('title') ? 'note-error' : undefined}
          onChange={(event) => set('title')(event.target.value)}
        />
      </div>
      <div>
        <label className={styles.label} htmlFor="note-text">
          Text
        </label>
        <Textarea
          ref={textRef}
          id="note-text"
          rows={7}
          placeholder={waiting ? 'Loading the note…' : undefined}
          disabled={waiting}
          value={values.text}
          error={Boolean(fieldError('text'))}
          aria-describedby={fieldError('text') ? 'note-error' : undefined}
          onChange={(event) => set('text')(event.target.value)}
        />
      </div>
      {error && (error.field === 'title' || error.field === 'text' || !error.field) ? (
        <p className={styles.error} id="note-error" role="alert">
          {error.message}
        </p>
      ) : null}
      <PlaceField
        id="note-place"
        label="Add to"
        value={phaseOption(values.phase)}
        currentPhase={currentPhase}
        error={fieldError('phase')}
        onChange={(value) => set('phase')(optionPhase(value))}
      />
      <VisibilityField
        name="note-visibility"
        value={values.visibility}
        pmName={pmName}
        onChange={set('visibility')}
      />
    </div>
  );
}

function NoteWindow({ projectId, note, original, waiting, loadError, place, ...rest }) {
  const { currentPhase, pmName, onClose, onSaved, onDelete } = rest;
  const titleRef = useRef(null);
  const textRef = useRef(null);
  const refs = { title: titleRef, text: textRef };
  const form = useNoteForm({ projectId, note, original, place, refs, onSaved });
  const shownError = form.error ?? (loadError ? { field: null, message: loadError } : null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={note ? 'Edit note' : 'New note'}
      width={560}
      className={`${styles.panel} ${windowStyles.window}`}
      onSubmit={form.save}
      footer={
        <>
          {note ? (
            <Button
              variant="danger"
              className={styles.left}
              icon={<Trash2 size={16} strokeWidth={1.8} />}
              onClick={(event) => onDelete(note, event)}
            >
              Delete
            </Button>
          ) : null}
          <Button variant="secondary" className={styles.second} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className={styles.main} loading={form.saving} disabled={waiting}>
            {note ? 'Save changes' : 'Add note'}
          </Button>
        </>
      }
    >
      <NoteFields
        form={{ ...form, error: shownError }}
        titleRef={titleRef}
        textRef={textRef}
        waiting={waiting}
        currentPhase={currentPhase}
        pmName={pmName}
      />
    </Dialog>
  );
}

/** Editing: the window waits for the note's text (its fields off), then starts again from it. */
function EditNote({ note, ...rest }) {
  const text = useDocumentBody(note.document);
  if (text.status === 'ready') {
    return <NoteWindow key="ready" note={note} original={text.body} {...rest} />;
  }
  const loadError = text.status === 'error' ? text.message : null;
  return <NoteWindow key="waiting" note={note} waiting loadError={loadError} {...rest} />;
}

/**
 * @param {{ open: boolean, projectId: number, note?: object | null, place: string,
 *   currentPhase: string | null, pmName: string | null, onClose: () => void,
 *   onSaved: (phase: string | null | undefined) => void,
 *   onDelete: (note: object, event: import('react').MouseEvent) => void }} props note: the
 *   filesItems note being edited, none to add; place: the place shown (a new note's preset);
 *   onSaved: the note's place after a save (undefined after an edit that changed nothing)
 */
export default function NoteDialog({ open, note = null, ...rest }) {
  if (!open) return null;
  return note ? <EditNote note={note} {...rest} /> : <NoteWindow {...rest} />;
}
