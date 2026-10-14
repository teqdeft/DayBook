'use client';
// The reason on a pending work-from-home tile (CONTRACT 17). HR decides on it, so all of it must
// be readable: three lines, then "Show all" when it runs longer (on a phone and from the keyboard
// too, which a hover title is not).
import { useEffect, useId, useRef, useState } from 'react';
import Button from '@/components/Button';
import styles from './WfhRequestsCard.module.css';

/** @param {{ text: string }} props up to 500 characters */
export default function WfhReason({ text }) {
  const id = useId();
  const ref = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);

  // Whether three lines cut it off, again whenever the tile's width changes.
  useEffect(() => {
    const element = ref.current;
    if (!element || expanded) return undefined;
    const observer = new ResizeObserver(() => {
      setClipped(element.scrollHeight > element.clientHeight + 1);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <>
      <p ref={ref} id={id} className={expanded ? styles.reasonFull : styles.reason}>
        {text}
      </p>
      {clipped || expanded ? (
        <Button
          variant="text"
          size="small"
          className={styles.reasonToggle}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show all'}
        </Button>
      ) : null}
    </>
  );
}
