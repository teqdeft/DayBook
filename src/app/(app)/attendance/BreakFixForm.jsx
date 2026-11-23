'use client';
// The form under a row of HR's break list (CONTRACT 25, item 2): "Ends at" and "Reason" for
// Change end (End break while it is open), or "Delete this break? Its time counts as worked
// again." with the Reason for Delete. Focus starts in its first field; errors show under their
// field; anything else toasts "Couldn't save the break" with the API's message.
import { useEffect, useId, useRef, useState } from 'react';
import Button from '@/components/Button';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './BreakListDialog.module.css';

/**
 * @param {{ attendanceId: number, item: { id: number, endClock: string | null, open: boolean },
 *   kind: 'change' | 'delete', onCancel: () => void,
 *   onDone: (list: object, kind: 'change' | 'delete') => void }} props onDone gets the new
 *   BreakList
 */
export default function BreakFixForm({ attendanceId, item, kind, onCancel, onDone }) {
  const toast = useToast();
  const id = useId();
  const firstRef = useRef(null);
  const [endClock, setEndClock] = useState(item.open ? '' : (item.endClock ?? ''));
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFields({});
    const path = `/api/attendance/${attendanceId}/breaks/${item.id}`;
    try {
      const { data } = await (kind === 'delete'
        ? api.delete(path, { body: { reason } })
        : api.patch(path, { endClock, reason }));
      onDone(data, kind);
    } catch (error) {
      setSaving(false);
      const errors = error?.fields ?? {};
      if (errors.endClock || errors.reason) {
        setFields(errors);
        if (errors.endClock && kind === 'change') firstRef.current?.focus();
        return;
      }
      toast({ title: "Couldn't save the break", body: error?.message, tone: 'error' });
    }
  }

  const reasonField = (
    <Field
      label="Reason"
      htmlFor={`${id}-reason`}
      help="Saved in the audit log."
      error={fields.reason}
    >
      <Textarea
        id={`${id}-reason`}
        ref={kind === 'delete' ? firstRef : undefined}
        rows={2}
        maxLength={500}
        value={reason}
        error={fields.reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </Field>
  );

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {kind === 'delete' ? (
        <p className={styles.formQuestion}>Delete this break? Its time counts as worked again.</p>
      ) : (
        <Field
          label="Ends at"
          htmlFor={`${id}-end`}
          help={item.open ? 'When did the break end?' : undefined}
          error={fields.endClock}
        >
          <Input
            id={`${id}-end`}
            ref={firstRef}
            type="time"
            value={endClock}
            error={fields.endClock}
            onChange={(event) => setEndClock(event.target.value)}
          />
        </Field>
      )}
      {reasonField}
      <div className={styles.formButtons}>
        <Button
          type="submit"
          variant={kind === 'delete' ? 'danger' : 'primary'}
          size="compact"
          loading={saving}
        >
          {kind === 'delete' ? 'Delete break' : 'Save'}
        </Button>
        <Button variant="text" size="compact" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
