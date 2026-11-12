'use client';
// "Change deadline" or "Add deadline" and its one-field dialog. Saving an empty date removes the
// deadline. Errors show under the field; success toasts and refreshes the page.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Input from '@/components/Input';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './Overview.module.css';

/** @param {{ projectId: number, deadline: string | null }} props */
export default function DeadlineButton({ projectId, deadline }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(deadline ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const title = deadline ? 'Change deadline' : 'Add deadline';

  function start() {
    setValue(deadline ?? '');
    setError('');
    setOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    if (!value && !deadline) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.put(`/api/projects/${projectId}/deadline`, { deadline: value || null });
      setOpen(false);
      toast({ title: value ? 'Deadline saved.' : 'Deadline removed.' });
      router.refresh();
    } catch (failure) {
      setError(failure.fields?.deadline ?? failure.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="text" size="compact" className={styles.deadlineAction} onClick={start}>
        {title}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        onSubmit={save}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Deadline" htmlFor="project-deadline" error={error}>
          <Input
            id="project-deadline"
            type="date"
            value={value}
            error={Boolean(error)}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
      </Dialog>
    </>
  );
}
