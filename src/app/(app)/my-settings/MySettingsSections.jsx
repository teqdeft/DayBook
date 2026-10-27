'use client';
// The My settings cards (CONTRACT 21), in page order: Daily report, AI, Notifications and
// Appearance; the page passes the ones that apply. Rows are a label, a muted help line and the
// control: a switch on the right, or a Segmented choice below. Every change saves at once.
import { useId } from 'react';
import Card, { CardHeader } from '@/components/Card';
import PushSwitch, { useDesktopPush } from '@/components/PushSwitch';
import Segmented from '@/components/Segmented';
import Toggle from '@/components/Toggle';
import { usePreferences } from './PreferencesProvider';
import { NEW_TASK_CHOICES, SUBMIT_BUTTON_CHOICES, THEME_CHOICES } from './sections';
import styles from './page.module.css';

/** One card; a scroll target for the section list. */
function Section({ id, title, children }) {
  return (
    <Card
      as="section"
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className={styles.section}
    >
      <CardHeader title={<span id={`${id}-title`}>{title}</span>} />
      <div className={styles.sectionBody}>{children}</div>
    </Card>
  );
}

/** An on/off preference: label and help on the left, the switch on the right. */
function ToggleRow({ name, label, help }) {
  const { values, change } = usePreferences();
  return (
    <Toggle
      label={label}
      help={help}
      checked={Boolean(values[name])}
      onChange={(checked) => change(name, checked)}
      className={styles.row}
    />
  );
}

/** A preference with a few values: label and help, then the Segmented choice under them. */
function ChoiceRow({ name, label, help, choices }) {
  const { values, change } = usePreferences();
  const id = useId();
  return (
    <div className={`${styles.row} ${styles.choiceRow}`}>
      <p className={styles.label} id={`${id}-label`}>
        {label}
      </p>
      {help ? (
        <p className={styles.help} id={`${id}-help`}>
          {help}
        </p>
      ) : null}
      <Segmented
        items={choices}
        value={values[name]}
        onChange={(next) => {
          if (next !== values[name]) change(name, next);
        }}
        aria-labelledby={`${id}-label`}
        aria-describedby={help ? `${id}-help` : undefined}
        className={styles.choice}
      />
    </div>
  );
}

function ReportSection() {
  return (
    <Section id="report" title="Daily report">
      <ChoiceRow
        name="submitButtons"
        label="Submit buttons"
        help="Submit and check out shows while you're checked in today. Update report always shows once the report is submitted."
        choices={SUBMIT_BUTTON_CHOICES}
      />
      <ChoiceRow
        name="newTaskStatus"
        label="New tasks start as"
        help="For tasks you add yourself. Tasks from your timers start as In progress."
        choices={NEW_TASK_CHOICES}
      />
      <ToggleRow
        name="carryOver"
        label="Bring unfinished tasks into my next report"
        help="Tasks still in progress or blocked in your last report start your next one."
      />
      <ToggleRow
        name="slackPreview"
        label="Show the Slack preview"
        help="Beside your report, what will post to Slack."
      />
    </Section>
  );
}

function AiSection() {
  return (
    <Section id="ai" title="AI">
      <ToggleRow
        name="polishButton"
        label="Polish with AI button"
        help="At the top of your report, for every task at once."
      />
      <ToggleRow
        name="polishLines"
        label="Polish on each task line"
        help="A sparkle at the end of each task line, for one task at a time."
      />
      <ToggleRow name="polishAfterTimers" label="Suggest wording after Fill report from timers" />
      <p className={styles.note}>When you use these, your task lines are sent to Google Gemini.</p>
    </Section>
  );
}

/**
 * @param {{ push: { publicKey: string, userId: number } | null }} props push: while desktop
 *   notifications are on for the company (the same config the bell gets)
 */
function NotificationsSection({ push }) {
  // The bell's "Show on this computer" (CONTRACT 14); it renders nothing in a browser without
  // push support.
  const desktop = useDesktopPush(push);
  return (
    <Section id="notifications" title="Notifications">
      <ToggleRow
        name="bellRing"
        label="Ring the bell for unread notifications"
        help="A small swing every few seconds while you have unread ones."
      />
      {push && desktop.state !== 'unsupported' ? (
        <div className={styles.pushRow}>
          <PushSwitch push={desktop} />
        </div>
      ) : null}
    </Section>
  );
}

function AppearanceSection() {
  return (
    <Section id="appearance" title="Appearance">
      <ChoiceRow name="theme" label="Theme" choices={THEME_CHOICES} />
    </Section>
  );
}

/**
 * @param {{ sections: string[], push: { publicKey: string, userId: number } | null }} props
 *   sections: the ids from sectionsFor(), in page order
 */
export default function MySettingsSections({ sections, push }) {
  const shown = new Set(sections);
  return (
    <div className={styles.sections}>
      {shown.has('report') ? <ReportSection /> : null}
      {shown.has('ai') ? <AiSection /> : null}
      {shown.has('notifications') ? <NotificationsSection push={push} /> : null}
      {shown.has('appearance') ? <AppearanceSection /> : null}
    </div>
  );
}
