'use client';

import { useEffect, useState } from 'react';
import styles from './LaunchSplash.module.css';

const PLAY_MS = 2950; // the CSS fade-out ends at 2.9 s

/** Decorative and click-through: the app is usable underneath while it plays. */
export default function LaunchSplash() {
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Skipped launches are already hidden by CSS; unmount them right away, played ones at the end.
    const skipped = document.documentElement.getAttribute('data-launch') === 'skip';
    const timer = setTimeout(() => setDone(true), skipped ? 0 : PLAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (done) return null;
  return (
    <div className={styles.splash} aria-hidden="true">
      <div className={styles.lockup}>
        <div className={styles.tile}>
          {Array.from({ length: 18 }, (_, i) => (
            <div
              key={i}
              className={styles.layer}
              style={{ transform: `translateZ(${-(i + 1) * 1.1}px)` }}
            />
          ))}
          <div className={styles.back} />
          <div className={styles.face}>
            <div className={styles.sheen} />
          </div>
          <svg className={styles.glyph} viewBox="0 0 32 32" focusable="false">
            <rect className={styles.bar} x="7.5" y="10.25" width="12.5" height="2.25" rx="1.125" />
            <rect className={styles.line} x="9" y="18.6" width="14" height="2" />
            <circle className={styles.dotWhite} cx="9" cy="19.6" r="2.9" />
            <circle className={styles.sun} cx="23" cy="19.6" r="2.9" />
          </svg>
        </div>
        <span className={styles.word}>daybook</span>
      </div>
      <p className={styles.tagline}>Check in, log your day, send your report</p>
    </div>
  );
}
