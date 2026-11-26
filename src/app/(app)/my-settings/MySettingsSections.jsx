'use client';
// The My settings cards (CONTRACT 21, 26), in page order: Daily report, AI, Notifications and
// Appearance; the page passes the ones that apply. Rows are a label, a muted help line and the
// control: a switch on the right, or a Segmented choice below. Every change saves at once.
import { useId } from 'react';
import Card, { CardHeader } from '@/components/Card';
import PushSwitch, { useDesktopPush } from '@/components/PushSwitch';
import Segmented from '@/components/Segmented';
import Toggle from '@/components/Toggle';
import PlaySoundButton, { usePlaySound } from './PlaySoundButton';
import { usePreferences } from './PreferencesProvider';
import {
  NEW_TASK_CHOICES,
  SOUND_CHOICES,
  SUBMIT_BUTTON_CHOICES,
  THEME_CHOICES,
  TONE_CHOICES,
} from './sections';
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

/**
 * A preference with a few values: label and help, then the Segmented choice under them. With
 * `children` (Play sound) the choice and the children share a line and wrap when the card is too
 * narrow. `onPick` runs on every press, synchronously and before a new value is saved (picking a
 * sound plays it inside the click). `id` names the label (`${id}-label`) and the help
 * (`${id}-help`) for a control in `children`.
 * @param {{ name: string, label: string, help?: string,
 *   choices: ReadonlyArray<{ value: string, label: string }>, id?: string,
 *   onPick?: (value: string) => void, children?: import('react').ReactNode }} props
 */
function ChoiceRow({ name, label, help, choices, id: givenId, onPick, children }) {
  const { values, change } = usePreferences();
  const autoId = useId();
  const id = givenId ?? autoId;
  const choice = (
    <Segmented
      items={choices}
      value={values[name]}
      onChange={(next) => {
        onPick?.(next);
        if (next !== values[name]) change(name, next);
      }}
      aria-labelledby={`${id}-label`}
      aria-describedby={help ? `${id}-help` : undefined}
      className={styles.choice}
    />
  );
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
      {children ? (
        <div className={styles.soundControls}>
          {choice}
          {children}
        </div>
      ) : (
        choice
      )}
    </div>
  );
}

/**
 * "Choose a sound" (CONTRACT 26): picking one plays it at once (before its save starts, so the
 * click unlocks the audio), and Play sound beside the choice plays the chosen one again.
 */
function ToneRow() {
  const { values } = usePreferences();
  const play = usePlaySound();
  const id = useId();
  return (
    <ChoiceRow
      id={id}
      name="bellTone"
      label="Choose a sound"
      help="Pick one to hear it."
      choices={TONE_CHOICES}
      onPick={play}
    >
      <PlaySoundButton tone={values.bellTone} describedBy={`${id}-help`} />
    </ChoiceRow>
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
        label="Suggest my unfinished tasks"
        help="When you pick a project, its unfinished tasks from past reports show up."
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
 * The bell (CONTRACT 21), its sound and preview cards (CONTRACT 26), then desktop notifications.
 * @param {{ push: { publicKey: string, userId: number } | null }} props push: while desktop
 *   notifications are on for the company (the same config the bell gets)
 */
function NotificationsSection({ push }) {
  // The bell's "Show on this computer" (CONTRACT 14); it renders nothing in a browser without
  // push support, and the note about its sound goes with it.
  const desktop = useDesktopPush(push);
  return (
    <Section id="notifications" title="Notifications">
      <ToggleRow
        name="bellRing"
        label="Ring the bell for unread notifications"
        help="A small swing every few seconds while you have unread ones."
      />
      <ChoiceRow
        name="bellSound"
        label="Sound"
        help="A short sound for every new notification while Daybook is open. Important only plays it just for reminders and requests that ask you to act."
        choices={SOUND_CHOICES}
      />
      <ToneRow />
      <ToggleRow
        name="bellPreview"
        label="Show a preview"
        help="A small card at the top of the screen for each new notification. It hides after a few seconds."
      />
      {push && desktop.state !== 'unsupported' ? (
        <>
          <div className={styles.pushRow}>
            <PushSwitch push={desktop} />
          </div>
          <p className={styles.note}>
            When this is on and Daybook is in the background, Daybook doesn&apos;t chime. Your
            computer&apos;s settings decide if the desktop notification makes a sound, whatever you
            chose for Sound.
          </p>
        </>
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
