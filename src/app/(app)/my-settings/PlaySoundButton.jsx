'use client';
// My settings' "Play sound" (CONTRACT 26), beside "Choose a sound". The sound is started inside
// the click itself, before anything is awaited, so the click also unlocks Daybook's audio for this
// page; it plays whatever the Sound choice (so it can be tried with Off too). Picking a sound uses
// the same usePlaySound(). When the browser doesn't let it play, a toast says so.
import { useCallback } from 'react';
import { Volume2 } from 'lucide-react';
import Button from '@/components/Button';
import { playChimeNow } from '@/components/live/chime';
import { useToast } from '@/components/ToastProvider';
import styles from './page.module.css';

/**
 * Plays one of the bell's sounds at once and tells the person when the browser refused.
 * @returns {(tone: string) => void} call it synchronously inside a click handler
 */
export function usePlaySound() {
  const toast = useToast();
  return useCallback(
    (tone) => {
      let answer;
      try {
        // Synchronous on purpose: playChimeNow creates or resumes the audio inside the gesture.
        answer = playChimeNow(tone);
      } catch {
        answer = null;
      }
      Promise.resolve(answer)
        .then(
          (result) => result?.played === true,
          () => false,
        )
        .then((played) => {
          if (played) return;
          toast({
            title: "Couldn't play the sound",
            body: "Your browser didn't let Daybook play it.",
            tone: 'error',
          });
        });
    },
    [toast],
  );
}

/**
 * @param {{ tone: string, describedBy?: string }} props tone: the sound chosen in "Choose a
 *   sound" ('chime', 'bell', 'ding' or 'pop'); describedBy: the id of the row's help line
 */
export default function PlaySoundButton({ tone, describedBy }) {
  const play = usePlaySound();
  return (
    <Button
      variant="secondary"
      size="compact"
      icon={<Volume2 size={16} strokeWidth={1.8} aria-hidden="true" />}
      aria-describedby={describedBy}
      className={styles.playSound}
      onClick={() => play(tone)}
    >
      Play sound
    </Button>
  );
}
