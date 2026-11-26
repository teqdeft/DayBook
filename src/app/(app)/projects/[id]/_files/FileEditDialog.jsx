'use client';
// Edit details (CONTRACT 27, Files tab): for a file its Name (the base name; the extension shows
// as a fixed ".pdf" after the input and never changes, Names), for a text-only document its Title;
// project files and text-only documents also have Place and Who can see it (a task's file goes
// where its task goes). While "Only PM and Admins" is chosen for a file on tasks of people who
// aren't managers, a line says who can still open it from those tasks (CONTRACT 28). Save sends what
// changed to `PATCH /api/project-files/[id]` or the document route, then the toast "Changes
// saved."; the tab then closes the window with its new data and puts focus back in the list
// (useFilesTab's `saved`). Save stays focusable while it works (BusyButton).
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Input from '@/components/Input';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import BusyButton from '../BusyButton';
import windowStyles from '../projectWindows.module.css';
import { PlaceField, VisibilityField } from './FileChoices';
import { keepLine, optionPhase, phaseOption } from './filesTabView';
import styles from './FileDialogs.module.css';

const MAX_NAME = 200;

/**
 * A file's name without its stored extension: 'brief.pdf' with ext 'pdf' is 'brief'.
 * @param {{ name: string, ext?: string }} file
 * @returns {{ base: string, ext: string }} ext with its dot ('.pdf'), or ''
 */
export function splitStoredName({ name, ext }) {
  const suffix = ext ? `.${ext}` : '';
  const has = suffix && name.toLowerCase().endsWith(suffix.toLowerCase()) && name !== suffix;
  return { base: has ? name.slice(0, -suffix.length) : name, ext: suffix };
}

/** What Edit details starts from, for a file or a text-only document. */
function startOf(item) {
  if (item.type === 'text') return { base: item.name, ext: '', phase: item.phase };
  return { ...splitStoredName(item.file), phase: item.phase };
}

/**
 * The request a save sends: only what changed. A file's name is its base name.
 * @returns {{ path: string, body: object }}
 */
export function editRequest(item, { name, phase, visibility }) {
  const start = startOf(item);
  const body = {};
  const text = item.type === 'text';
  if (name !== start.base) body[text ? 'title' : 'name'] = name;
  if (item.type !== 'task') {
    if (phase !== item.phase) body.phase = phase;
    if (visibility !== item.visibility) body.visibility = visibility;
  }
  const path = text ? `/api/project-documents/${item.id}` : `/api/project-files/${item.id}`;
  return { path, body };
}

function useEditForm(item, nameRef, { onClose, onSaved }) {
  const router = useRouter();
  const toast = useToast();
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState(null); // { field, message }
  const start = startOf(item);
  const [values, setValues] = useState(() => ({
    name: start.base,
    phase: item.phase,
    visibility: item.visibility ?? 'managers',
  }));
  const set = (key) => (value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  function save(event) {
    event.preventDefault();
    if (saving) return;
    const name = values.name.trim();
    const wrong = !name
      ? 'Write a name.'
      : name.length > MAX_NAME
        ? 'Keep the name to 200 characters.'
        : null;
    if (wrong) {
      setError({ field: 'name', message: wrong });
      nameRef.current?.focus();
      return;
    }
    const { path, body } = editRequest(item, { ...values, name });
    if (Object.keys(body).length === 0) return onClose();
    startSaving(async () => {
      try {
        await api.patch(path, body);
        toast({ title: 'Changes saved.' });
        startSaving(() => {
          if (onSaved) return onSaved(item);
          onClose();
          router.refresh();
        });
      } catch (failure) {
        const field = ['name', 'title', 'phase', 'visibility'].find((key) => failure.fields?.[key]);
        if (field)
          setError({ field: field === 'title' ? 'name' : field, message: failure.fields[field] });
        else toast({ title: "Couldn't save the changes", body: failure.message, tone: 'error' });
      }
    });
  }

  return { values, set, error, saving, save, ext: start.ext };
}

function EditWindow({ item, currentPhase, pmName, onClose, onSaved }) {
  const nameRef = useRef(null);
  const form = useEditForm(item, nameRef, { onClose, onSaved });
  const { values, set, error } = form;
  const project = item.type !== 'task';
  const nameError = error?.field === 'name' ? error.message : null;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit details"
      width={560}
      className={`${styles.panel} ${windowStyles.window}`}
      onSubmit={form.save}
      footer={
        <>
          <Button variant="secondary" className={styles.second} onClick={onClose}>
            Cancel
          </Button>
          <BusyButton type="submit" className={styles.main} busy={form.saving}>
            Save changes
          </BusyButton>
        </>
      }
    >
      <div className={styles.form}>
        <div>
          <label className={styles.label} htmlFor="file-edit-name">
            {item.type === 'text' ? 'Title' : 'Name'}
          </label>
          <div className={styles.nameRow}>
            <Input
              ref={nameRef}
              id="file-edit-name"
              maxLength={MAX_NAME}
              autoComplete="off"
              data-autofocus
              value={values.name}
              error={Boolean(nameError)}
              aria-describedby={nameError ? 'file-edit-name-error' : undefined}
              onChange={(event) => set('name')(event.target.value)}
            />
            {form.ext ? (
              <span className={styles.ext} aria-label="File type">
                {form.ext}
              </span>
            ) : null}
          </div>
          {nameError ? (
            <p className={styles.error} id="file-edit-name-error" role="alert">
              {nameError}
            </p>
          ) : null}
        </div>
        {project ? (
          <>
            <PlaceField
              id="file-edit-place"
              label="Place"
              value={phaseOption(values.phase)}
              currentPhase={currentPhase}
              error={error?.field === 'phase' ? error.message : null}
              onChange={(value) => set('phase')(optionPhase(value))}
            />
            <div>
              <VisibilityField
                name="file-edit-visibility"
                value={values.visibility}
                pmName={pmName}
                onChange={set('visibility')}
              />
              <p className={styles.keep} aria-live="polite">
                {values.visibility === 'managers' ? keepLine(item.file) : null}
              </p>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * @param {{ item: object | null, currentPhase: string | null, pmName: string | null,
 *   onClose: () => void, onSaved?: (item: object) => void }} props item: the filesItems file,
 *   task file or text-only document; null when closed; onSaved: after a save, closes the window
 *   with the page's new data (else it closes and refreshes itself)
 */
export default function FileEditDialog({ item, ...rest }) {
  if (!item) return null;
  return <EditWindow key={item.key} item={item} {...rest} />;
}
