'use client';
// "Remind selected" in the Missing check-outs bulk bar (CONTRACT 25, items 5 and 7): one
// missing_checkout remind per distinct person, with no dialog. The toast says how many were sent
// ("Reminded 3 people") and why the first one wasn't.
import { BellRing } from 'lucide-react';
import Button from '@/components/Button';
import { useRemind } from './useRemind';

/**
 * @param {{ users: Array<{ id: number, name: string }>, onDone?: (result: { sent: object[],
 *   skipped: object[] }) => void, className?: string }} props users = one per distinct person
 */
export default function RemindSelectedButton({ users, onDone, className }) {
  const { send, busy } = useRemind();
  async function remind() {
    const result = await send('missing_checkout', users);
    onDone?.(result);
  }
  return (
    <Button
      variant="secondary"
      size="compact"
      icon={<BellRing size={18} strokeWidth={1.8} aria-hidden="true" />}
      loading={busy}
      disabled={!users?.length}
      onClick={remind}
      className={className}
    >
      Remind selected
    </Button>
  );
}
