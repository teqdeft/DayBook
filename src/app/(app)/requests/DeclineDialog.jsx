'use client';
// "Decline" on a request: asks for a reason (sent to the person) and, for a project request with
// logged hours, the project those hours move to.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Select from '@/components/Select';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './RequestActions.module.css';

/**
 * @param {{ title: string, description: string, endpoint: string, personName: string,
 *   moveTargets?: Array<{ value: number, label: string }>, onClose: () => void }} props
 *   moveTargets: when given, hours were logged to the request and a project must be picked
 */
export default function DeclineDialog({
  title,
  description,
  endpoint,
  personName,
  moveTargets = [],
  onClose,
}) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const needsTarget = moveTargets.length > 0;

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors({});
    setFormError('');
    try {
      await api.post(endpoint, {
        reason,
        ...(needsTarget ? { moveEntriesToProjectId: target ? Number(target) : null } : {}),
      });
      toast({ title: 'Request declined', body: `${personName} gets your reason.` });
      onClose();
      router.refresh();
    } catch (error) {
      const fields = error.fields ?? {};
      setErrors(fields);
      if (fields.moveEntriesToProjectId && !needsTarget) {
        // Hours were logged to the request after this page loaded: reload it so the project
        // picker shows, and say why.
        setFormError(fields.moveEntriesToProjectId);
        router.refresh();
      } else if (!fields.reason && !fields.moveEntriesToProjectId) {
        setFormError(error.message);
        if (error.code === 'REQUEST_ALREADY_HANDLED' || error.status === 404) router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      onSubmit={onSubmit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={saving}>
            Decline
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <Field label="Reason" htmlFor="decline-reason" error={errors.reason}>
          <Textarea
            id="decline-reason"
            rows={3}
            value={reason}
            maxLength={300}
            placeholder={`Tell ${personName} why`}
            error={Boolean(errors.reason)}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {needsTarget ? (
          <Field
            label="Move their logged hours to"
            htmlFor="decline-target"
            help="Hours were already logged to this request. Pick the project they belong to."
            error={errors.moveEntriesToProjectId}
          >
            <Select
              id="decline-target"
              value={target}
              error={Boolean(errors.moveEntriesToProjectId)}
              onChange={(event) => setTarget(event.target.value)}
              options={[{ value: '', label: 'Pick a project' }, ...moveTargets]}
            />
          </Field>
        ) : null}
        {formError && !(needsTarget && formError === errors.moveEntriesToProjectId) ? (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
