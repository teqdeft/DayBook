'use client';
// Reject / Approve on a correction request card. Approve applies it right away (the person's
// reason is saved with it); Reject asks for a note, which the person receives.
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './page.module.css';

/** @param {{ id: number, name: string, title: string }} props */
export default function CorrectionActions({ id, name, title }) {
  const router = useRouter();
  const toast = useToast();
  const fieldId = useId();
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  async function approve() {
    setBusy('approve');
    try {
      await api.post(`/api/attendance-corrections/${id}/approve`, {});
      toast({ title: 'Correction approved', body: `${name}: ${title}` });
      router.refresh();
    } catch (err) {
      toast({ title: "Couldn't approve it", body: err.message, tone: 'error' });
      if (err.code === 'REQUEST_ALREADY_HANDLED') router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function reject(event) {
    event.preventDefault();
    setBusy('reject');
    setError(null);
    try {
      await api.post(`/api/attendance-corrections/${id}/reject`, { note });
      setRejecting(false);
      toast({ title: 'Correction rejected', body: `${name} gets your note.` });
      router.refresh();
    } catch (err) {
      setError(err.fields?.note ?? err.message);
      if (err.code === 'REQUEST_ALREADY_HANDLED') router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.correctionButtons}>
      <Button
        variant="secondary"
        size="medium"
        onClick={() => {
          setNote('');
          setError(null);
          setRejecting(true);
        }}
        disabled={busy !== null}
      >
        Reject
      </Button>
      <Button size="medium" onClick={approve} loading={busy === 'approve'} disabled={busy !== null}>
        Approve
      </Button>
      <Dialog
        open={rejecting}
        onClose={() => (busy ? null : setRejecting(false))}
        title="Reject correction"
        description={`${name}: ${title}`}
        onSubmit={reject}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRejecting(false)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy === 'reject'}>
              Reject
            </Button>
          </>
        }
      >
        <Field
          label="Note for them"
          htmlFor={`${fieldId}-note`}
          error={error}
          help={error ? null : 'They see this with the decision.'}
        >
          <Textarea
            id={`${fieldId}-note`}
            rows={3}
            maxLength={300}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="For example: the door log shows 6:10 PM"
            required
          />
        </Field>
      </Dialog>
    </div>
  );
}
