'use client';
// HR's break list (CONTRACT 25, item 2): "Priya Sharma's breaks", one row per break (the range,
// the minutes, "Break", "Away, removed from timer" or "On break now" with how it ended), and for
// HR and Admins "Change end" (End break while open) and "Delete" with a reason (BreakFixForm).
// PMs read it only. Opened from the Present cell (BreaksButton) and the person month. HR never
// sees the project or any screen time here.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import Skeleton from '@/components/Skeleton';
import { clockRange } from '@/components/TimerChip.clock';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/apiClient';
import { formatClock, formatDuration } from '@/lib/time';
import BreakFixForm from './BreakFixForm';
import styles from './BreakListDialog.module.css';

const DONE = { change: 'Break changed', delete: 'Break deleted' };

/** The muted line under the list, by who is looking. */
function footLine(data) {
  if (!data?.canCorrect) return null;
  if (data.needsUpdate) return 'Fixing breaks needs the latest database update. Ask an Admin.';
  if (data.ownRow) return 'Your own breaks. Another HR person or an Admin can change them.';
  return 'Fix a break someone forgot to end. Your reason is saved with every change.';
}

const minutesText = (minutes) => (minutes > 0 ? formatDuration(minutes) : '0m');

/** One break: range and minutes, the label line, the buttons and the open form. */
function BreakRow({ item, canChange, form, buttonRef, onOpen, children }) {
  const range = item.open
    ? `Since ${formatClock(item.startClock)}`
    : clockRange(item.startClock, item.endClock);
  const line = [item.label, item.note].filter(Boolean).join(' · ');
  return (
    <li className={styles.row}>
      <div className={styles.top}>
        <span className={styles.range}>{range}</span>
        <span className={`${styles.minutes} ${item.open ? styles.openMinutes : ''}`}>
          {minutesText(item.minutes)}
          {item.open ? ' so far' : ''}
        </span>
      </div>
      <p className={styles.label}>{line}</p>
      {canChange ? (
        <div className={styles.actions}>
          <Button
            ref={buttonRef('change')}
            variant="text"
            size="compact"
            className={styles.action}
            aria-expanded={form === 'change'}
            onClick={() => onOpen('change')}
          >
            {item.open ? 'End break' : 'Change end'}
          </Button>
          <Button
            ref={buttonRef('delete')}
            variant="text"
            size="compact"
            className={`${styles.action} ${styles.danger}`}
            aria-expanded={form === 'delete'}
            onClick={() => onOpen('delete')}
          >
            Delete
          </Button>
        </div>
      ) : null}
      {children}
    </li>
  );
}

/** The list's body: loading, failed, empty, or the rows. */
function ListBody({ status, data, onRetry, renderRow }) {
  if (status === 'loading') {
    return (
      <div className={styles.loading}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height={44} radius={10} />
        ))}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className={styles.failed}>
        <p>Couldn&apos;t load the breaks.</p>
        <Button variant="secondary" size="compact" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (data.breaks.length === 0) return <p className={styles.empty}>No breaks on this day.</p>;
  return <ul className={styles.list}>{data.breaks.map(renderRow)}</ul>;
}

/**
 * @param {{ attendanceId: number, open: boolean, onClose: () => void, personName?: string,
 *   onSaved?: () => void }} props personName: the title while the list loads; onSaved: refreshes
 *   the page after a save or delete (BreakListHost), router.refresh() without it
 */
export default function BreakListDialog({ attendanceId, open, onClose, personName, onSaved }) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [form, setForm] = useState(null);
  const [said, setSaid] = useState('');
  const titleRef = useRef(null);
  const buttons = useRef(new Map());

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const { data: list } = await api.get(`/api/attendance/${attendanceId}/breaks`);
      setData(list);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [attendanceId]);

  useEffect(() => {
    if (!open) return undefined;
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [open, load]);

  const buttonRef = (id) => (kind) => (element) => {
    if (element) buttons.current.set(`${id}:${kind}`, element);
    else buttons.current.delete(`${id}:${kind}`);
  };

  function cancel() {
    const key = form && `${form.id}:${form.kind}`;
    setForm(null);
    requestAnimationFrame(() => buttons.current.get(key)?.focus());
  }

  function done(list, kind) {
    setData(list);
    setForm(null);
    setSaid(DONE[kind]);
    toast({ title: DONE[kind] });
    if (onSaved) onSaved();
    else router.refresh();
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  const name = data?.person?.name ?? personName ?? '';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={480}
      title={
        <span ref={titleRef} tabIndex={-1} className={styles.title}>
          {name ? `${name}'s breaks` : 'Breaks'}
        </span>
      }
      description={data?.description ?? null}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <ListBody
        status={status}
        data={data}
        onRetry={load}
        renderRow={(item) => (
          <BreakRow
            key={item.id}
            item={item}
            canChange={data.canChange}
            form={form?.id === item.id ? form.kind : null}
            buttonRef={buttonRef(item.id)}
            onOpen={(kind) => setForm({ id: item.id, kind })}
          >
            {form?.id === item.id ? (
              <BreakFixForm
                key={form.kind}
                attendanceId={attendanceId}
                item={item}
                kind={form.kind}
                onCancel={cancel}
                onDone={done}
              />
            ) : null}
          </BreakRow>
        )}
      />
      {status === 'ready' && footLine(data) ? (
        <p className={styles.foot}>{footLine(data)}</p>
      ) : null}
      <span className="visually-hidden" role="status">
        {said}
      </span>
    </Dialog>
  );
}
