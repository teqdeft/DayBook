'use client';
// Project timers and breaks (CONTRACT 15): whether people time their projects, when a timer asks
// about away time, the reminder for people checked in without a running timer (whenever timers
// aren't off, CONTRACT 19) and the daily break allowance. Saved with "Save changes".
import Select from '@/components/Select';
import FormField from './FormField';
import NumberField from './NumberField';
import Section from './Section';
import { TIMER_MODE_OPTIONS } from './numberFields';
import { useSettingsForm } from './SettingsProvider';
import styles from './SettingsForm.module.css';

export default function TimersSection() {
  const { form, errors, setField } = useSettingsForm();
  return (
    <Section
      id="timers"
      title="Timers and breaks"
      subtitle="People time their projects and take breaks from Today. Breaks don't count as worked time."
    >
      <div className={styles.grid2}>
        <FormField label="Project timers" htmlFor="settings-timersMode" error={errors.timersMode}>
          <Select
            id="settings-timersMode"
            name="timersMode"
            value={form.timersMode}
            error={Boolean(errors.timersMode)}
            options={TIMER_MODE_OPTIONS}
            onChange={(event) => setField('timersMode', event.target.value)}
          />
        </FormField>
        <NumberField
          name="timerAwayMinutes"
          label="Ask about away time after (minutes)"
          help="Idle or locked this long while a timer runs: people keep or remove that time."
          maxLength={3}
        />
        <NumberField
          name="timerReminderMinutes"
          label="Remind when no timer runs after (minutes)"
          help="Reminds people who are checked in without a running timer. 0 turns it off."
          maxLength={3}
        />
        <NumberField
          name="breakAllowanceMinutes"
          label="Daily break allowance (minutes)"
          help="Breaks above this are flagged on Attendance. 0 means no allowance."
          maxLength={3}
        />
      </div>
    </Section>
  );
}
