'use client';
// What the Working on card shows on top (CONTRACT 15): the running timer (project, task or note, a
// ticking 1:24:10, Switch project and Stop) or, on a break, "Timer paused for your break".
import { ArrowLeftRight, Coffee, Square } from 'lucide-react';
import Button from '@/components/Button';
import ProjectLabel from '@/components/ProjectLabel';
import { elapsedSeconds, formatElapsed } from '@/components/TimerChip.clock';
import { shortDuration } from './timerData';
import { EntryText } from './TimerEntries';
import styles from './TimerCard.module.css';

export function Running({
  entry,
  serverMs,
  canSwitch,
  busy,
  stopping,
  onSwitch,
  onStop,
  stopRef,
  switchRef,
}) {
  const seconds = elapsedSeconds(entry.startedAt, serverMs);
  return (
    <div className={styles.running}>
      <div className={styles.what}>
        <span className={styles.liveDot} aria-hidden="true" />
        <ProjectLabel
          project={{ name: entry.projectName, color: entry.projectColor }}
          size="lg"
          className={styles.project}
        />
        <EntryText entry={entry} empty="No note" className={styles.whatText} />
      </div>
      <span
        className={styles.elapsed}
        role="timer"
        aria-label={`Running for ${shortDuration(Math.floor(seconds / 60))}`}
      >
        {formatElapsed(seconds)}
      </span>
      <div className={styles.buttons}>
        {canSwitch ? (
          <Button
            ref={switchRef}
            variant="secondary"
            icon={<ArrowLeftRight size={18} strokeWidth={1.8} aria-hidden="true" />}
            onClick={onSwitch}
            disabled={busy}
          >
            Switch project
          </Button>
        ) : null}
        <Button
          ref={stopRef}
          icon={<Square size={15} strokeWidth={1.8} aria-hidden="true" />}
          onClick={onStop}
          loading={stopping}
          disabled={busy}
        >
          Stop
        </Button>
      </div>
    </div>
  );
}

export function Paused({ entry, seconds }) {
  return (
    <div className={styles.paused}>
      <span className={styles.pausedIcon} aria-hidden="true">
        <Coffee size={20} strokeWidth={1.8} />
      </span>
      <div className={styles.pausedText}>
        <p className={styles.pausedTitle}>
          {entry ? 'Timer paused for your break' : "You're on a break"}
        </p>
        <p className={styles.pausedHint}>
          {entry
            ? `${entry.projectName} starts again when you end your break.`
            : "Start a timer when you're back."}
        </p>
      </div>
      <span
        className={`${styles.elapsed} ${styles.breakElapsed}`}
        role="timer"
        aria-label={`On break for ${shortDuration(Math.floor(seconds / 60))}`}
      >
        {formatElapsed(seconds)}
      </span>
    </div>
  );
}
