// /summaries (CONTRACT 20): the signed-in person's own AI summaries, newest first — a PM's daily
// project summaries and HR's weekly attendance notes — with the title, the date and a short
// excerpt, 20 to a page. The bell's notifications link to one summary (/summaries/<id>).
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import Tag from '@/components/Tag';
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import { aiSummaries } from '@/modules/aiSummaries';
import { summariesQuerySchema } from '@/modules/aiSummaries/schemas';
import AiNote from './AiNote';
import SummaryKindIcon from './SummaryKindIcon';
import styles from './page.module.css';

export const metadata = { title: 'Summaries' };

const pageHref = (page) => (page > 1 ? `/summaries?page=${page}` : '/summaries');

function Pager({ page, pages }) {
  if (pages <= 1) return null;
  return (
    <nav className={styles.pager} aria-label="Pages">
      <span className={`${styles.pageCount} num`}>
        Page {page} of {pages}
      </span>
      <div className={styles.pagerButtons}>
        {page > 1 ? (
          <Button
            variant="secondary"
            size="compact"
            href={pageHref(page - 1)}
            icon={<ChevronLeft size={16} strokeWidth={1.8} />}
          >
            Newer
          </Button>
        ) : null}
        {page < pages ? (
          <Button
            variant="secondary"
            size="compact"
            href={pageHref(page + 1)}
            iconRight={<ChevronRight size={16} strokeWidth={1.8} />}
          >
            Older
          </Button>
        ) : null}
      </div>
    </nav>
  );
}

function SummaryRow({ item }) {
  return (
    <li className={styles.item}>
      <Link href={`/summaries/${item.id}`} className={styles.link}>
        <SummaryKindIcon kind={item.kind} />
        <span className={styles.main}>
          <span className={styles.meta}>
            <Tag tone={item.tone} size="sm">
              {item.kindLabel}
            </Tag>
            <span className={styles.date}>{item.periodLabel}</span>
          </span>
          <span className={styles.title}>{item.title}</span>
          {item.excerpt ? <span className={styles.excerpt}>{item.excerpt}</span> : null}
        </span>
        <ChevronRight size={18} strokeWidth={1.8} className={styles.chevron} aria-hidden="true" />
      </Link>
    </li>
  );
}

export default async function SummariesPage({ searchParams }) {
  const user = await requirePage(null);
  const { page } = summariesQuerySchema.parse((await searchParams) ?? {});
  const list = await aiSummaries.listMine({ user, page });

  return (
    <>
      <TopBar title="Summaries" subtitle="What Daybook's AI wrote for you, newest first" bell />
      <Card padding="none" className={styles.card}>
        {list.items.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={20} strokeWidth={1.8} />}
            title="No summaries yet"
            body="Daily project summaries and weekly attendance notes written for you show up here."
          />
        ) : (
          <ul className={styles.list}>
            {list.items.map((item) => (
              <SummaryRow key={item.id} item={item} />
            ))}
          </ul>
        )}
        <Pager page={list.page} pages={list.pages} />
        <div className={styles.footer}>
          <AiNote />
        </div>
      </Card>
    </>
  );
}
