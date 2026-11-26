'use client';
// The right column of the Daily report: the exact Slack message the report posts, built by the
// same formatReport() the server uses, under the person's name and photo. "Copy" in its header
// copies that message as it is, to paste into Slack or another chat by hand (CONTRACT 28).
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Card, { CardHeader } from '@/components/Card';
import { useToast } from '@/components/ToastProvider';
import { copyText } from '@/lib/copyText';
import { formatReport } from '@/modules/slack/format';
import { useReport } from './ReportProvider';
import { previewEntries } from './reportState';
import styles from './SlackPreview.module.css';

/** How long "Copied" shows; a second click within it copies again and starts it over. */
const COPIED_MS = 2000;

/**
 * "Copied" for 2 s after a copy, with the polite live region's text (cleared first, then set on
 * the next frame, so a second copy is read out again).
 * @returns {{ copied: boolean, said: string, show: () => void, reset: () => void }}
 */
function useCopied() {
  const [copied, setCopied] = useState(false);
  const [said, setSaid] = useState('');
  const timer = useRef(0);
  const frame = useRef(0);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      cancelAnimationFrame(frame.current);
    },
    [],
  );
  const reset = () => {
    clearTimeout(timer.current);
    cancelAnimationFrame(frame.current);
    setCopied(false);
    setSaid('');
  };
  const show = () => {
    reset();
    setCopied(true);
    frame.current = requestAnimationFrame(() => setSaid('Slack message copied'));
    timer.current = setTimeout(reset, COPIED_MS);
  };
  return { copied, said, show, reset };
}

/** The header's Copy button: the message as the preview shows it, nothing else. */
function CopyButton({ text }) {
  const toast = useToast();
  const { copied, said, show, reset } = useCopied();
  const copy = async () => {
    if (await copyText(text)) {
      show();
      return;
    }
    reset();
    toast({
      tone: 'error',
      title: "Couldn't copy the message",
      body: 'Select the text in the preview and copy it.',
    });
  };
  return (
    <>
      <Button
        variant="secondary"
        size="small"
        aria-label="Copy Slack message"
        onClick={copy}
        icon={
          <span className={styles.icons} data-copied={copied || undefined} aria-hidden="true">
            <Copy className={styles.copyIcon} size={16} strokeWidth={1.8} />
            <Check className={styles.checkIcon} size={16} strokeWidth={1.8} />
          </span>
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <span className="visually-hidden" role="status">
        {said}
      </span>
    </>
  );
}

export default function SlackPreview() {
  const { data, entries, report } = useReport();
  const text = formatReport({
    userName: data.user.name,
    workDate: report.workDate,
    entries: previewEntries(entries),
  });
  return (
    <Card padding="none" as="section" aria-label="Slack preview" className={styles.card}>
      <CardHeader
        title="Slack preview"
        subtitle={report.status === 'submitted' ? data.slackLines.submitted : data.slackLines.draft}
        actions={<CopyButton text={text} />}
        divider
        className={styles.header}
      />
      <div className={styles.body}>
        <Avatar
          user={data.user}
          size={36}
          shape="square"
          tone={data.user.avatarUrl ? undefined : 'blue'}
          className={styles.avatar}
        />
        <div className={styles.message}>
          <p className={styles.meta}>
            <span className={styles.name}>{data.user.name}</span>
            <span className={styles.time}>{data.previewTime}</span>
          </p>
          <p className={styles.text}>{text}</p>
        </div>
      </div>
    </Card>
  );
}
