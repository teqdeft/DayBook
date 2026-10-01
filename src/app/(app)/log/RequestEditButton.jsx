'use client';
// "Request an edit" under My log's edit requests: opens the dialog with a pick of this month's
// locked days that have no pending request.
import { useState } from 'react';
import Button from '@/components/Button';
import RequestEditDialog from '../report/RequestEditDialog';

/** @param {{ dates: string[], className?: string }} props 'YYYY-MM-DD' days, newest first */
export default function RequestEditButton({ dates, className }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        fullWidth
        className={className}
        disabled={dates.length === 0}
        title={dates.length === 0 ? 'No locked reports this month' : undefined}
        onClick={() => setOpen(true)}
      >
        Request an edit
      </Button>
      <RequestEditDialog
        key={dates.join(',')}
        open={open}
        onClose={() => setOpen(false)}
        dates={dates}
      />
    </>
  );
}
