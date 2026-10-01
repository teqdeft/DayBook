'use client';
// Settings form state shared by the sections and the top bar's "Save changes": the values being
// edited, what is saved, field errors, and one save for every section (PUT /api/settings with
// only the keys that changed).
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { useUnsavedChangesWarning } from '@/components/useUnsavedChangesWarning';
import { api, ApiError } from '@/lib/apiClient';
import { clockText, parseClockText } from './timeText';
import styles from './SettingsForm.module.css';

export const FORM_ID = 'settings-form';

const CLOCKS = {
  officeStart: 'the office start time',
  officeEnd: 'the office end time',
  reportReminderAt: 'the report reminder time',
  lateAfter: 'the late mark time',
};
const KEYS = [
  'companyName',
  'timezone',
  'workingDays',
  'officeStart',
  'officeEnd',
  'reportReminderAt',
  'lateAfter',
  'reportLock',
  'allowUnverifiedOffice',
  'autoMarkMissingCheckout',
  'slackReportChannelId',
  'slackReportChannelName',
  'slackPostReports',
  'slackRemind',
  'slackUrgentNotify',
  'slackRequestsNotify',
  'activityTrackingEnabled',
  'activityIdleMinutes',
  'activityRetentionDays',
  'pushEnabled',
];

// Whole-number fields: shown as text, saved as numbers (same limits as the API).
const NUMBERS = {
  activityIdleMinutes: {
    min: 1,
    max: 120,
    message: 'Idle time must be between 1 and 120 minutes.',
  },
  activityRetentionDays: {
    min: 7,
    max: 3650,
    message: 'Keep screen time for 7 to 3650 days.',
  },
};

/** Saved settings -> what the fields show (clocks as "9:30 AM"). */
function toForm(saved) {
  const form = {};
  for (const key of KEYS) form[key] = key in CLOCKS ? clockText(saved[key]) : saved[key];
  for (const key of Object.keys(NUMBERS)) form[key] = String(saved[key] ?? '');
  form.workingDays = [...(saved.workingDays ?? [])];
  return form;
}

/** Field text -> setting values, or the errors to show under the fields. */
function toValues(form) {
  const values = { ...form, companyName: String(form.companyName ?? '').trim() };
  const errors = {};
  for (const [key, label] of Object.entries(CLOCKS)) {
    const clock = parseClockText(form[key]);
    if (!clock) errors[key] = `Enter ${label} like 9:30 AM.`;
    else values[key] = clock;
  }
  for (const [key, { min, max, message }] of Object.entries(NUMBERS)) {
    const text = String(form[key] ?? '').trim();
    const number = Number(text);
    if (!/^\d+$/.test(text) || number < min || number > max) errors[key] = message;
    else values[key] = number;
  }
  if (!values.companyName) errors.companyName = 'Enter the company name.';
  if (values.workingDays.length === 0) errors.workingDays = 'Pick at least one working day.';
  if (!errors.officeStart && !errors.officeEnd && values.officeEnd <= values.officeStart) {
    errors.officeEnd = 'The office must close after it opens.';
  }
  return { values, errors };
}

/** Puts focus in the first field (in page order) that has an error. */
function focusFirstError(errors) {
  const field = KEYS.filter((name) => errors[name])
    .map((name) => document.getElementById(`settings-${name}`))
    .find(Boolean);
  field?.focus();
}

function changedKeys(values, saved) {
  const body = {};
  for (const key of KEYS) {
    const value = key === 'workingDays' ? [...values[key]].sort((a, b) => a - b) : values[key];
    if (JSON.stringify(value ?? null) !== JSON.stringify(saved[key] ?? null)) body[key] = value;
  }
  // The channel name travels with its id.
  if ('slackReportChannelId' in body) body.slackReportChannelName = values.slackReportChannelName;
  return body;
}

const SettingsContext = createContext(null);

/** @returns {{ form: object, saved: object, errors: object, saving: boolean, dirty: boolean,
 *   setField: (key: string, value: unknown) => void, save: () => Promise<void>,
 *   applySaved: (settings: object) => void }} */
export function useSettingsForm() {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettingsForm() must be used inside <SettingsProvider>');
  return value;
}

/** @param {{ initial: object, children: import('react').ReactNode }} props initial: settings.getAll() */
export default function SettingsProvider({ initial, children }) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(() => toForm(initial));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const baseline = useMemo(() => toForm(saved), [saved]);
  const dirty = KEYS.some((key) => JSON.stringify(form[key]) !== JSON.stringify(baseline[key]));

  // Asks before leaving with unsaved changes: reloads, closing the tab and in-app links.
  useUnsavedChangesWarning(dirty);

  const setField = useCallback((key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }, []);

  /** Settings saved elsewhere on the page (Slack connect/disconnect). Unsaved edits stay. */
  const applySaved = useCallback((next) => setSaved(next), []);

  const save = useCallback(async () => {
    if (saving) return;
    const { values, errors: local } = toValues(form);
    if (Object.keys(local).length > 0) {
      setErrors(local);
      focusFirstError(local);
      toast({
        title: 'Check the highlighted fields',
        body: Object.values(local)[0],
        tone: 'error',
      });
      return;
    }
    const body = changedKeys(values, saved);
    if (Object.keys(body).length === 0) {
      setForm(toForm(saved));
      toast({ title: 'No changes to save', body: 'Everything here is already saved.' });
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put('/api/settings', body);
      setSaved(data);
      setForm(toForm(data));
      setErrors({});
      toast({ title: 'Settings saved', body: 'Daybook uses the new rules from now on.' });
      router.refresh();
    } catch (error) {
      const fields = error instanceof ApiError ? error.fields : {};
      if (Object.keys(fields).length > 0) {
        const shown = Object.fromEntries(
          Object.entries(fields).map(([key, message]) => [key.split('.')[0], message]),
        );
        setErrors(shown);
        focusFirstError(shown);
      }
      toast({ title: "Couldn't save settings", body: error.message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }, [form, saved, saving, router, toast]);

  const value = useMemo(
    () => ({ form, saved, errors, saving, dirty, setField, save, applySaved }),
    [form, saved, errors, saving, dirty, setField, save, applySaved],
  );
  return (
    <SettingsContext.Provider value={value}>
      {children}
      {dirty ? <MobileSaveBar saving={saving} /> : null}
    </SettingsContext.Provider>
  );
}

/** Below 1024 px the top bar scrolls away, so unsaved changes get a save bar at the bottom. */
function MobileSaveBar({ saving }) {
  return (
    <>
      <div className={styles.mobileSaveSpace} aria-hidden="true" />
      <div className={styles.mobileSave}>
        <span className={styles.unsaved}>Unsaved changes</span>
        <Button type="submit" form={FORM_ID} size="compact" loading={saving}>
          Save changes
        </Button>
      </div>
    </>
  );
}

/** The top bar's "Save changes", with a note while there are unsaved changes. */
export function SaveSettingsButton() {
  const { saving, dirty } = useSettingsForm();
  return (
    <>
      <span className={styles.unsaved} role="status">
        {dirty ? 'Unsaved changes' : ''}
      </span>
      <Button type="submit" form={FORM_ID} loading={saving}>
        Save changes
      </Button>
    </>
  );
}
