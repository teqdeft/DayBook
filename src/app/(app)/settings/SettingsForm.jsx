'use client';
// The Settings sections (artboard 12) inside one form: Company, Office hours and reports,
// Check-in, Slack, and Screen time and Notifications (added after the canvas). "Save changes" in
// the top bar submits it.
import DayToggleGroup from '@/components/DayToggleGroup';
import Input from '@/components/Input';
import Select from '@/components/Select';
import FormField from './FormField';
import CheckInSection from './CheckInSection';
import NotificationsSection from './NotificationsSection';
import ScreenTimeSection from './ScreenTimeSection';
import Section from './Section';
import SlackSection from './SlackSection';
import { FORM_ID, useSettingsForm } from './SettingsProvider';
import { clockText, parseClockText } from './timeText';
import styles from './SettingsForm.module.css';

/** A time field that shows "9:30 AM" and tidies what was typed ("17:30" -> "5:30 PM") on blur. */
function ClockField({ name, label }) {
  const { form, errors, setField } = useSettingsForm();
  const id = `settings-${name}`;
  return (
    <FormField label={label} htmlFor={id} error={errors[name]}>
      <Input
        id={id}
        name={name}
        value={form[name]}
        error={Boolean(errors[name])}
        inputMode="text"
        autoComplete="off"
        maxLength={12}
        placeholder="9:30 AM"
        onChange={(event) => setField(name, event.target.value)}
        onBlur={() => {
          const clock = parseClockText(form[name]);
          if (clock && clockText(clock) !== form[name]) setField(name, clockText(clock));
        }}
      />
    </FormField>
  );
}

function CompanySection({ timezones }) {
  const { form, errors, setField } = useSettingsForm();
  return (
    <Section id="company" title="Company" subtitle="Basic details used across the app.">
      <div className={`${styles.grid2} ${styles.companyGrid}`}>
        <FormField label="Company name" htmlFor="settings-companyName" error={errors.companyName}>
          <Input
            id="settings-companyName"
            name="companyName"
            value={form.companyName}
            error={Boolean(errors.companyName)}
            maxLength={120}
            autoComplete="organization"
            onChange={(event) => setField('companyName', event.target.value)}
          />
        </FormField>
        <FormField label="Time zone" htmlFor="settings-timezone" error={errors.timezone}>
          <Select
            id="settings-timezone"
            name="timezone"
            value={form.timezone}
            error={Boolean(errors.timezone)}
            options={timezones}
            onChange={(event) => setField('timezone', event.target.value)}
          />
        </FormField>
        <div className={`${styles.full} ${styles.days}`}>
          <p className={styles.label} id="settings-days-label">
            Working days
          </p>
          <DayToggleGroup
            value={form.workingDays}
            onChange={(days) => setField('workingDays', days)}
            aria-labelledby="settings-days-label"
            aria-describedby={errors.workingDays ? 'settings-days-error' : undefined}
          />
          {errors.workingDays ? (
            <p className={styles.error} id="settings-days-error" role="alert">
              {errors.workingDays}
            </p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

function HoursSection({ reportLocks }) {
  const { form, errors, setField } = useSettingsForm();
  return (
    <Section
      id="hours"
      title="Office hours and reports"
      subtitle="Late marks, reminders and report locks follow these times."
    >
      <div className={`${styles.grid3} ${styles.hoursGrid}`}>
        <ClockField name="officeStart" label="Office starts" />
        <ClockField name="officeEnd" label="Office ends" />
        <ClockField name="reportReminderAt" label="Report reminder" />
        <ClockField name="lateAfter" label="Late after" />
        <FormField label="Reports lock" htmlFor="settings-reportLock" error={errors.reportLock}>
          <Select
            id="settings-reportLock"
            name="reportLock"
            value={form.reportLock}
            error={Boolean(errors.reportLock)}
            options={reportLocks}
            onChange={(event) => setField('reportLock', event.target.value)}
          />
        </FormField>
      </div>
    </Section>
  );
}

/**
 * @param {{ timezones: Array<{ value: string, label: string }>,
 *   reportLocks: Array<{ value: string, label: string }>,
 *   networks: Array<{ id: number, name: string, ipAddress: string }>, currentIp: string | null,
 *   connection: { configured: boolean, connected: boolean, teamName: string | null },
 *   pushConfigured: boolean }} props pushConfigured: the server has VAPID keys (CONTRACT 14)
 */
export default function SettingsForm({
  timezones,
  reportLocks,
  networks,
  currentIp,
  connection,
  pushConfigured,
}) {
  const { save } = useSettingsForm();
  return (
    <form
      id={FORM_ID}
      className={styles.sections}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // Dialogs render in a portal; their submits bubble here through React. Only save for
        // this form's own submits.
        if (event.target !== event.currentTarget) return;
        save();
      }}
    >
      <CompanySection timezones={timezones} />
      <HoursSection reportLocks={reportLocks} />
      <CheckInSection networks={networks} currentIp={currentIp} />
      <SlackSection connection={connection} />
      <ScreenTimeSection />
      <NotificationsSection configured={pushConfigured} />
    </form>
  );
}
