'use client';
// "Request a project" from the report's picker: name and a short note for the PM. When a similar
// project or request already exists, the dialog suggests it (use it, or send anyway). A sent
// request can be logged to right away; it shows "Waiting for approval".
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './RequestProjectDialog.module.css';

function findActive(picker, projectId) {
  const all = [...(picker.urgent ?? []), ...(picker.mine ?? []), ...(picker.others ?? [])];
  return all.find((project) => project.id === projectId) ?? null;
}

function similarText(similar) {
  if (similar.kind === 'request') {
    return `${similar.requestedByName ?? 'Someone'} already asked for ${similar.name}. It is waiting for approval.`;
  }
  const client = similar.clientName ? ` (${similar.clientName})` : '';
  return `${similar.name}${client} already exists.`;
}

/**
 * @param {{ open: boolean, onClose: () => void, picker: object,
 *   onPicked: (pick: { projectId?: number, projectRequestId?: number, name: string,
 *   color?: string | null, isUrgent?: boolean }) => void }} props
 */
export default function RequestProjectDialog({ open, onClose, picker, onPicked }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [similar, setSimilar] = useState(null);
  const [sending, setSending] = useState(false);
  const existing = similar?.kind === 'project' ? findActive(picker, similar.id) : null;

  function reset() {
    setName('');
    setNote('');
    setErrors({});
    setSimilar(null);
  }

  function close() {
    if (sending) return;
    reset();
    onClose();
  }

  async function send({ sendAnyway = false } = {}) {
    const values = { name: name.trim(), note: note.trim() };
    const problems = {};
    if (!values.name) problems.name = 'Enter the project name.';
    if (!values.note) problems.note = 'Add a short note for your PM.';
    if (Object.keys(problems).length) {
      setErrors(problems);
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post('/api/project-requests', { ...values, sendAnyway });
      setSending(false);
      if (!data?.request) {
        setSimilar(data?.similarProject ?? null);
        return;
      }
      toast({ title: 'Project request sent', body: 'You can log hours to it while it waits.' });
      onPicked({ projectRequestId: data.request.id, name: data.request.name });
      reset();
      onClose();
      router.refresh();
    } catch (error) {
      setSending(false);
      const fields = error?.fields ?? {};
      setErrors(
        fields.name || fields.note
          ? fields
          : { form: error?.message ?? 'The request was not sent. Please try again.' },
      );
    }
  }

  function pickExisting() {
    onPicked({
      projectId: existing.id,
      name: existing.name,
      color: existing.color,
      isUrgent: existing.isUrgent,
    });
    reset();
    onClose();
  }

  const footer = similar ? (
    <>
      <Button variant="secondary" onClick={() => send({ sendAnyway: true })} loading={sending}>
        Send anyway
      </Button>
      {existing ? <Button onClick={pickExisting}>Use {existing.name}</Button> : null}
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={close} disabled={sending}>
        Cancel
      </Button>
      <Button type="submit" loading={sending}>
        Send request
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Request a project"
      description="Your PM adds it to Daybook. You can log hours to it while it waits."
      footer={footer}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <div className={styles.fields}>
        <Field label="Project name" htmlFor={`${id}-name`} error={errors.name}>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={120}
            placeholder="For example: acme-blog"
            data-autofocus
            onChange={(event) => {
              setName(event.target.value);
              setSimilar(null);
              setErrors((current) => ({ ...current, name: undefined, form: undefined }));
            }}
          />
        </Field>
        <Field label="Note for your PM" htmlFor={`${id}-note`} error={errors.note}>
          <Textarea
            id={`${id}-note`}
            value={note}
            maxLength={500}
            rows={3}
            placeholder="Who it's for and what it covers"
            onChange={(event) => {
              setNote(event.target.value);
              setErrors((current) => ({ ...current, note: undefined, form: undefined }));
            }}
          />
        </Field>
        {similar ? (
          <p className={styles.similar} role="status">
            {similarText(similar)}{' '}
            {existing
              ? 'Use it, or send your request anyway.'
              : 'Send your request anyway if yours is different.'}
          </p>
        ) : null}
        {errors.form ? (
          <p className={styles.formError} role="alert">
            {errors.form}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
