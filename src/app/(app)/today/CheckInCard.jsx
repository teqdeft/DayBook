'use client';
// Today before check-in (desktop and phone): Office or WFH, the "Wi-Fi is down" option when the
// company allows it, an optional note for the PM and the Check in button (guide 7.2, section 8).
// CONTRACT 17: Office from any network while the company has that on, and WFH only on a day HR
// approved, with Ask HR on the WFH option. The server decides for real; this only offers what the
// server will accept (checkInOptions in wfhOptions.js). Once a request is sent, the refresh turns
// Ask HR into "Waiting for HR", which would drop a keyboard user's focus: it moves to the WFH
// option, which now says so.
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, House } from 'lucide-react';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import Field from '@/components/Field';
import Tag from '@/components/Tag';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { formatTimeAmPm } from '@/lib/time';
import styles from './CheckInCard.module.css';
import WfhRequestDialog from './WfhRequestDialog';
import { checkInOptions } from './wfhOptions';

const NOTE_MAX = 255;

/**
 * One option. `action` (Ask HR) sits on its right, outside the label: the radio keeps its name.
 * `boxRef` gives the option's box focus from code (tabIndex -1: never a Tab stop of its own).
 */
function Choice({ name, value, checked, disabled, onChange, icon, title, hint, action, boxRef }) {
  const classes = [
    styles.choice,
    checked ? styles.checked : '',
    disabled ? styles.disabled : '',
    action ? styles.hasAction : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={styles.choiceBox} ref={boxRef} tabIndex={boxRef ? -1 : undefined}>
      <label className={classes}>
        <input
          type="radio"
          className="visually-hidden"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => onChange(value)}
        />
        <span className={styles.choiceIcon} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.choiceText}>
          <span className={styles.choiceTitle}>{title}</span>
          <span className={styles.choiceHint}>{hint}</span>
        </span>
      </label>
      {action ? <span className={styles.choiceAction}>{action}</span> : null}
    </div>
  );
}

/**
 * @param {{ onOfficeNetwork: boolean, allowUnverifiedOffice: boolean, officeAnywhere: boolean,
 *   wfh: { needsApproval: boolean, approved: boolean, approvedBy: string | null,
 *   pending: boolean }, today: string, lateAfter: string, officeHours: string, tz: string }} props
 *   lateAfter and officeHours are ready to show ("9:30", "9:30 to 6:30"); wfh from wfhToday()
 */
export default function CheckInCard({
  onOfficeNetwork,
  allowUnverifiedOffice,
  officeAnywhere = false,
  wfh = { needsApproval: false, approved: false, approvedBy: null, pending: false },
  today,
  lateAfter,
  officeHours,
  tz,
}) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [picked, setChoice] = useState(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const wfhBoxRef = useRef(null);
  const refocus = useRef(false);
  // The page refreshes every minute, so the network, the settings or HR's answer can change under
  // a choice made earlier: the options are worked out again on every render.
  const options = checkInOptions({
    picked,
    onOfficeNetwork,
    officeAnywhere,
    allowUnverifiedOffice,
    wfh,
  });
  const { choice } = options;
  const unverified = choice === 'unverified';

  useEffect(() => {
    if (refreshing || !refocus.current) return;
    refocus.current = false;
    const focused = document.activeElement;
    // Only when the focus was dropped (Ask HR went away), not when the person has moved on.
    if (!focused || focused === document.body) wfhBoxRef.current?.focus();
  }, [refreshing, options.wfh.ask]);

  function requestSent() {
    refocus.current = true;
    startRefresh(() => router.refresh());
  }

  async function checkIn(event) {
    event.preventDefault();
    if (!choice) return;
    setBusy(true);
    setErrors({});
    try {
      const { data } = await api.post('/api/attendance/check-in', {
        location: choice === 'wfh' ? 'wfh' : 'office',
        unverifiedOffice: unverified,
        note: note.trim() || null,
      });
      const where = data.location === 'wfh' ? 'from home' : 'at the office';
      toast({ title: `Checked in ${where} at ${formatTimeAmPm(data.checkInAt, tz)}` });
      router.refresh();
    } catch (error) {
      setBusy(false);
      // Already in, or HR's approval went away meanwhile (cancelled): show what is true now.
      if (error.code === 'ALREADY_CHECKED_IN' || error.code === 'WFH_NOT_APPROVED') {
        router.refresh();
      }
      setErrors(error.fields?.note ? error.fields : { _: error.message });
    }
  }

  return (
    <Card className={styles.card}>
      <form onSubmit={checkIn} noValidate className={styles.form}>
        <CardHeader
          title="Check in"
          subtitle={`Office hours ${officeHours}. Late after ${lateAfter}.`}
          actions={
            options.network === 'on' ? (
              <Tag tone="green" size="lg" dot>
                On the office network
              </Tag>
            ) : options.network === 'off' ? (
              <Tag tone="neutral" size="lg">
                Not on the office network
              </Tag>
            ) : null
          }
        />
        <fieldset className={styles.choices}>
          <legend className="visually-hidden">Where are you working today?</legend>
          <Choice
            name={`${id}-where`}
            value={options.office.value}
            checked={choice === 'office' || unverified}
            disabled={options.office.disabled}
            onChange={setChoice}
            icon={<Building2 size={22} strokeWidth={1.8} />}
            title={options.office.title}
            hint={options.office.hint}
          />
          <Choice
            name={`${id}-where`}
            value="wfh"
            checked={choice === 'wfh'}
            disabled={options.wfh.disabled}
            onChange={setChoice}
            icon={<House size={22} strokeWidth={1.8} />}
            title="Working from home"
            hint={options.wfh.hint}
            boxRef={wfhBoxRef}
            action={
              options.wfh.ask ? (
                <Button
                  variant="text"
                  size="small"
                  onClick={() => setAsking(true)}
                  aria-label="Ask HR to work from home today"
                >
                  Ask HR
                </Button>
              ) : null
            }
          />
        </fieldset>
        {options.wifi ? (
          <p className={styles.wifi}>
            {options.wifi === 'unverified' ? (
              <>
                HR sees an unverified office check-in and confirms it.{' '}
                {options.wfhOpen ? (
                  <Button variant="text" size="small" onClick={() => setChoice('wfh')}>
                    I&apos;m working from home
                  </Button>
                ) : null}
              </>
            ) : options.wifi === 'offer' ? (
              <Button variant="text" size="small" onClick={() => setChoice('unverified')}>
                I&apos;m in the office, but the Wi-Fi is down
              </Button>
            ) : (
              'Office check-in only works on the office Wi-Fi. Connect to it, then reload.'
            )}
          </p>
        ) : null}
        <div className={styles.bottom}>
          <Field
            className={styles.note}
            label="Note for your PM (optional)"
            htmlFor={`${id}-note`}
            error={errors.note}
            help={errors.note ? null : `${note.length}/${NOTE_MAX}`}
          >
            <Textarea
              id={`${id}-note`}
              rows={2}
              maxLength={NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="For example: plumber visit, online by 11"
            />
          </Field>
          <Button
            type="submit"
            size="large"
            loading={busy}
            disabled={!choice}
            className={styles.submit}
          >
            Check in
          </Button>
        </div>
        {errors._ ? (
          <p className={styles.error} role="alert">
            {errors._}
          </p>
        ) : null}
      </form>
      <WfhRequestDialog
        open={asking}
        onClose={() => setAsking(false)}
        today={today}
        fromDate={today}
        onSent={requestSent}
      />
    </Card>
  );
}
