'use client';
// Today's missing check-out line and pop-up (CONTRACT 25, item B). The line ("You didn't check out
// on Fri, 13 Nov." with "Add the time") shows while the person has missing check-outs, hidden or
// not. The pop-up opens by itself once per page load, 1.5 s after hydration, when a row wasn't
// hidden today, and only while no other modal is open (the timer's away question wins), checking
// again every 2 s for up to a minute; AutoRefresh never reopens it. From the bell or Slack
// (`?checkout=missing`) it opens even when hidden today, then the address becomes /today. The
// bell on Today itself follows the link without loading the page again, so it opens then too.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import MissingCheckoutDialog from './MissingCheckoutDialog';
import { FIRST_TRY_MS, MAX_TRIES, RETRY_MS, promptLine } from './todayMissing';
import styles from './page.module.css';

const otherModalOpen = () => Boolean(document.querySelector('[aria-modal="true"]'));

/**
 * Opens the pop-up once per page load when it should, waiting for any other modal. A link to
 * ?checkout=missing followed on Today (the bell, a desktop notification) keeps this mounted, so
 * openMissing turning true asks once more.
 */
function useAutoOpen({ wanted, openMissing, onOpen }) {
  const router = useRouter();
  const done = useRef(false);
  const linked = useRef(openMissing);
  useEffect(() => {
    if (openMissing && !linked.current) done.current = false;
    linked.current = openMissing;
    if (done.current) return undefined;
    const leaveLink = () => {
      if (openMissing) router.replace('/today', { scroll: false });
    };
    if (!wanted) {
      done.current = true;
      leaveLink();
      return undefined;
    }
    let tries = 0;
    let timer;
    const attempt = () => {
      tries += 1;
      if (!otherModalOpen()) {
        done.current = true;
        onOpen();
        leaveLink();
      } else if (tries >= MAX_TRIES) {
        done.current = true;
        leaveLink();
      } else {
        timer = setTimeout(attempt, RETRY_MS);
      }
    };
    timer = setTimeout(attempt, FIRST_TRY_MS);
    return () => clearTimeout(timer);
  }, [wanted, openMissing, onOpen, router]);
}

/**
 * @param {{ missing: { items: object[], autoOpen: boolean }, openMissing: boolean }} props
 *   missing = listMyMissingCheckouts(); openMissing = the page was opened with
 *   ?checkout=missing (the bell, Slack)
 */
export default function MissingCheckoutPrompt({ missing, openMissing = false }) {
  const items = missing?.items ?? [];
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const wanted = items.length > 0 && (openMissing || Boolean(missing?.autoOpen));
  useAutoOpen({ wanted, openMissing, onOpen: show });

  const line = promptLine(items);
  return (
    <>
      {line ? (
        <p className={styles.helpText}>
          {line.text}{' '}
          <Button variant="text" size="small" onClick={show}>
            {line.button}
          </Button>
        </p>
      ) : null}
      {open && items.length > 0 ? (
        <MissingCheckoutDialog items={items} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
