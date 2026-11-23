'use client';
// The away question (CONTRACT 25 A), asked by the sidebar TimerChip only: "You were away 32 min
// (1:10–1:42 PM) while your acme-app timer ran." with a muted line on what Remove does, and
// "Keep, I was working" (focused, so Enter never removes time) and "Remove, it was a break", or
// "I had left, check me out at 6:42 PM" after the day end. The buttons stack at 520 px and below.
import Button from './Button';
import Dialog from './Dialog';
import { awayChoices, awayHelp, awayQuestion } from './TimerChip.clock';
import styles from './TimerAwayDialog.module.css';

/** A plain class on the dialog's panel, so the chip can tell it from other modals. */
export const AWAY_DIALOG = 'timer-away-dialog';

/**
 * @param {{ away: { minutes: number, fromClock: string, toClock: string, projectName: string,
 *   kind?: string, left?: object | null } | null, busy: string | null,
 *   onAnswer: (decision: 'keep' | 'remove' | 'left') => void, onClose: () => void }} props
 *   busy: the decision being sent
 */
export default function TimerAwayDialog({ away, busy, onAnswer, onClose }) {
  const choices = awayChoices(away);
  const other = away?.left ? 'left' : 'remove';
  return (
    <Dialog
      open={Boolean(away)}
      onClose={busy ? () => {} : onClose}
      title="Your timer kept running"
      className={AWAY_DIALOG}
      description={away ? awayQuestion(away) : null}
      footer={
        <div className={styles.buttons}>
          <Button
            variant="secondary"
            onClick={() => onAnswer('keep')}
            loading={busy === 'keep'}
            disabled={Boolean(busy)}
            data-autofocus
          >
            {choices.keep}
          </Button>
          <Button onClick={() => onAnswer(other)} loading={busy === other} disabled={Boolean(busy)}>
            {choices.other}
          </Button>
        </div>
      }
    >
      {away ? <p className={styles.help}>{awayHelp(away)}</p> : null}
    </Dialog>
  );
}
