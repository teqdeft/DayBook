'use client';
// The away question (CONTRACT 15), asked by the sidebar TimerChip only: "You were away 32 min
// (1:10–1:42 PM) while your acme-app timer ran. Keep this time or remove it?" Keep is focused, so
// Enter never removes time by accident.
import Button from './Button';
import Dialog from './Dialog';
import { awayQuestion } from './TimerChip.clock';

/**
 * @param {{ away: { minutes: number, fromClock: string, toClock: string, projectName: string }
 *   | null, busy: string | null, onAnswer: (decision: 'keep' | 'remove') => void,
 *   onClose: () => void }} props busy: the decision being sent
 */
export default function TimerAwayDialog({ away, busy, onAnswer, onClose }) {
  return (
    <Dialog
      open={Boolean(away)}
      onClose={busy ? () => {} : onClose}
      title="Your timer kept running"
      description={away ? awayQuestion(away) : null}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onAnswer('keep')}
            loading={busy === 'keep'}
            disabled={Boolean(busy)}
            data-autofocus
          >
            Keep
          </Button>
          <Button
            onClick={() => onAnswer('remove')}
            loading={busy === 'remove'}
            disabled={Boolean(busy)}
          >
            Remove
          </Button>
        </>
      }
    />
  );
}
