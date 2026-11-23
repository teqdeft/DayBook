'use client';
// Today's missing check-out pop-up (CONTRACT 25, item B): "You didn't check out on Fri, 13 Nov",
// the time the person left (prefilled with Daybook's suggestion), and over the self-fix limit a
// marigold box and a reason for HR. Save stores it (or sends it to HR) and moves to the next row
// from the answer; Not now, Escape and the close button hide the rows until tomorrow.
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import {
  dialogWords,
  limitText,
  needsHr,
  nextStatus,
  savedToast,
  suggestionHelp,
} from './todayMissing';
import styles from './MissingCheckoutDialog.module.css';

const GONE = new Set(['CONFLICT', 'NOT_FOUND', 'REQUEST_ALREADY_PENDING']);

/** One row's fields; keyed by the row, so the next row starts fresh and its time gets focus. */
function RowFields({ row, id, time, reason, over, errors, onTime, onReason, refocus }) {
  const timeRef = useRef(null);
  useEffect(() => {
    if (refocus) timeRef.current?.focus();
  }, [refocus]);
  const words = dialogWords(row);
  return (
    <div className={styles.fields}>
      <p className={styles.checkedIn}>{words.checkedIn}</p>
      <Field
        label="Time you left"
        htmlFor={`${id}-time`}
        help={errors.checkOut ? null : suggestionHelp(row)}
        error={errors.checkOut}
      >
        <Input
          ref={timeRef}
          id={`${id}-time`}
          type="time"
          value={time}
          onChange={(event) => onTime(event.target.value)}
          className={styles.time}
          data-autofocus
          required
        />
      </Field>
      {over ? (
        <div className={styles.limitBox} role="status">
          {limitText(row)}
        </div>
      ) : null}
      {over ? (
        <Field
          label="Reason for HR"
          htmlFor={`${id}-reason`}
          help={errors.reason ? null : 'It goes to HR as a correction request.'}
          error={errors.reason}
        >
          <Textarea
            id={`${id}-reason`}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => onReason(event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}

/**
 * @param {{ items: Array<{ attendanceId: number, workDate: string, checkInClock: string,
 *   suggestedClock: string | null, limitClock: string | null }>, onClose: () => void }} props
 *   items = listMyMissingCheckouts().items at the moment it opened
 */
export default function MissingCheckoutDialog({ items, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [rows, setRows] = useState(items);
  const [saved, setSaved] = useState(0);
  const [time, setTime] = useState(items[0]?.suggestedClock ?? '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [forceHr, setForceHr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const row = rows[0];
  const over = forceHr || needsHr(time, row);

  function finish() {
    onClose();
    if (saved > 0) router.refresh();
  }

  /** Not now, Escape and ×: the listed rows stay away until tomorrow (no toast). */
  function notNow() {
    if (busy) return;
    api.post('/api/attendance/me/missing-checkouts/hide').catch(() => {});
    finish();
  }

  /** The next row from the fresh list (or close when none is left). */
  function advance(fresh, { announce = true } = {}) {
    if (!fresh?.length) {
      onClose();
      router.refresh();
      return;
    }
    setRows(fresh);
    setTime(fresh[0].suggestedClock ?? '');
    setReason('');
    setErrors({});
    setForceHr(false);
    setStatus(announce ? nextStatus(fresh[0]) : '');
  }

  function failed(error) {
    const { checkOut, reason: reasonError } = error.fields ?? {};
    if (checkOut || reasonError) {
      // The server works the limit out again; when it wants a reason, ask for one.
      if (reasonError) setForceHr(true);
      setErrors({ checkOut, reason: reasonError });
      return;
    }
    toast({ title: "Couldn't save your check-out", body: error.message, tone: 'error' });
    // Fixed by HR meanwhile, already sent, or gone: that row leaves the pop-up.
    if (GONE.has(error.code)) {
      setSaved((count) => count + 1);
      advance(rows.slice(1), { announce: false });
    }
  }

  /** What the form still needs before it is sent, or null. */
  function problem() {
    if (!time) return { checkOut: 'Enter the time you left.' };
    if (over && reason.trim().length < 2) return { reason: 'Add a reason for HR.' };
    return null;
  }

  async function submit(event) {
    event.preventDefault();
    const missingField = problem();
    if (missingField) {
      setErrors(missingField);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const body = { checkOut: time, ...(over ? { reason } : {}) };
      const path = `/api/attendance/me/missing-checkouts/${row.attendanceId}/fix`;
      const { data } = await api.post(path, body);
      toast(savedToast(data.outcome, row, time));
      setSaved((count) => count + 1);
      advance(data.missing?.items);
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }

  const total = saved + rows.length;
  return (
    <Dialog
      open
      onClose={notNow}
      width={440}
      title={dialogWords(row).title}
      description="What time did you leave?"
      onSubmit={submit}
      footer={
        <>
          {total > 1 ? (
            <span className={styles.count}>
              {saved + 1} of {total}
            </span>
          ) : null}
          <Button variant="secondary" onClick={notNow} disabled={busy}>
            Not now
          </Button>
          <Button type="submit" loading={busy}>
            {over ? 'Send to HR' : 'Save'}
          </Button>
        </>
      }
    >
      <RowFields
        key={row.attendanceId}
        row={row}
        id={id}
        time={time}
        reason={reason}
        over={over}
        errors={errors}
        onTime={(value) => {
          setTime(value);
          setErrors(({ checkOut: _gone, ...rest }) => rest);
        }}
        onReason={(value) => {
          setReason(value);
          setErrors(({ reason: _gone, ...rest }) => rest);
        }}
        refocus={saved > 0}
      />
      <span className="visually-hidden" role="status">
        {status}
      </span>
    </Dialog>
  );
}
