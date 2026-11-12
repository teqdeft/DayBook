'use client';
// Moves a project to a phase (CONTRACT 22): a button that opens the one small dialog saying what the
// move does, then asks the server. The Overview's "Move to Design", the Phases tab's "Move to ..." and
// its "Make this the current phase" (variant="text") all use it. Only for people who can manage the
// project: the phase route refuses anyone else. Moving never changes the project's status. It sends
// the phase the page shows too, so a move from a page left open after someone else moved the
// project is refused (409) instead of quietly becoming a different move.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { phaseLabel } from '@/modules/projectPlan/phases';
import { movePhaseCopy } from './planFormat';

/**
 * @param {{ projectId: number, currentPhase: string | null, targetPhase: string,
 *   plan: { phases: Array<{ key, plannedStart, plannedEnd }> }, today: string,
 *   children?: import('react').ReactNode, label?: string,
 *   variant?: 'primary'|'secondary'|'text', size?: string, className?: string }} props
 *   today: the company's date (page data, for "ends today, 7 days late"); the button reads
 *   children, else label, else the dialog's own action ("Move to Design", "Go back")
 */
export default function MovePhaseButton({
  projectId,
  currentPhase,
  targetPhase,
  plan,
  today,
  children,
  label,
  variant = 'primary',
  size,
  className,
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const copy = movePhaseCopy({ phases: plan?.phases, from: currentPhase, to: targetPhase, today });

  async function confirm() {
    if (saving) return;
    setSaving(true);
    try {
      await api.put(`/api/projects/${projectId}/phase`, { phase: targetPhase, from: currentPhase });
      setOpen(false);
      toast({ title: `Phase changed to ${phaseLabel(targetPhase)}.` });
      router.refresh();
    } catch (error) {
      toast({ title: "Couldn't change the phase", body: error.message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {children ?? label ?? copy.okLabel}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={copy.title}
        description={copy.body}
        footer={
          <>
            <Button variant="secondary" data-autofocus="" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={confirm}>
              {copy.okLabel}
            </Button>
          </>
        }
      />
    </>
  );
}
