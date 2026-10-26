// /summaries/[id] (CONTRACT 20): one of the signed-in person's AI summaries — a PM's daily project
// summary or HR's weekly attendance notes — as written, with the AI note. Someone else's summary,
// or one that doesn't exist, is the app's "Page not found".
import { notFound } from 'next/navigation';
import Card from '@/components/Card';
import TopBar from '@/components/TopBar';
import { isAppError } from '@/lib/errors';
import { requirePage } from '@/lib/session';
import { aiSummaries } from '@/modules/aiSummaries';
import AiNote from '../AiNote';
import SummaryKindIcon from '../SummaryKindIcon';
import styles from './page.module.css';

export const metadata = { title: 'Summary' };

async function loadSummary(user, id) {
  try {
    return await aiSummaries.getMine({ user, id });
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

function Block({ block }) {
  if (block.type === 'list') {
    return (
      <ul className={styles.list}>
        {block.items.map((item, index) => (
          <li key={index} className={item.sub ? styles.subItem : styles.listItem}>
            {item.text}
          </li>
        ))}
      </ul>
    );
  }
  return <p className={block.type === 'label' ? styles.label : styles.paragraph}>{block.text}</p>;
}

export default async function SummaryPage({ params }) {
  const user = await requirePage(null);
  const { id } = await params;
  const summary = await loadSummary(user, id);

  return (
    <>
      <TopBar
        breadcrumb={[{ label: 'Summaries', href: '/summaries' }, { label: summary.periodLabel }]}
        title={
          <span className={styles.title}>
            <SummaryKindIcon kind={summary.kind} size={36} />
            <span className={styles.titleText}>{summary.title}</span>
          </span>
        }
        subtitle={`${summary.kindLabel} · ${summary.dateLabel}`}
        bell
      />
      <Card className={styles.card}>
        <div className={styles.body}>
          {summary.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </div>
        <AiNote className={styles.note} />
      </Card>
    </>
  );
}
