'use client';
// Drawer, Dialog, Toast and Menu triggers for the dev-only shell gallery.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Drawer from '@/components/Drawer';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Menu from '@/components/Menu';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import styles from './page.module.css';

export default function OverlayDemo({ openDrawer = false }) {
  const toast = useToast();
  const [drawer, setDrawer] = useState(openDrawer);
  const [dialog, setDialog] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  function decline(event) {
    event.preventDefault();
    if (!reason.trim()) {
      setError('Add a short reason so they know what to change.');
      return;
    }
    setDialog(false);
    setReason('');
    setError('');
    toast({ title: 'Request declined', body: 'Ankit gets a Slack message with your reason.' });
  }

  return (
    <div className={styles.overlayRow}>
      <Button icon={<Plus size={18} strokeWidth={1.8} />} onClick={() => setDrawer(true)}>
        New project
      </Button>
      <Button variant="secondary" onClick={() => setDialog(true)}>
        Decline with reason
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({ title: 'Report submitted', body: 'It posts to #daily-reports on Slack.' })
        }
      >
        Success toast
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            title: "Couldn't save",
            body: 'Check your connection and try again.',
            tone: 'error',
          })
        }
      >
        Error toast
      </Button>
      <Menu
        label="Actions for acme-store"
        items={[
          { label: 'Edit', onSelect: () => setDrawer(true) },
          { label: 'Mark urgent', onSelect: () => toast({ title: 'Marked urgent' }) },
          { label: 'Change status', disabled: true },
          {
            label: 'Deactivate',
            tone: 'danger',
            onSelect: () => toast({ title: 'Deactivated', tone: 'error' }),
          },
        ]}
      />

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="New project"
        onSubmit={(event) => {
          event.preventDefault();
          setDrawer(false);
          toast({ title: 'Project created' });
        }}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawer(false)}>
              Cancel
            </Button>
            <Button type="submit">Create project</Button>
          </>
        }
      >
        <div className={styles.form}>
          <Field label="Project name" htmlFor="demo-name">
            <Input id="demo-name" placeholder="For example: acme-blog" />
          </Field>
          <Field label="Client" htmlFor="demo-client">
            <Input id="demo-client" placeholder="Client or company name" />
          </Field>
          <Field label="Project manager" htmlFor="demo-pm">
            <Input id="demo-pm" defaultValue="[PM name]" />
          </Field>
        </div>
      </Drawer>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Decline this request?"
        description="Ankit Rana wants to edit the report for Fri, 25 Sep."
        onSubmit={decline}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button variant="danger" type="submit">
              Decline
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="demo-reason" error={error || undefined}>
          <Textarea
            id="demo-reason"
            error={Boolean(error)}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Tell them what to change"
          />
        </Field>
      </Dialog>
    </div>
  );
}
