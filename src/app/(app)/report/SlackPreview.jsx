'use client';
// The right column of the Daily report: the exact Slack message the report posts, built by the
// same formatReport() the server uses, under the person's name and photo.
import Avatar from '@/components/Avatar';
import Card, { CardHeader } from '@/components/Card';
import { formatReport } from '@/modules/slack/format';
import { useReport } from './ReportProvider';
import { previewEntries } from './reportState';
import styles from './SlackPreview.module.css';

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
