'use client';
// Check-in settings: the office networks (added and removed right away through their own API)
// and the two check-in switches (saved with "Save changes").
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Input from '@/components/Input';
import Toggle from '@/components/Toggle';
import { useToast } from '@/components/ToastProvider';
import { api, ApiError } from '@/lib/apiClient';
import FormField from './FormField';
import Section from './Section';
import { useSettingsForm } from './SettingsProvider';
import styles from './SettingsForm.module.css';

function AddNetworkDialog({ currentIp, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [ipAddress, setIpAddress] = useState(currentIp ?? '');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  /** Shows the errors and puts focus in the first field that has one. */
  function showErrors(fields) {
    setErrors(fields);
    document.getElementById(fields.name ? 'network-name' : 'network-ip')?.focus();
  }

  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const local = {};
    if (!name.trim()) local.name = 'Enter a name for this network.';
    if (!ipAddress.trim()) local.ipAddress = 'Enter the IP address.';
    if (Object.keys(local).length > 0) {
      showErrors(local);
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/api/office-networks', { name, ipAddress });
      toast({
        title: `${data.name} added`,
        body: `Check-ins from ${data.ipAddress} count as office.`,
      });
      onClose();
      router.refresh();
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && (error.fields.name || error.fields.ipAddress)) {
        showErrors(error.fields);
        return;
      }
      toast({ title: "Couldn't add the network", body: error.message, tone: 'error' });
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add an office network"
      description="Use the office's public IP address. Check-ins from it count as office."
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Add network
          </Button>
        </>
      }
    >
      <div className={styles.dialogFields}>
        <FormField label="Name" htmlFor="network-name" error={errors.name}>
          <Input
            id="network-name"
            value={name}
            error={Boolean(errors.name)}
            placeholder="For example: Main office"
            maxLength={80}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              setErrors((current) => ({ ...current, name: undefined }));
            }}
          />
        </FormField>
        <FormField
          label="IP address"
          htmlFor="network-ip"
          help={
            errors.ipAddress
              ? undefined
              : currentIp
                ? `Your IP address right now is ${currentIp}. Keep it if you're in the office.`
                : undefined
          }
          error={errors.ipAddress}
        >
          <Input
            id="network-ip"
            value={ipAddress}
            error={Boolean(errors.ipAddress)}
            placeholder="203.0.113.24"
            maxLength={45}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setIpAddress(event.target.value);
              setErrors((current) => ({ ...current, ipAddress: undefined }));
            }}
          />
        </FormField>
      </div>
    </Dialog>
  );
}

function RemoveNetworkDialog({ network, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await api.delete(`/api/office-networks/${network.id}`);
      toast({ title: `${network.name} removed` });
      onClose();
      router.refresh();
    } catch (error) {
      setBusy(false);
      toast({ title: "Couldn't remove the network", body: error.message, tone: 'error' });
      if (error instanceof ApiError && error.status === 404) {
        onClose();
        router.refresh();
      }
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Remove ${network.name}?`}
      description={`Check-ins from ${network.ipAddress} won't count as office any more.`}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy} data-autofocus>
            Remove
          </Button>
        </>
      }
    />
  );
}

/**
 * @param {{ networks: Array<{ id: number, name: string, ipAddress: string }>,
 *   currentIp: string | null }} props
 */
export default function CheckInSection({ networks, currentIp }) {
  const { form, setField } = useSettingsForm();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);

  return (
    <Section
      id="check-in"
      title="Check-in"
      subtitle="Office check-in only works on these networks. Anywhere else, people check in as WFH."
    >
      {networks.length > 0 ? (
        <ul className={styles.networks}>
          {networks.map((network) => (
            <li key={network.id} className={styles.network}>
              <span className={styles.networkText}>
                <span className={styles.networkName}>{network.name}</span>
                <span className={styles.networkIp}>{network.ipAddress}</span>
              </span>
              <Button
                variant="text"
                aria-label={`Remove ${network.name}`}
                onClick={() => setRemoving(network)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.emptyBox}>
          No office networks yet, so everyone checks in as WFH. Add the office&apos;s IP address.
        </p>
      )}
      <Button
        variant="secondary"
        size="compact"
        className={styles.addNetwork}
        icon={<Plus size={18} strokeWidth={1.8} aria-hidden="true" />}
        onClick={() => setAdding(true)}
      >
        Add network
      </Button>
      <div className={styles.toggles}>
        <Toggle
          label="Allow unverified office check-in"
          help="For when the office Wi-Fi is down. HR confirms these later."
          checked={form.allowUnverifiedOffice}
          onChange={(checked) => setField('allowUnverifiedOffice', checked)}
          className={styles.toggle}
        />
        <Toggle
          label="Mark missing check-outs at midnight"
          help="HR can fix them from Attendance."
          checked={form.autoMarkMissingCheckout}
          onChange={(checked) => setField('autoMarkMissingCheckout', checked)}
          className={styles.toggle}
        />
      </div>
      {adding ? <AddNetworkDialog currentIp={currentIp} onClose={() => setAdding(false)} /> : null}
      {removing ? (
        <RemoveNetworkDialog network={removing} onClose={() => setRemoving(null)} />
      ) : null}
    </Section>
  );
}
