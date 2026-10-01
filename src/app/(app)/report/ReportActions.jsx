'use client';
// Right side of the Daily report top bar: the live total ("8h logged", "of 8h 58m checked in"),
// a quiet save status, and Submit report / Update report (or Request an edit once locked).
import { useState } from 'react';
import Button from '@/components/Button';
import { formatDuration, formatHours } from '@/lib/time';
import RequestEditDialog from './RequestEditDialog';
import { useReport } from './ReportProvider';
import { totalMinutes } from './reportState';
import styles from './ReportActions.module.css';

const SAVE_TEXT = {
  waiting: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Not saved',
  offline: 'Offline, retrying…',
  unsaved: 'Unsaved changes',
};

function presentLine(data) {
  if (!data.tracksAttendance && data.presentMinutes === null) return null;
  if (data.presentMinutes === null) return data.isToday ? 'not checked in yet' : 'not checked in';
  return `of ${formatDuration(data.presentMinutes)} checked in`;
}

export default function ReportActions() {
  const { data, entries, report, saveState, submitting, readOnly, stale, submit } = useReport();
  const [asking, setAsking] = useState(false);
  const logged = formatHours(totalMinutes(entries));
  const present = presentLine(data);
  const pending = report.pendingEditRequest;
  const saveText = readOnly ? null : SAVE_TEXT[saveState];

  return (
    <div className={styles.actions}>
      {saveText ? (
        <p
          className={`${styles.save} ${saveState === 'failed' || saveState === 'offline' ? styles.saveProblem : ''}`}
          role="status"
        >
          {saveText}
        </p>
      ) : null}
      <div className={styles.totals} aria-live="polite">
        <p className={styles.logged}>{logged} logged</p>
        {present ? <p className={styles.present}>{present}</p> : null}
      </div>
      {stale ? (
        // The report changed somewhere else; the notice under the top bar says so.
        <Button size="large" onClick={() => window.location.reload()}>
          Reload report
        </Button>
      ) : readOnly ? (
        <Button
          size="large"
          variant={pending ? 'secondary' : 'primary'}
          disabled={Boolean(pending)}
          onClick={() => setAsking(true)}
        >
          {pending ? 'Edit requested' : 'Request an edit'}
        </Button>
      ) : (
        <Button size="large" loading={submitting} onClick={submit}>
          {report.status === 'submitted' ? 'Update report' : 'Submit report'}
        </Button>
      )}
      {readOnly && !stale ? (
        <RequestEditDialog
          open={asking}
          onClose={() => setAsking(false)}
          fixedDate={report.workDate}
        />
      ) : null}
    </div>
  );
}
