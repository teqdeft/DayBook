'use client';
// "Suggested wording" (CONTRACT 20, Polish my tasks): each task line Gemini reworded, before →
// after, with a checkbox (all ticked). Use selected applies the ticked ones; Cancel keeps every
// line as it is. Lines Gemini left unchanged aren't listed. Opened by Polish with AI, focus starts
// on Use selected; opened by itself after Fill report from timers, it starts on the list, so a key
// the person was still typing can't apply or untick anything.
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import styles from './PolishDialog.module.css';

/**
 * @param {{ items: Array<{ key: string, projectName: string, before: string, after: string }>,
 *   auto?: boolean, onUse: (picked: Array<{ key: string, before: string, after: string }>) =>
 *   void, onClose: () => void }} props items from reportPolish.changedSuggestions (at least one);
 *   auto = opened after Fill report from timers, not by a press of Polish with AI
 */
export default function PolishDialog({ items, auto = false, onUse, onClose }) {
  const [picked, setPicked] = useState(() => new Set(items.map((item) => item.key)));

  function toggle(key, checked) {
    setPicked((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      width={600}
      title="Suggested wording"
      description="Gemini suggested clearer wording. Untick any task you want to keep as it is."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={picked.size === 0}
            onClick={() => onUse(items.filter((item) => picked.has(item.key)))}
            data-autofocus={auto ? undefined : true}
          >
            Use selected
          </Button>
        </>
      }
    >
      <ul
        className={styles.list}
        aria-label="Suggested changes"
        tabIndex={auto ? -1 : undefined}
        data-autofocus={auto ? true : undefined}
      >
        {items.map((item) => (
          <li key={item.key}>
            <label className={styles.item}>
              <input
                type="checkbox"
                className={styles.check}
                checked={picked.has(item.key)}
                onChange={(event) => toggle(item.key, event.target.checked)}
              />
              <span className={styles.text}>
                {item.projectName ? (
                  <span className={styles.project}>{item.projectName}</span>
                ) : null}
                <span className={styles.before}>
                  <span className="visually-hidden">Now: </span>
                  {item.before}
                </span>
                <span className={styles.after}>
                  <ArrowRight
                    size={16}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    className={styles.arrow}
                  />
                  <span>
                    <span className="visually-hidden">Suggested: </span>
                    {item.after}
                  </span>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
