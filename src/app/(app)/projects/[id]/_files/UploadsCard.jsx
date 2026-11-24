'use client';
// The Uploads card above the list (CONTRACT 27, Files tab), while anything uploads, is read for the
// AI or failed: "Uploading 3 files" with "Cancel all" (which asks "Stop 12 uploads?" with "Keep
// uploading" and "Stop all"), one row per file with Cancel or Retry and Remove, the reading rows
// ("Reading brief.pdf for the AI summary… page 12 of 14"), and failed rows under "1 file couldn't
// be uploaded" until removed. The rows are UploadChip's.
import { useEffect, useRef, useState } from 'react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { UploadChips } from '@/components/files/UploadChip';
import { plural } from '@/lib/text';
import styles from './UploadsCard.module.css';

const files = (count) => `${count} ${plural(count, 'file')}`;

/** The card's heading: "Uploading 3 files", or "Reading 2 files for the AI summary". */
export function uploadsHeading(uploading, reading) {
  if (uploading > 0) return `Uploading ${files(uploading)}`;
  return reading > 0 ? `Reading ${files(reading)} for the AI summary` : null;
}

/** "1 file couldn't be uploaded" */
export const failedHeading = (count) => `${files(count)} couldn't be uploaded`;

/** "Stop 12 uploads?" */
export const stopQuestion = (count) => `Stop ${count} ${plural(count, 'upload')}?`;

/** "Stop 12 uploads?" with "Keep uploading" (focused, it is the safe answer) and "Stop all". */
function AskStop({ count, onKeep, onStop }) {
  const keep = useRef(null);
  useEffect(() => keep.current?.focus(), []);
  return (
    <span className={styles.ask}>
      <span role="status">{stopQuestion(count)}</span>
      <Button ref={keep} variant="secondary" size="small" onClick={onKeep}>
        Keep uploading
      </Button>
      <Button variant="danger" size="small" onClick={onStop}>
        Stop all
      </Button>
    </span>
  );
}

function CancelAll({ count, onCancelAll }) {
  const [asking, setAsking] = useState(false);
  const ask = useRef(null);
  if (count === 0) return null;
  if (asking) {
    return (
      <AskStop
        count={count}
        onKeep={() => {
          setAsking(false);
          requestAnimationFrame(() => ask.current?.focus());
        }}
        onStop={() => {
          setAsking(false);
          onCancelAll();
        }}
      />
    );
  }
  return (
    <Button
      ref={ask}
      variant="text"
      size="compact"
      className={styles.cancelAll}
      onClick={() => setAsking(true)}
    >
      Cancel all
    </Button>
  );
}

/**
 * @param {{ active: object[], reading: object[], failed: object[],
 *   onRemove: (id: string) => void, onRetry: (id: string) => void, onCancelAll: () => void,
 *   focusFallback?: () => void }} props active: useUploads items waiting, uploading, retrying or
 *   paused; reading: useReadForAi's rows; failed: items in error (Retry on those that can try
 *   again, a 401's)
 */
export default function UploadsCard({
  active,
  reading,
  failed,
  onRemove,
  onRetry,
  onCancelAll,
  focusFallback,
}) {
  const heading = uploadsHeading(active.length, reading.length);
  if (!heading && failed.length === 0) return null;
  return (
    <Card as="section" className={styles.card} aria-label="Uploads">
      {heading ? (
        <>
          <div className={styles.head}>
            <h3 className={styles.title}>{heading}</h3>
            <CancelAll count={active.length} onCancelAll={onCancelAll} />
          </div>
          <UploadChips
            items={[...active, ...reading]}
            one
            onRemove={onRemove}
            onRetry={onRetry}
            focusFallback={focusFallback}
          />
        </>
      ) : null}
      {failed.length > 0 ? (
        <>
          <h3 className={`${styles.title} ${heading ? styles.failedTitle : ''}`}>
            {failedHeading(failed.length)}
          </h3>
          {/* A file stopped by a 401 ("Sign in again, then press Retry.") keeps its Retry here. */}
          <UploadChips
            items={failed}
            one
            onRemove={onRemove}
            onRetry={onRetry}
            focusFallback={focusFallback}
          />
        </>
      ) : null}
    </Card>
  );
}
