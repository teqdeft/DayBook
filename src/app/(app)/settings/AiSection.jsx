'use client';
// Settings → AI (CONTRACT 20): Google Gemini for Polish my tasks, the daily summary for PMs, the
// weekly HR notes and Ask Daybook. "Use AI (Gemini)" can only be turned on when the server has
// GEMINI_API_KEY (the page gets a boolean, never the key). While AI is on: today's requests and
// the company's daily limit, and each feature's switch, with its time for the scheduled ones.
// Saved with "Save changes".
import StatusCell from '@/components/StatusCell';
import Toggle from '@/components/Toggle';
import ClockField from './ClockField';
import NumberField from './NumberField';
import Section from './Section';
import { useSettingsForm } from './SettingsProvider';
import styles from './SettingsForm.module.css';

const NO_KEY = "Add GEMINI_API_KEY to the server's .env.local first.";

/** "AI requests today: 38 of 200" (company-time day), with the numbers in the number font. */
function UsageText({ usage }) {
  if (!usage) return 'Ready to use.';
  return (
    <>
      AI requests today: <span className="num">{usage.used}</span> of{' '}
      <span className="num">{usage.limit}</span>
    </>
  );
}

/** One feature's on/off row. */
function FeatureToggle({ name, label, help, className = styles.toggle }) {
  const { form, setField } = useSettingsForm();
  return (
    <Toggle
      label={label}
      help={help}
      checked={Boolean(form[name])}
      onChange={(checked) => setField(name, checked)}
      className={className}
    />
  );
}

/** A scheduled feature: its switch, and while it is on the time it runs (and `children`). */
function TimedFeature({ name, clock, label, help, clockHelp, children }) {
  const { form, errors, setField } = useSettingsForm();
  const on = Boolean(form[name]);
  return (
    <div className={styles.toggleGroup}>
      <Toggle
        label={label}
        help={help}
        checked={on}
        onChange={(checked) => setField(name, checked)}
      />
      {/* An error from the server stays in view even after the switch is turned off. */}
      {on || errors[clock] ? (
        <>
          <ClockField
            name={clock}
            label="Send at"
            help={clockHelp}
            className={styles.toggleField}
          />
          {children}
        </>
      ) : null}
    </div>
  );
}

/**
 * @param {{ configured: boolean, usage: { used: number, limit: number } | null }} props
 *   configured: the server has GEMINI_API_KEY; usage: ai.usageToday() (null when unknown)
 */
export default function AiSection({ configured, usage }) {
  const { form, errors, setField } = useSettingsForm();
  const on = configured && Boolean(form.aiEnabled);
  return (
    <Section
      id="ai"
      title="AI"
      subtitle="Google Gemini polishes report tasks, writes summaries and answers questions about Daybook's data."
    >
      <div className={styles.connection}>
        {configured ? (
          <StatusCell status="connected" label="Ready" size="pill" />
        ) : (
          <StatusCell status="not_connected" label="Not set up" size="pill" />
        )}
        <span className={styles.connectionNote}>
          {configured ? <UsageText usage={usage} /> : 'Gemini needs an API key on the server.'}
        </span>
      </div>
      <div className={styles.toggles}>
        <Toggle
          label="Use AI (Gemini)"
          help={
            configured
              ? 'Task lines, report numbers and questions go to Google Gemini. Emails, phone numbers and IP addresses never do.'
              : NO_KEY
          }
          checked={Boolean(form.aiEnabled)}
          // Without a key it can still be turned off, never on.
          disabled={!configured && !form.aiEnabled}
          onChange={(checked) => setField('aiEnabled', checked)}
          className={styles.toggle}
        />
        {on || errors.aiDailyLimit ? (
          <div className={styles.limitRow}>
            <NumberField
              name="aiDailyLimit"
              label="Daily limit (requests)"
              help="Gemini requests a day for the whole company. 0 stops them."
              maxLength={4}
              className={styles.limitField}
            />
          </div>
        ) : null}
        {on ? (
          <>
            <FeatureToggle
              name="aiPolishEnabled"
              label="Polish my tasks"
              help="A Polish with AI button and a sparkle on each task line of the daily report, also offered after Fill report from timers. 40 a day per person."
            />
            <TimedFeature
              name="aiPmSummaryEnabled"
              clock="aiPmSummaryAt"
              label="Daily summary for PMs"
              help="On working days, each PM gets a summary of the day's submitted reports on their projects."
              clockHelp="Company time, once reports are in."
            >
              <FeatureToggle
                name="aiSummarySlack"
                label="Also send as a Slack message"
                help="A direct message to the PM with the whole summary."
                className={styles.subToggle}
              />
            </TimedFeature>
            <TimedFeature
              name="aiHrNotesEnabled"
              clock="aiHrNotesAt"
              label="Weekly HR notes"
              help="Neutral notes on the week's attendance for HR, on the last working day of the week."
              clockHelp="Company time."
            />
            <FeatureToggle
              name="aiAskEnabled"
              label="Ask Daybook"
              help="Admins, PMs and HR ask questions about the data they can see. Up to 30 AI requests a day per person; one question can take several."
            />
          </>
        ) : null}
      </div>
    </Section>
  );
}
