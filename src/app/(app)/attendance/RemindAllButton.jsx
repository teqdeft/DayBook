'use client';
// "Remind all (3)" in the Everyone card head (CONTRACT 25, item 5): HR and Admins, on today, with
// the Not checked in or On break filter. One remind for every listed row whose menu offers that
// remind now (the loader leaves out rows within the 30 minutes); hidden when there are none.
import { BellRing } from 'lucide-react';
import Button from '@/components/Button';
import { useRemind } from './useRemind';

/**
 * @param {{ kind: 'check_in' | 'break', users: Array<{ id: number, name: string }> }} props
 */
export default function RemindAllButton({ kind, users }) {
  const { send, busy } = useRemind();
  const count = users?.length ?? 0;
  if (count === 0) return null;
  return (
    <Button
      variant="secondary"
      size="compact"
      icon={<BellRing size={18} strokeWidth={1.8} aria-hidden="true" />}
      loading={busy}
      onClick={() => send(kind, users)}
    >
      Remind all ({count})
    </Button>
  );
}
