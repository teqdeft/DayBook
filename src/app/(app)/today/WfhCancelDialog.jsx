'use client';
// Cancels one of the person's work-from-home requests from Today (CONTRACT 17): a request waiting
// for HR, an approved one before it starts, or the rest of an approved one that has started (the
// server keeps today when they already checked in from home). Asks first: an approval that is
// cancelled has to be asked for again.
import { useState } from 'react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { cancelledToast, cancelWording } from './wfhOptions';
import styles from './WfhRequestDialog.module.css';

/** Errors that mean the line is out of date (handled, cancelled or over meanwhile). */
function isStale(error) {
  return ['REQUEST_ALREADY_HANDLED', 'CONFLICT'].includes(error?.code) || error?.status === 404;
}

/**
 * @param {{ line: { id: number, status: string, days: string, started: boolean } | null,
 *   onClose: () => void, onDone: () => void }} props line: the request to cancel (null: closed);
 *   onDone: after a cancel, or an error that means the page is out of date (refresh it)
 */
export default function WfhCancelDialog({ line, onClose, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Each opening starts without the last one's error.
  const [shown, setShown] = useState(line);
  if (line !== shown) {
    setShown(line);
    if (line) setError(null);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !line) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post(`/api/wfh-requests/${line.id}/cancel`, {});
      setBusy(false);
      toast(cancelledToast(line, data));
      onClose();
      onDone();
    } catch (err) {
      setBusy(false);
      setError(err.message);
      if (isStale(err)) onDone();
    }
  }

  const words = line ? cancelWording(line) : null;
  return (
    <Dialog
      open={Boolean(line)}
      onClose={() => (busy ? null : onClose())}
      title={words?.title}
      description={words?.description}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus>
            Keep it
          </Button>
          <Button type="submit" variant="danger" loading={busy}>
            {words?.confirm}
          </Button>
        </>
      }
    >
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
