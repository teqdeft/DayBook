'use client';
// Settings -> HR updates (CONTRACT 25, items 1, 5 and 10; laid out as the HR tools prototype):
// the morning summary with its time, the evening wrap-up half an hour after office hours end,
// then the automatic check-in reminder and the late alert to HR (also the "Needs a look"
// threshold). Saved with "Save changes".
import Toggle from '@/components/Toggle';
import ClockField from './ClockField';
import NumberField from './NumberField';
import Section from './Section';
import { useSettingsForm } from './SettingsProvider';
import { wrapUpAt } from './settingsValues';
import { clockText, parseClockText } from './timeText';
import styles from './SettingsForm.module.css';
import own from './HrUpdatesSection.module.css';

/** "At 7:00 PM, half an hour after office hours end: ..." from the office end being edited. */
function eveningHelp(form, saved) {
  const officeEnd = parseClockText(form.officeEnd) || saved.officeEnd;
  const at = clockText(wrapUpAt(officeEnd));
  return `At ${at}, half an hour after office hours end: who's still in, reports not in and long breaks.`;
}

export default function HrUpdatesSection() {
  const { form, saved, errors, setField } = useSettingsForm();
  const morningOn = Boolean(form.hrMorningSummary);
  return (
    <Section
      id="hr-updates"
      title="HR updates"
      subtitle="Reminders people get, and what HR hears from Daybook each day."
    >
      <div className={`${styles.toggles} ${own.first}`}>
        <div className={styles.toggleGroup}>
          <Toggle
            label="Morning summary for HR"
            help="Who isn't in, who's late or away, and what's waiting. On working days, not on holidays."
            checked={morningOn}
            onChange={(checked) => setField('hrMorningSummary', checked)}
          />
          {/* An error from the server stays in view even after the switch is turned off. */}
          {morningOn || errors.hrSummaryAt ? (
            <ClockField name="hrSummaryAt" label="Send at" className={styles.toggleField} />
          ) : null}
        </div>
        <div className={styles.toggleGroup}>
          <Toggle
            label="Evening wrap-up for HR"
            help={eveningHelp(form, saved)}
            checked={Boolean(form.hrEveningSummary)}
            onChange={(checked) => setField('hrEveningSummary', checked)}
          />
        </div>
      </div>
      <div className={`${styles.grid2} ${own.afterToggles}`}>
        <NumberField
          name="checkinReminderMinutes"
          label="Remind people who haven't checked in after (minutes)"
          help="Counted from each person's late mark. 0 turns it off."
          maxLength={3}
        />
        <NumberField
          name="lateAlertDays"
          label="Tell HR after this many late days"
          help="Once per person each payroll month. People with this many late days, short days or missing reports also show under Needs a look."
          maxLength={2}
        />
      </div>
    </Section>
  );
}
