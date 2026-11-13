'use client';
// "Colour label" (CONTRACT 23): the seven presets as round native radio buttons (the selected one
// has a ring), then "More colours", a round button that opens a panel under the row with eight
// more swatches and "Any colour" (the browser's colour input). A colour from the panel is stored as
// a custom '#rrggbb' and only reaches the CSS as --project (projectColorStyle).
import { useEffect, useId, useRef, useState } from 'react';
import { Palette, Pipette } from 'lucide-react';
import {
  COLOR_PROBLEM_MESSAGES,
  DEFAULT_CUSTOM_COLOR,
  MORE_COLORS,
  PROJECT_COLORS,
  PROJECT_COLOR_LABELS,
  colorProblem,
  isCustomColor,
  normalizeColor,
  projectColorStyle,
} from '@/lib/projectColors';
import styles from './ColorSwatches.module.css';

/**
 * What "Any colour" picked: the colour to apply, or why it can't be used (the server checks again).
 * @param {string} raw the colour input's value
 * @returns {{ color: string | null, problem: null | 'light' | 'dark' }}
 */
function readPickedColor(raw) {
  const hex = normalizeColor(raw);
  if (!isCustomColor(hex)) return { color: null, problem: null };
  const problem = colorProblem(hex);
  return { color: problem ? null : hex, problem };
}

/** The dashed circle with the palette icon, or the custom colour with the selected ring. */
function MoreButton({ value, open, panelId, buttonRef, onToggle }) {
  const custom = isCustomColor(value);
  return (
    <button
      ref={buttonRef}
      type="button"
      className={styles.more}
      title="More colours"
      aria-label={custom ? 'More colours, custom colour chosen' : 'More colours'}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
    >
      <span
        className={custom ? `${styles.moreDot} ${styles.custom}` : styles.moreDot}
        style={projectColorStyle(value)}
        aria-hidden="true"
      >
        {custom ? null : <Palette size={16} strokeWidth={1.8} />}
      </span>
    </button>
  );
}

/** The inline panel: the eight more colours, then "Any colour". */
function MorePanel({ value, ids, describedBy, inputRef, onPick, onKeyDown }) {
  return (
    <div
      id={ids.panel}
      role="group"
      aria-labelledby={ids.title}
      className={styles.panel}
      onKeyDown={onKeyDown}
    >
      <span id={ids.title} className={styles.panelTitle}>
        More colours
      </span>
      <div className={styles.panelSwatches}>
        {MORE_COLORS.map((color) => (
          <button
            key={color.key}
            type="button"
            className={styles.panelSwatch}
            title={color.label}
            aria-label={color.label}
            aria-pressed={value === color.hex}
            onClick={() => onPick(color.hex)}
          >
            <span
              className={`${styles.dot} ${styles.custom}`}
              style={projectColorStyle(color.hex)}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      <label className={styles.anyColour}>
        <Pipette size={16} strokeWidth={1.8} aria-hidden="true" />
        Any colour
        <input
          ref={inputRef}
          type="color"
          defaultValue={isCustomColor(value) ? value : DEFAULT_CUSTOM_COLOR}
          aria-label="Any colour"
          aria-describedby={describedBy}
          className={styles.colorInput}
        />
      </label>
    </div>
  );
}

/**
 * @param {{ value: string, onChange: (color: string) => void, error?: string, name?: string,
 *   className?: string }} props
 *   `value` is a preset name or a custom '#rrggbb'. `error` is the API's message for the colour; a
 *   colour from "Any colour" that can't be seen shows its own message in the same line instead and
 *   is not applied.
 */
export default function ColorSwatches({
  value,
  onChange,
  error,
  name = 'project-color',
  className,
}) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState(null);
  const buttonRef = useRef(null);
  const inputRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const panelId = useId();
  const titleId = useId();
  const errorId = useId();
  const ids = { panel: panelId, title: titleId, error: errorId };
  const message = problem ? COLOR_PROBLEM_MESSAGES[problem] : error;

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // "Any colour" applies on the input's change event (the picker is closed), not on every input
  // event while the person drags in it, which is what React's onChange would give.
  useEffect(() => {
    const input = inputRef.current;
    if (!open || !input) return undefined;
    function onPicked() {
      const picked = readPickedColor(input.value);
      setProblem(picked.problem);
      if (picked.color) onChangeRef.current(picked.color);
    }
    input.addEventListener('change', onPicked);
    return () => input.removeEventListener('change', onPicked);
  }, [open]);

  function showPanel(next) {
    setOpen(next);
    setProblem(null);
  }

  function pickSwatch(hex) {
    onChange(hex);
    showPanel(false);
    // The swatch goes with the panel, so focus moves to the button instead of the page.
    buttonRef.current?.focus();
  }

  function onPanelKeyDown(event) {
    if (event.key !== 'Escape') return;
    // Close the panel, not the drawer. The Drawer is a portal on document.body, where React handles
    // its events, so stopPropagation keeps this Escape from useModal's listener on the document.
    // useModal also skips a prevented key, which covers the panel outside a portal.
    event.preventDefault();
    event.stopPropagation();
    showPanel(false);
    buttonRef.current?.focus();
  }

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <div className={styles.swatches}>
        {PROJECT_COLORS.map((color) => (
          <label key={color} className={styles.swatch} title={PROJECT_COLOR_LABELS[color]}>
            <input
              type="radio"
              name={name}
              value={color}
              checked={value === color}
              onChange={() => {
                onChange(color);
                showPanel(false);
              }}
              className={styles.input}
              aria-label={PROJECT_COLOR_LABELS[color]}
            />
            <span className={`${styles.dot} ${styles[color]}`} aria-hidden="true" />
          </label>
        ))}
        <MoreButton
          value={value}
          open={open}
          panelId={ids.panel}
          buttonRef={buttonRef}
          onToggle={() => showPanel(!open)}
        />
      </div>
      {open ? (
        <MorePanel
          value={value}
          ids={ids}
          describedBy={message ? ids.error : undefined}
          inputRef={inputRef}
          onPick={pickSwatch}
          onKeyDown={onPanelKeyDown}
        />
      ) : null}
      {message ? (
        <p id={ids.error} className={styles.error} role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
