'use client';
// Decline / Approve edit on a report edit request card.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import DeclineDialog from './DeclineDialog';
import styles from './RequestActions.module.css';

export default function ReportEditActions({ request }) {
  const router = useRouter();
  const toast = useToast();
  const [declining, setDeclining] = useState(false);
  const [approving, setApproving] = useState(false);

  async function approve() {
    if (approving) return;
    setApproving(true);
    try {
      await api.post(`/api/report-edit-requests/${request.id}/approve`);
      toast({
        title: 'Edit approved',
        body: `${request.requesterName} can change the report for ${request.day} for 24 hours.`,
      });
      router.refresh();
    } catch (error) {
      toast({ title: "Couldn't approve the edit", body: error.message, tone: 'error' });
      if (error.code === 'REQUEST_ALREADY_HANDLED' || error.status === 404) router.refresh();
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className={styles.actions}>
      <Button variant="secondary" size="compact" onClick={() => setDeclining(true)}>
        Decline
      </Button>
      <Button size="compact" loading={approving} onClick={approve}>
        Approve edit
      </Button>
      {declining ? (
        <DeclineDialog
          title="Decline this edit request?"
          description={`${request.requesterName} wants to edit the report for ${request.day}.`}
          endpoint={`/api/report-edit-requests/${request.id}/decline`}
          personName={request.requesterName}
          onClose={() => setDeclining(false)}
        />
      ) : null}
    </div>
  );
}
