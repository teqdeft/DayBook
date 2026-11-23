'use client';
// Slack settings: the connection (connect / disconnect act right away), the report channel, the
// to-do channel (CONTRACT 24) and the four Slack switches (saved with "Save changes").
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Select from '@/components/Select';
import StatusCell from '@/components/StatusCell';
import Toggle from '@/components/Toggle';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import FormField from './FormField';
import Section from './Section';
import { useSettingsForm } from './SettingsProvider';
import styles from './SettingsForm.module.css';

const SWITCHES = [
  {
    key: 'slackPostReports',
    label: 'Post each report when it is submitted',
    help: 'Uses the same format the team posts today.',
  },
  {
    key: 'slackRemind',
    label: 'Remind people who have not submitted',
    help: 'Sent as a direct message at the report reminder time.',
  },
  {
    key: 'slackUrgentNotify',
    label: 'Message members when a project is marked urgent',
    help: 'Sent to everyone on that project.',
  },
  {
    key: 'slackRequestsNotify',
    label: 'Send requests to the PM on Slack',
    help: 'Report edits and new project requests.',
  },
  // CONTRACT 25: the queueDm setting keys of every remind and of both HR summaries
  {
    key: 'slackAttendanceRemind',
    label: 'Send attendance reminders',
    help: 'Check-in reminders and the ones HR sends from Attendance.',
  },
  {
    key: 'slackHrSummary',
    label: 'Send HR the daily summaries',
    help: 'The morning summary and the evening wrap-up, as a direct message.',
  },
];

/** Channels the bot is in, loaded once when Slack is set up. */
function useChannels(configured) {
  const [state, setState] = useState({ channels: [], loading: configured, error: null });
  useEffect(() => {
    if (!configured) return undefined;
    const controller = new AbortController();
    api
      .get('/api/slack/channels', { signal: controller.signal })
      .then(({ data }) => setState({ channels: data ?? [], loading: false, error: null }))
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setState({ channels: [], loading: false, error: error.message });
      });
    return () => controller.abort();
  }, [configured]);
  return state;
}

const TODO_CHANNEL_HELP =
  "Pick the channel for people's morning to-do. Until one is picked, the Post to Slack button stays hidden. Add the Daybook app to the channel first.";

/** The bot's channels as options, plus the saved one when the bot is no longer in it. */
function channelOptions(channels, savedId, savedName) {
  const options = channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }));
  if (savedId && !options.some((option) => option.value === savedId)) {
    options.unshift({ value: savedId, label: `#${savedName ?? savedId}` });
  }
  return options;
}

/** A channel picker's change: the id and the name without "#", or null for "don't post". */
function pickChannel(event) {
  const id = event.target.value || null;
  const name = id ? event.target.selectedOptions[0].textContent.replace(/^#/, '') : null;
  return { id, name };
}

function ConnectionBox({ connection, onDisconnect, onConnect, busy }) {
  const { saved } = useSettingsForm();
  const workspace = `${connection.teamName ?? saved.companyName} workspace`;
  let pill;
  let text;
  let action = null;
  if (!connection.configured) {
    pill = <StatusCell status="not_connected" label="Not set up" size="pill" />;
    text = 'Add the Slack bot token on the server to connect.';
  } else if (!saved.slackEnabled) {
    pill = <StatusCell status="not_connected" label="Not connected" size="pill" />;
    text = workspace;
    action = (
      <Button variant="secondary" size="small" onClick={onConnect} loading={busy}>
        Connect
      </Button>
    );
  } else {
    pill = connection.connected ? (
      <StatusCell status="connected" size="pill" />
    ) : (
      <StatusCell status="missing" label="Can't reach Slack" size="pill" />
    );
    text = connection.connected ? workspace : 'Check the bot token, then reload this page.';
    action = (
      <Button variant="danger" size="small" onClick={onDisconnect}>
        Disconnect
      </Button>
    );
  }
  return (
    <div className={styles.connection}>
      {pill}
      <span
        className={
          connection.connected && saved.slackEnabled ? styles.workspace : styles.connectionNote
        }
      >
        {text}
      </span>
      {action ? <span className={styles.connectionAction}>{action}</span> : null}
    </div>
  );
}

/** @param {{ connection: { configured: boolean, connected: boolean, teamName: string | null } }} props */
export default function SlackSection({ connection }) {
  const router = useRouter();
  const toast = useToast();
  const { form, errors, setField, applySaved } = useSettingsForm();
  const { channels, loading, error } = useChannels(connection.configured);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function setEnabled(enabled) {
    setBusy(true);
    try {
      const { data } = await api.put('/api/settings', { slackEnabled: enabled });
      applySaved(data);
      setConfirming(false);
      toast({
        title: enabled ? 'Slack connected' : 'Slack disconnected',
        body: enabled
          ? 'Reports, reminders and requests go to Slack again.'
          : 'In-app notifications keep working.',
      });
      router.refresh();
    } catch (caught) {
      toast({ title: "Couldn't change Slack", body: caught.message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const channelHelp = error
    ? `Couldn't load channels from Slack: ${error}`
    : loading
      ? 'Loading channels…'
      : undefined;

  return (
    <Section
      id="slack"
      title="Slack"
      subtitle="Reports, reminders and requests go through your Slack workspace."
    >
      <ConnectionBox
        connection={connection}
        busy={busy}
        onConnect={() => setEnabled(true)}
        onDisconnect={() => setConfirming(true)}
      />
      <FormField
        label="Post reports to"
        htmlFor="settings-channel"
        help={errors.slackReportChannelId ? undefined : channelHelp}
        error={errors.slackReportChannelId ?? errors.slackReportChannelName}
        className={styles.channel}
      >
        <Select
          id="settings-channel"
          value={form.slackReportChannelId ?? ''}
          options={[
            ...channelOptions(channels, form.slackReportChannelId, form.slackReportChannelName),
            { value: '', label: "Don't post reports" },
          ]}
          onChange={(event) => {
            const { id, name } = pickChannel(event);
            setField('slackReportChannelId', id);
            setField('slackReportChannelName', name);
          }}
        />
      </FormField>
      <FormField
        label="Post to-dos to"
        htmlFor="settings-slackTodoChannelId"
        help={errors.slackTodoChannelId ? undefined : TODO_CHANNEL_HELP}
        error={errors.slackTodoChannelId ?? errors.slackTodoChannelName}
        className={styles.channel}
      >
        <Select
          id="settings-slackTodoChannelId"
          value={form.slackTodoChannelId ?? ''}
          options={[
            { value: '', label: "Don't post to-dos" },
            ...channelOptions(channels, form.slackTodoChannelId, form.slackTodoChannelName),
          ]}
          onChange={(event) => {
            const { id, name } = pickChannel(event);
            setField('slackTodoChannelId', id);
            setField('slackTodoChannelName', name);
          }}
        />
      </FormField>
      <div className={styles.toggles}>
        {SWITCHES.map((item) => (
          <Toggle
            key={item.key}
            label={item.label}
            help={item.help}
            checked={form[item.key]}
            onChange={(checked) => setField(item.key, checked)}
            className={styles.toggle}
          />
        ))}
      </div>
      {confirming ? (
        <Dialog
          open
          onClose={() => setConfirming(false)}
          title="Disconnect Slack?"
          description="Daybook stops posting reports and sending reminders and requests on Slack until you connect again. In-app notifications keep working."
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => setEnabled(false)}
                data-autofocus
              >
                Disconnect
              </Button>
            </>
          }
        />
      ) : null}
    </Section>
  );
}
