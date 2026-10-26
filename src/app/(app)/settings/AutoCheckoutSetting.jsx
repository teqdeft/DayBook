'use client';
// Settings -> Check-in: auto check-out when inactive (CONTRACT 19). The switch, and while it is on
// the time the check runs ("Check at", 8:00 PM by default). Saved with "Save changes".
import Toggle from '@/components/Toggle';
import ClockField from './ClockField';
import { useSettingsForm } from './SettingsProvider';
import { clockText, parseClockText } from './timeText';
import styles from './SettingsForm.module.css';

export default function AutoCheckoutSetting() {
  const { form, errors, setField } = useSettingsForm();
  const on = Boolean(form.autoCheckoutEnabled);
  const officeEnd = parseClockText(form.officeEnd);
  return (
    <div className={styles.toggleGroup}>
      <Toggle
        label="Auto check-out when inactive"
        help="People still checked in at the time below with no activity or timer in the hour before are checked out at their last active time. Works only while screen time is on."
        checked={on}
        onChange={(checked) => setField('autoCheckoutEnabled', checked)}
      />
      {/* An error from the server stays in view even after the switch is turned off. */}
      {on || errors.autoCheckoutAt ? (
        <ClockField
          name="autoCheckoutAt"
          label="Check at"
          help={
            officeEnd
              ? `After the office ends (${clockText(officeEnd)}).`
              : 'After the office ends.'
          }
          className={styles.toggleField}
        />
      ) : null}
    </div>
  );
}
