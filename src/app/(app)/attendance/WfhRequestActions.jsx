'use client';
// Decline / Approve on a work-from-home request (CONTRACT 17). Approve applies right away: on
// those days the person can check in as WFH. Decline shows their whole reason and asks for one,
// which the person receives. A request someone else already handled (or that is gone, or whose
// days are over) refreshes the card. The decided tile goes away with the refresh, so the focus
// moves to the card first instead of dropping to the page.
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './WfhRequestsCard.module.css';

/**
 * The card no longer matches the database: someone handled the request, it is gone, or its days
 * ended while the page was open (CONFLICT).
 */
function isStale(error) {
  return ['REQUEST_ALREADY_HANDLED', 'CONFLICT'].includes(error?.code) || error?.status === 404;
}

/**
 * @param {{ id: number, name: string, days: string, reason: string }} props days: "Tue, 14 –
 *   Thu, 16 Oct"; reason: theirs, shown whole in the Decline dialog
 */
export default function WfhRequestActions({ id, name, days, reason: asked }) {
  const router = useRouter();
  const toast = useToast();
  const fieldId = useId();
  const [busy, setBusy] = useState(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);
  const toCard = useRef(false);
  const buttonsRef = useRef(null);

  // After the dialog has closed (and given the focus back to Decline): over to the card, unless
  // the person has moved on meanwhile.
  useEffect(() => {
    if (!toCard.current || declining || busy) return;
    toCard.current = false;
    const focused = document.activeElement;
    if (focused && focused !== document.body && !buttonsRef.current?.contains(focused)) return;
    document.getElementById('wfh')?.focus({ preventScroll: true });
  }, [declining, busy]);

  function refreshCard() {
    toCard.current = true;
    router.refresh();
  }

  async function approve() {
    if (busy) return;
    setBusy('approve');
    try {
      await api.post(`/api/wfh-requests/${id}/approve`, {});
      toast({
        title: 'Working from home approved',
        body: `${name} can check in as WFH on ${days}.`,
      });
      refreshCard();
    } catch (err) {
      toast({ title: "Couldn't approve it", body: err.message, tone: 'error' });
      if (isStale(err)) refreshCard();
    } finally {
      setBusy(null);
    }
  }

  function openDecline() {
    setReason('');
    setError(null);
    setFormError(null);
    setDeclining(true);
  }

  async function decline(event) {
    event.preventDefault();
    if (busy) return;
    if (reason.trim().length < 2) {
      setError('Add a reason for them.');
      document.getElementById(`${fieldId}-reason`)?.focus();
      return;
    }
    setBusy('decline');
    setError(null);
    setFormError(null);
    try {
      await api.post(`/api/wfh-requests/${id}/decline`, { reason });
      setDeclining(false);
      toast({ title: 'Request declined', body: `${name} gets your reason.` });
      refreshCard();
    } catch (err) {
      if (err.fields?.reason) setError(err.fields.reason);
      else if (isStale(err)) {
        setDeclining(false);
        toast({ title: "Couldn't decline it", body: err.message, tone: 'error' });
        refreshCard();
      } else setFormError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.buttons} ref={buttonsRef}>
      <Button variant="secondary" size="medium" onClick={openDecline} disabled={busy !== null}>
        Decline
      </Button>
      <Button size="medium" onClick={approve} loading={busy === 'approve'} disabled={busy !== null}>
        Approve
      </Button>
      <Dialog
        open={declining}
        onClose={() => (busy ? null : setDeclining(false))}
        title="Decline working from home?"
        description={`${name} asked to work from home on ${days}.`}
        onSubmit={decline}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDeclining(false)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={busy === 'decline'}>
              Decline
            </Button>
          </>
        }
      >
        <div className={styles.dialogFields}>
          <div className={styles.asked}>
            <p className={styles.askedLabel}>Their reason</p>
            <p className={styles.askedText}>{asked}</p>
          </div>
          <Field
            label="Reason"
            htmlFor={`${fieldId}-reason`}
            error={error}
            help={error ? null : 'They see this with the decision.'}
          >
            <Textarea
              id={`${fieldId}-reason`}
              rows={3}
              maxLength={300}
              value={reason}
              error={Boolean(error)}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
              placeholder="For example: the team is at the client's office that day"
            />
          </Field>
          {formError ? (
            <p className={styles.formError} role="alert">
              {formError}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
