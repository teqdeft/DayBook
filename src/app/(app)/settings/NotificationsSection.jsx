'use client';
// Desktop notifications (CONTRACT 14): whether every bell notification may also pop up on
// people's computers. Each person still turns it on per browser from the bell. Saved with
// "Save changes".
import StatusCell from '@/components/StatusCell';
import Toggle from '@/components/Toggle';
import Section from './Section';
import { useSettingsForm } from './SettingsProvider';
import styles from './SettingsForm.module.css';

/** @param {{ configured: boolean }} props configured: the server has its VAPID keys */
export default function NotificationsSection({ configured }) {
  const { form, setField } = useSettingsForm();
  return (
    <Section
      id="notifications"
      title="Notifications"
      subtitle="Bell notifications can also pop up on the desktop, even when Daybook is minimised."
    >
      <div className={styles.connection}>
        {configured ? (
          <StatusCell status="connected" label="Ready" size="pill" />
        ) : (
          <StatusCell status="not_connected" label="Not set up" size="pill" />
        )}
        <span className={styles.connectionNote}>
          {configured
            ? 'Each person turns it on from the bell, once in each browser they use.'
            : 'Add the VAPID keys on the server to send desktop notifications.'}
        </span>
      </div>
      <div className={styles.toggles}>
        <Toggle
          label="Show Daybook notifications on people's computers"
          help="In Chrome and Edge they appear in the Windows notification centre."
          checked={form.pushEnabled}
          onChange={(checked) => setField('pushEnabled', checked)}
          className={styles.toggle}
        />
      </div>
    </Section>
  );
}
