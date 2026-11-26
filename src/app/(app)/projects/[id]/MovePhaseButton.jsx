'use client';
// Moves a project to a phase (CONTRACT 22): a button that opens the one small dialog saying what the
// move does, then asks the server. The band's "Move to Testing" uses it; a menu item ("Go back to
// Design", a column's "Make this the current phase") opens the same dialog through the controlled
// `open` and `onOpenChange` (CONTRACT 27), and then no button is drawn. Only for people who can
// manage the project: the phase route refuses anyone else. Moving never changes the project's
// status. It sends the phase the page shows too, so a move from a page left open after someone else
// moved the project is refused (409) instead of quietly becoming a different move. On the Board
// (CONTRACT 28, Phase move sequence) `onMoved(to)` takes over after a good save: the window closes
// and the Board plays the move, then toasts and refreshes; the confirm also says how many open
// tasks stay in the phase left (`stayText`).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { phaseLabel } from '@/modules/projectPlan/phases';
import { movePhaseCopy } from './planFormat';
import windowStyles from './projectWindows.module.css';
import styles from './page.module.css';

/**
 * @param {{ projectId: number, currentPhase: string | null, targetPhase: string,
 *   plan: { phases: Array<{ key, plannedStart, plannedEnd }> }, today: string,
 *   children?: import('react').ReactNode, label?: string,
 *   variant?: 'primary'|'secondary'|'text', size?: string, className?: string,
 *   open?: boolean, onOpenChange?: (open: boolean) => void,
 *   onMoved?: (to: string) => void, stayText?: string | null }} props
 *   today: the company's date (page data, for "ends today, 7 days late"); the button reads
 *   children, else label, else the dialog's own action ("Move to Design", "Go back"); open: the
 *   dialog is opened from outside (no button is drawn), onOpenChange hears it close; onMoved:
 *   called after a good save in place of the toast and the refresh; stayText: a muted line under
 *   the dialog's words ("5 open tasks stay in Testing.")
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
  open: openProp,
  onOpenChange,
  onMoved,
  stayText = null,
}) {
  const router = useRouter();
  const toast = useToast();
  const [openSelf, setOpenSelf] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openSelf;
  const setOpen = (next) => {
    if (!controlled) setOpenSelf(next);
    onOpenChange?.(next);
  };
  const [saving, setSaving] = useState(false);
  const copy = movePhaseCopy({ phases: plan?.phases, from: currentPhase, to: targetPhase, today });

  async function confirm() {
    if (saving) return;
    setSaving(true);
    try {
      await api.put(`/api/projects/${projectId}/phase`, { phase: targetPhase, from: currentPhase });
      setOpen(false);
      if (onMoved) return onMoved(targetPhase);
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
      {controlled ? null : (
        <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
          {children ?? label ?? copy.okLabel}
        </Button>
      )}
      <Dialog
        open={open}
        className={windowStyles.window}
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
      >
        {stayText ? <p className={styles.stay}>{stayText}</p> : null}
      </Dialog>
    </>
  );
}
