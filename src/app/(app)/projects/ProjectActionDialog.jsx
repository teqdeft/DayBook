'use client';
// Row menu dialogs on Projects: mark urgent (asks for the note), remove urgent, change status.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Segmented from '@/components/Segmented';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import styles from './ProjectActionDialog.module.css';

const STATUS_ITEMS = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
];

const STATUS_WORDS = { active: 'active', on_hold: 'on hold', completed: 'completed' };

function useAction(onClose) {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  async function run(request, success) {
    if (saving) return;
    setSaving(true);
    setErrors({});
    setFormError('');
    try {
      await request();
      toast(success);
      onClose();
      router.refresh();
    } catch (error) {
      const fields = error.fields ?? {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return { saving, errors, formError, run };
}

function FormError({ message }) {
  return message ? (
    <p className={styles.formError} role="alert">
      {message}
    </p>
  ) : null;
}

function MarkUrgentDialog({ project, onClose }) {
  const [note, setNote] = useState('');
  const { saving, errors, formError, run } = useAction(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Mark ${project.name} as urgent`}
      description="Members get a Slack message and it shows at the top of their day."
      onSubmit={(event) => {
        event.preventDefault();
        run(() => api.post(`/api/projects/${project.id}/urgent`, { note }), {
          title: `${project.name} is urgent`,
          body: 'Members see it at the top of their day.',
        });
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="marigold" loading={saving}>
            Mark as urgent
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <Field
          label="What is urgent?"
          htmlFor="urgent-note"
          error={errors.note}
          help="Up to 200 characters. Members see this note."
        >
          <Textarea
            id="urgent-note"
            rows={2}
            value={note}
            maxLength={200}
            placeholder="For example: Homepage content live today"
            error={Boolean(errors.note)}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <FormError message={formError} />
      </div>
    </Dialog>
  );
}

function ClearUrgentDialog({ project, onClose }) {
  const { saving, formError, run } = useAction(onClose);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Remove urgent from ${project.name}?`}
      description="The note is cleared and members stop seeing it at the top of their day."
      onSubmit={(event) => {
        event.preventDefault();
        run(() => api.delete(`/api/projects/${project.id}/urgent`), {
          title: 'Urgent removed',
          body: `${project.name} is no longer urgent.`,
        });
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} data-autofocus>
            Remove urgent
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {project.urgentNote ? <p className={styles.note}>{project.urgentNote}</p> : null}
        <FormError message={formError} />
      </div>
    </Dialog>
  );
}

function StatusDialog({ project, onClose }) {
  const [status, setStatus] = useState(project.status);
  const { saving, errors, formError, run } = useAction(onClose);
  const losesUrgent = project.isUrgent && status !== 'active';
  return (
    <Dialog
      open
      onClose={onClose}
      title="Change status"
      description={`${project.name} is ${STATUS_WORDS[project.status]} now.`}
      onSubmit={(event) => {
        event.preventDefault();
        if (status === project.status) {
          onClose();
          return;
        }
        run(() => api.patch(`/api/projects/${project.id}`, { status }), {
          title: 'Status changed',
          body: `${project.name} is ${STATUS_WORDS[status]}.`,
        });
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save status
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <Segmented label="Status" items={STATUS_ITEMS} value={status} onChange={setStatus} />
        <p className={styles.help}>
          {status === 'active'
            ? 'Active projects can be picked in daily reports.'
            : status === 'on_hold'
              ? 'On hold projects stay listed but cannot be picked in daily reports.'
              : 'Completed projects move to the Completed tab and cannot be picked in reports.'}
          {losesUrgent ? ' This also removes the urgent flag.' : ''}
        </p>
        {errors.status ? (
          <p className={styles.formError} role="alert">
            {errors.status}
          </p>
        ) : null}
        <FormError message={formError} />
      </div>
    </Dialog>
  );
}

export default function ProjectActionDialog({ kind, project, onClose }) {
  if (kind === 'urgent') return <MarkUrgentDialog project={project} onClose={onClose} />;
  if (kind === 'clearUrgent') return <ClearUrgentDialog project={project} onClose={onClose} />;
  return <StatusDialog project={project} onClose={onClose} />;
}
