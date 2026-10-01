'use client';
// "Request a project": a small dialog with a name and a note. When the server finds a project or
// request with a similar name, the dialog shows it and the person can still send theirs.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './RequestProjectButton.module.css';

export default function RequestProjectButton({ variant = 'primary', className }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        icon={<Plus size={18} strokeWidth={1.8} aria-hidden="true" />}
        onClick={() => setOpen(true)}
        className={className}
      >
        Request a project
      </Button>
      {open ? <RequestProjectDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SimilarNotice({ similar }) {
  if (similar.kind === 'request') {
    return (
      <div className={styles.similar} role="status">
        <p className={styles.similarTitle}>Someone already asked for this</p>
        <p className={styles.similarBody}>
          {similar.requestedByName} asked for <strong>{similar.name}</strong>. Their PM will add it
          soon, so you may not need to send yours.
        </p>
      </div>
    );
  }
  const completed = similar.status === 'completed';
  return (
    <div className={styles.similar} role="status">
      <p className={styles.similarTitle}>There is already a project called {similar.name}</p>
      <p className={styles.similarBody}>
        {similar.clientName ? `It is for ${similar.clientName}. ` : ''}
        {completed
          ? 'It is completed. If this is new work, send your request anyway.'
          : 'If it is the same work, log your hours to it instead. Otherwise, send your request anyway.'}
      </p>
    </div>
  );
}

function RequestProjectDialog({ onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [similar, setSimilar] = useState(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors({});
    setFormError('');
    try {
      const { data } = await api.post('/api/project-requests', {
        name,
        note,
        sendAnyway: Boolean(similar),
      });
      if (!data?.request) {
        setSimilar(data?.similarProject ?? null);
        return;
      }
      toast({
        title: 'Request sent',
        body: `Your PM will add ${data.request.name}. You can log hours to it today.`,
      });
      onClose();
      router.refresh();
    } catch (error) {
      const fields = error.fields ?? {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Request a project"
      description="Your PM gets a message and adds it. You can still log hours to it today."
      onSubmit={onSubmit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {similar ? 'Send anyway' : 'Send request'}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <Field label="Project name" htmlFor="request-name" error={errors.name}>
          <Input
            id="request-name"
            value={name}
            maxLength={120}
            autoComplete="off"
            placeholder="For example: acme-blog"
            error={Boolean(errors.name)}
            onChange={(event) => {
              setName(event.target.value);
              setSimilar(null);
            }}
            data-autofocus
          />
        </Field>
        <Field label="Note for your PM" htmlFor="request-note" error={errors.note}>
          <Textarea
            id="request-note"
            value={note}
            maxLength={500}
            rows={3}
            placeholder="What is it for? For example: Client wants monthly blog posts."
            error={Boolean(errors.note)}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {similar ? <SimilarNotice similar={similar} /> : null}
        {formError ? (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
