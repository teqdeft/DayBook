'use client';
// Today before check-in (desktop and phone): Office or WFH, the "Wi-Fi is down" option when the
// company allows it, an optional note for the PM and the Check in button (guide 7.2, section 8).
// The server decides for real; this only offers what the server will accept.
import { useId, useState } from 'react';
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

const NOTE_MAX = 255;

function Choice({ name, value, checked, disabled, onChange, icon, title, hint }) {
  const classes = [styles.choice, checked ? styles.checked : '', disabled ? styles.disabled : '']
    .filter(Boolean)
    .join(' ');
  return (
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
  );
}

/**
 * @param {{ onOfficeNetwork: boolean, allowUnverifiedOffice: boolean, lateAfter: string,
 *   officeHours: string, tz: string }} props
 *   lateAfter and officeHours are ready to show ("9:30", "9:30 to 6:30")
 */
export default function CheckInCard({
  onOfficeNetwork,
  allowUnverifiedOffice,
  lateAfter,
  officeHours,
  tz,
}) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [picked, setChoice] = useState(onOfficeNetwork ? 'office' : 'wfh');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  // The page refreshes every minute, so the network (or the setting) can change under a choice
  // made earlier: on the office network the only option is Office; off it, plain Office is not
  // allowed, and "Office, unverified" only while the company allows it.
  let choice = picked;
  if (onOfficeNetwork) choice = 'office';
  else if (picked === 'office' || (picked === 'unverified' && !allowUnverifiedOffice)) {
    choice = 'wfh';
  }
  const unverified = choice === 'unverified';

  async function checkIn(event) {
    event.preventDefault();
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
      if (error.code === 'ALREADY_CHECKED_IN') router.refresh();
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
            onOfficeNetwork ? (
              <Tag tone="green" size="lg" dot>
                On the office network
              </Tag>
            ) : (
              <Tag tone="neutral" size="lg">
                Not on the office network
              </Tag>
            )
          }
        />
        <fieldset className={styles.choices}>
          <legend className="visually-hidden">Where are you working today?</legend>
          <Choice
            name={`${id}-where`}
            value={unverified ? 'unverified' : 'office'}
            checked={choice === 'office' || unverified}
            disabled={!onOfficeNetwork && !unverified}
            onChange={setChoice}
            icon={<Building2 size={22} strokeWidth={1.8} />}
            title={unverified ? 'Office, unverified' : 'Office'}
            hint={
              onOfficeNetwork
                ? "You're on the office Wi-Fi"
                : unverified
                  ? 'HR confirms it later'
                  : 'Only on the office Wi-Fi'
            }
          />
          <Choice
            name={`${id}-where`}
            value="wfh"
            checked={choice === 'wfh'}
            disabled={onOfficeNetwork}
            onChange={setChoice}
            icon={<House size={22} strokeWidth={1.8} />}
            title="Working from home"
            hint={
              onOfficeNetwork ? 'Not while on the office Wi-Fi' : 'Or anywhere outside the office'
            }
          />
        </fieldset>
        {!onOfficeNetwork ? (
          <p className={styles.wifi}>
            {unverified ? (
              <>
                HR sees an unverified office check-in and confirms it.{' '}
                <Button variant="text" size="small" onClick={() => setChoice('wfh')}>
                  I&apos;m working from home
                </Button>
              </>
            ) : allowUnverifiedOffice ? (
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
          <Button type="submit" size="large" loading={busy} className={styles.submit}>
            Check in
          </Button>
        </div>
        {errors._ ? (
          <p className={styles.error} role="alert">
            {errors._}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
