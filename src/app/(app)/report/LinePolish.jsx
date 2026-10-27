'use client';
// "Polish on each task line" (CONTRACT 21): the sparkle at the right end of a task line's field
// and the suggestion strip under the line. TaskLine places them and moves the focus; the requests
// and each line's state live in PolishProvider (useLinePolish.js).
import { useEffect, useId, useRef } from 'react';
import { CornerDownRight, LoaderCircle, Sparkles } from 'lucide-react';
import Button from '@/components/Button';
import styles from './LinePolish.module.css';

/**
 * The sparkle. While Gemini writes it is a spinner and ignores presses, but stays focusable
 * (aria-disabled, not disabled), so a keyboard user keeps their place and lands on Use next.
 * TaskLine's className decides when it shows (row hover or focus, busy or suggesting, touch
 * screens wider than a phone).
 * @param {{ ref?: import('react').Ref<HTMLButtonElement>, label: string, busy: boolean,
 *   disabled?: boolean, className?: string, onPolish: () => void }} props label: "Polish task 2
 *   for acme-app with AI"
 */
export function LinePolishButton({ ref, label, busy, disabled = false, className, onPolish }) {
  return (
    <button
      ref={ref}
      type="button"
      className={[styles.sparkle, busy ? styles.busy : null, className].filter(Boolean).join(' ')}
      aria-label={label}
      title="Polish with AI"
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      disabled={disabled}
      onClick={busy ? undefined : onPolish}
    >
      {busy ? (
        <LoaderCircle className={styles.spinner} size={16} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * The suggestion under a line: an arrow, the suggested text ("Suggested:" for screen readers),
 * Keep mine and Use. Focus moves to Use when it appears, unless the person went on to something
 * else while Gemini was writing (typing in another line keeps its focus). Escape is Keep mine.
 * While the report is submitting both buttons are disabled, like the rest of the line: the
 * submitted copy would replace a title Use changed meanwhile.
 * @param {{ text: string, label: string, disabled?: boolean, onUse: () => void,
 *   onKeep: () => void }} props label names the group ("Suggested wording for task 2 for
 *   acme-app")
 */
export function LineSuggestion({ text, label, disabled = false, onUse, onKeep }) {
  const textId = useId();
  const stripRef = useRef(null);
  const useButtonRef = useRef(null);

  useEffect(() => {
    const active = document.activeElement;
    const row = stripRef.current?.closest('li');
    if (!active || active === document.body || row?.contains(active)) {
      useButtonRef.current?.focus();
    }
  }, []);

  function onKeyDown(event) {
    if (event.key !== 'Escape' || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    onKeep();
  }

  return (
    <div
      ref={stripRef}
      className={styles.strip}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      <CornerDownRight size={16} strokeWidth={1.8} aria-hidden="true" className={styles.arrow} />
      <p id={textId} className={styles.text}>
        <span className="visually-hidden">Suggested: </span>
        {text}
      </p>
      <div className={styles.buttons}>
        <Button
          variant="secondary"
          size="small"
          className={styles.action}
          disabled={disabled}
          onClick={onKeep}
        >
          Keep mine
        </Button>
        <Button
          ref={useButtonRef}
          size="small"
          className={styles.action}
          aria-describedby={textId}
          disabled={disabled}
          onClick={onUse}
        >
          Use
        </Button>
      </div>
    </div>
  );
}
