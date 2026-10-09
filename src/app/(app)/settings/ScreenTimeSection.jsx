'use client';
// Screen time settings (CONTRACT section 11): when someone counts as idle, how long the data is
// kept, and the switch for the whole feature. Saved with "Save changes".
import Toggle from '@/components/Toggle';
import NumberField from './NumberField';
import Section from './Section';
import { useSettingsForm } from './SettingsProvider';
import styles from './SettingsForm.module.css';

export default function ScreenTimeSection() {
  const { form, setField } = useSettingsForm();
  return (
    <Section
      id="screen-time"
      title="Screen time"
      subtitle="Active, idle and screen-locked time from the Daybook app. Never apps, websites or keystrokes."
    >
      <div className={styles.grid2}>
        <NumberField
          name="activityIdleMinutes"
          label="Idle after (minutes)"
          help="No mouse or keyboard for this long counts as idle."
          maxLength={3}
        />
        <NumberField
          name="activityRetentionDays"
          label="Keep screen time for (days)"
          help="Older days are deleted every night."
          maxLength={4}
        />
      </div>
      <div className={styles.toggles}>
        <Toggle
          label="Record screen time"
          help="For everyone who checks in. Project managers and Admin see everyone's; people see their own."
          checked={form.activityTrackingEnabled}
          onChange={(checked) => setField('activityTrackingEnabled', checked)}
          className={styles.toggle}
        />
      </div>
    </Section>
  );
}
