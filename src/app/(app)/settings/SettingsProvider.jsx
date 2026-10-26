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
import { changedKeys, KEYS, toForm, toValues } from './settingsValues';
import styles from './SettingsForm.module.css';

export const FORM_ID = 'settings-form';

/** Puts focus in the first field (in page order) that has an error. */
function focusFirstError(errors) {
  const field = KEYS.filter((name) => errors[name])
    .map((name) => document.getElementById(`settings-${name}`))
    .find(Boolean);
  field?.focus();
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
    const { values, errors: local } = toValues(form, saved);
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
