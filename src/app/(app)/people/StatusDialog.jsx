'use client';
// Confirmation before deactivating or reactivating someone.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './StatusDialog.module.css';

const COPY = {
  deactivate: {
    title: (name) => `Deactivate ${name}?`,
    description:
      "They're signed out everywhere, can't sign in, and leave dashboards and pickers. Their attendance and reports stay in Daybook.",
    button: 'Deactivate',
    done: (name) => `${name} deactivated`,
    doneBody: 'You can reactivate them from the same menu.',
  },
  reactivate: {
    title: (name) => `Reactivate ${name}?`,
    description: 'They can sign in with Slack again and show up on dashboards and pickers.',
    button: 'Reactivate',
    done: (name) => `${name} reactivated`,
    doneBody: 'They can sign in with Slack again.',
  },
};

/** @param {{ person: { id: number, name: string }, action: 'deactivate' | 'reactivate',
 *   onClose: () => void }} props */
export default function StatusDialog({ person, action, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const copy = COPY[action];

  async function confirm(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/users/${person.id}/${action}`);
      toast({ title: copy.done(person.name), body: copy.doneBody });
      onClose();
      router.refresh();
    } catch (caught) {
      setBusy(false);
      setError(caught.message);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={copy.title(person.name)}
      description={copy.description}
      onSubmit={confirm}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={action === 'deactivate' ? 'danger' : 'primary'}
            loading={busy}
            data-autofocus
          >
            {copy.button}
          </Button>
        </>
      }
    >
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
